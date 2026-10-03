//! Unpacks extension packages: Chrome/Edge store `.crx` files and plain `.zip` archives.

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Refuse archives that would unpack to more than this (zip bombs).
const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;

/// A store package split into its zip payload and the developer's public key (DER), when present.
pub struct Crx<'a> {
    pub zip: &'a [u8],
    pub public_key: Option<Vec<u8>>,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    bytes.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

/// Splits a CRX2/CRX3 file. A plain zip is accepted as-is.
pub fn parse_crx(bytes: &[u8]) -> Result<Crx<'_>, String> {
    const BAD: &str = "The download isn't a valid extension package.";
    if bytes.starts_with(b"PK\x03\x04") {
        return Ok(Crx { zip: bytes, public_key: None });
    }
    if !bytes.starts_with(b"Cr24") {
        return Err(BAD.into());
    }
    match u32_at(bytes, 4).ok_or(BAD)? {
        2 => {
            let key_len = u32_at(bytes, 8).ok_or(BAD)? as usize;
            let sig_len = u32_at(bytes, 12).ok_or(BAD)? as usize;
            let key = bytes.get(16..16 + key_len).ok_or(BAD)?;
            let zip = bytes.get(16 + key_len + sig_len..).ok_or(BAD)?;
            Ok(Crx { zip, public_key: Some(key.to_vec()) })
        }
        3 => {
            let header_len = u32_at(bytes, 8).ok_or(BAD)? as usize;
            let header = bytes.get(12..12 + header_len).ok_or(BAD)?;
            let zip = bytes.get(12 + header_len..).ok_or(BAD)?;
            Ok(Crx { zip, public_key: crx3_developer_key(header) })
        }
        _ => Err(BAD.into()),
    }
}

/// Minimal protobuf walk: yields (field number, bytes) for length-delimited fields.
fn proto_fields(mut buf: &[u8]) -> Vec<(u64, &[u8])> {
    fn varint(buf: &mut &[u8]) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = buf.split_first()?;
            *buf = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }
    let mut out = Vec::new();
    while !buf.is_empty() {
        let Some(tag) = varint(&mut buf) else { break };
        match tag & 7 {
            0 => {
                if varint(&mut buf).is_none() {
                    break;
                }
            }
            1 if buf.len() >= 8 => buf = &buf[8..],
            5 if buf.len() >= 4 => buf = &buf[4..],
            2 => {
                let Some(len) = varint(&mut buf) else { break };
                let len = len as usize;
                if len > buf.len() {
                    break;
                }
                out.push((tag >> 3, &buf[..len]));
                buf = &buf[len..];
            }
            _ => break,
        }
    }
    out
}

/// CRX3 headers carry several keys (developer + store); the developer key is the one whose hash is the crx id.
fn crx3_developer_key(header: &[u8]) -> Option<Vec<u8>> {
    let fields = proto_fields(header);
    let crx_id = fields
        .iter()
        .find(|(n, _)| *n == 10000)
        .and_then(|(_, signed)| proto_fields(signed).into_iter().find(|(n, _)| *n == 1))
        .map(|(_, id)| id.to_vec())?;
    fields
        .iter()
        .filter(|(n, _)| *n == 2 || *n == 3)
        .filter_map(|(_, proof)| proto_fields(proof).into_iter().find(|(n, _)| *n == 1).map(|(_, k)| k))
        .find(|key| Sha256::digest(key)[..16] == crx_id[..])
        .map(|k| k.to_vec())
}

/// The extension id Chromium derives from a public key (32 letters a-p).
pub fn extension_id_from_key(public_key: &[u8]) -> String {
    Sha256::digest(public_key)[..16]
        .iter()
        .flat_map(|b| [b >> 4, b & 0xf])
        .map(|nibble| (b'a' + nibble) as char)
        .collect()
}

pub fn is_store_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// Joins an archive entry name onto `dest`, rejecting anything that could escape it.
fn safe_join(dest: &Path, name: &str) -> Option<PathBuf> {
    let relative = Path::new(name);
    let mut out = dest.to_path_buf();
    for part in relative.components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (out != dest).then_some(out)
}

struct ZipEntry<'a> {
    method: u16,
    data: &'a [u8],
    size: u64,
}

impl ZipEntry<'_> {
    fn read(&self) -> Result<Vec<u8>, String> {
        match self.method {
            0 => Ok(self.data.to_vec()),
            8 => {
                let mut out = Vec::with_capacity(self.size.min(64 * 1024 * 1024) as usize);
                flate2::read::DeflateDecoder::new(self.data)
                    .take(self.size + 1)
                    .read_to_end(&mut out)
                    .map_err(|_| "The extension package is damaged.".to_string())?;
                Ok(out)
            }
            _ => Err("The extension package uses an unsupported compression method.".into()),
        }
    }
}

/// Visits every file in a zip archive. `visit` returns false to stop early.
fn walk_zip(bytes: &[u8], mut visit: impl FnMut(&str, ZipEntry<'_>) -> Result<bool, String>) -> Result<(), String> {
    const BAD: &str = "The extension package is damaged.";
    // End of central directory: last 22+ bytes, possibly followed by a comment.
    let search_from = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (search_from..bytes.len().saturating_sub(21))
        .rev()
        .find(|&i| bytes[i..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or(BAD)?;
    let entries = u16_at(bytes, eocd + 10).ok_or(BAD)? as usize;
    let mut at = u32_at(bytes, eocd + 16).ok_or(BAD)? as usize;
    let mut total: u64 = 0;

    for _ in 0..entries {
        if u32_at(bytes, at) != Some(0x0201_4b50) {
            return Err(BAD.into());
        }
        let flags = u16_at(bytes, at + 8).ok_or(BAD)?;
        let method = u16_at(bytes, at + 10).ok_or(BAD)?;
        let compressed = u32_at(bytes, at + 20).ok_or(BAD)? as usize;
        let size = u32_at(bytes, at + 24).ok_or(BAD)? as u64;
        let name_len = u16_at(bytes, at + 28).ok_or(BAD)? as usize;
        let extra_len = u16_at(bytes, at + 30).ok_or(BAD)? as usize;
        let comment_len = u16_at(bytes, at + 32).ok_or(BAD)? as usize;
        let local = u32_at(bytes, at + 42).ok_or(BAD)? as usize;
        let name = String::from_utf8_lossy(bytes.get(at + 46..at + 46 + name_len).ok_or(BAD)?).replace('\\', "/");
        at += 46 + name_len + extra_len + comment_len;

        if flags & 1 != 0 {
            return Err("Encrypted extension packages aren't supported.".into());
        }
        if name.ends_with('/') {
            continue;
        }
        total += size;
        if total > MAX_UNPACKED_BYTES || compressed == u32::MAX as usize {
            return Err("The extension package is too large.".into());
        }
        if u32_at(bytes, local) != Some(0x0403_4b50) {
            return Err(BAD.into());
        }
        let data_at = local + 30 + u16_at(bytes, local + 26).ok_or(BAD)? as usize + u16_at(bytes, local + 28).ok_or(BAD)? as usize;
        let data = bytes.get(data_at..data_at + compressed).ok_or(BAD)?;
        if !visit(&name, ZipEntry { method, data, size })? {
            break;
        }
    }
    Ok(())
}

/// Extracts a zip archive (stored or deflated entries) into `dest`.
pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    walk_zip(bytes, |name, entry| {
        let target = safe_join(dest, name).ok_or("The extension package is damaged.")?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, entry.read()?).map_err(|e| e.to_string())?;
        Ok(true)
    })
}

/// Reads one file from a zip archive without extracting the rest.
pub fn zip_entry(bytes: &[u8], wanted: &str) -> Option<Vec<u8>> {
    let mut found = None;
    walk_zip(bytes, |name, entry| {
        if name == wanted {
            found = entry.read().ok();
            return Ok(false);
        }
        Ok(true)
    })
    .ok()?;
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Builds a zip with one deflated and one stored file.
    fn sample_zip() -> Vec<u8> {
        let files: [(&str, &[u8], bool); 2] = [("manifest.json", br#"{"name":"x"}"#, true), ("js/a.js", b"let a = 1;", false)];
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, content, deflate) in files {
            let data = if deflate {
                let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                enc.write_all(content).unwrap();
                enc.finish().unwrap()
            } else {
                content.to_vec()
            };
            let method: u16 = if deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&[20, 0, 0, 0]);
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&[0; 8]); // time, date, crc
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(content.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&data);

            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&[20, 0, 20, 0, 0, 0]);
            central.extend_from_slice(&method.to_le_bytes());
            central.extend_from_slice(&[0; 8]);
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(content.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]); // extra, comment, disk, attrs
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&[0, 0, 0, 0, 2, 0, 2, 0]);
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out
    }

    #[test]
    fn extracts_stored_and_deflated_entries() {
        let dest = std::env::temp_dir().join(format!("hs-zip-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        extract_zip(&sample_zip(), &dest).unwrap();
        assert_eq!(std::fs::read_to_string(dest.join("manifest.json")).unwrap(), r#"{"name":"x"}"#);
        assert_eq!(std::fs::read_to_string(dest.join("js").join("a.js")).unwrap(), "let a = 1;");
        let _ = std::fs::remove_dir_all(&dest);
        assert_eq!(zip_entry(&sample_zip(), "manifest.json").unwrap(), br#"{"name":"x"}"#);
        assert!(zip_entry(&sample_zip(), "missing.json").is_none());
    }

    #[test]
    fn rejects_paths_that_escape_the_folder() {
        let dest = Path::new("C:/ext");
        assert!(safe_join(dest, "../evil.js").is_none());
        assert!(safe_join(dest, "/abs.js").is_none());
        assert!(safe_join(dest, "C:/Windows/x.js").is_none());
        assert_eq!(safe_join(dest, "a/./b.js").unwrap(), dest.join("a").join("b.js"));
    }

    #[test]
    fn parses_crx3_and_finds_the_developer_key() {
        // Two key proofs; only the second one hashes to the crx id.
        let store_key = b"store-key".to_vec();
        let dev_key = b"developer-key".to_vec();
        let crx_id = Sha256::digest(&dev_key)[..16].to_vec();
        let proof = |key: &[u8]| {
            let mut p = vec![0x0a, key.len() as u8];
            p.extend_from_slice(key);
            p
        };
        let mut header = Vec::new();
        for key in [&store_key, &dev_key] {
            let p = proof(key);
            header.push(0x12); // field 2, length-delimited
            header.push(p.len() as u8);
            header.extend_from_slice(&p);
        }
        let mut signed = vec![0x0a, 16];
        signed.extend_from_slice(&crx_id);
        header.extend_from_slice(&[0x82, 0xf1, 0x04]); // field 10000, wire type 2
        header.push(signed.len() as u8);
        header.extend_from_slice(&signed);

        let zip = sample_zip();
        let mut crx = b"Cr24".to_vec();
        crx.extend_from_slice(&3u32.to_le_bytes());
        crx.extend_from_slice(&(header.len() as u32).to_le_bytes());
        crx.extend_from_slice(&header);
        crx.extend_from_slice(&zip);

        let parsed = parse_crx(&crx).unwrap();
        assert_eq!(parsed.zip, &zip[..]);
        assert_eq!(parsed.public_key.as_deref(), Some(&dev_key[..]));
        let id = extension_id_from_key(&dev_key);
        assert!(is_store_id(&id));
    }

    #[test]
    fn rejects_non_packages() {
        assert!(parse_crx(b"<html>not found</html>").is_err());
        assert!(!is_store_id("not-an-id"));
        assert!(is_store_id("eimadpbcbfnmbkopoojfekhnkhdbieeh"));
    }
}
