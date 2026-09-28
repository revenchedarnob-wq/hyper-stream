//! ISO base-media (MP4/fMP4) container inspection.
//!
//! Pure byte-level box/atom header validation. No decryption, no network,
//! no DRM — safe for the default build. Extracted from the former
//! `crunchyroll_engine.rs` so it no longer sits behind the DRM feature gate.

use std::path::Path;

/// Fast ISO Atom Inspector (sub-millisecond validation).
pub struct FastAtomInspector;

impl FastAtomInspector {
    const KNOWN_BOXES: &'static [&'static [u8; 4]] = &[
        b"ftyp", b"moov", b"mdat", b"sidx", b"styp", b"moof", b"traf", b"trun",
        b"free", b"skip", b"pdin", b"emsg", b"prft",
    ];

    pub fn verify_container_header(header: &[u8]) -> bool {
        if header.len() < 8 {
            return false;
        }

        let mut offset = 0;
        while offset + 8 <= header.len() {
            let box_type = &header[offset + 4..offset + 8];
            for known in Self::KNOWN_BOXES {
                if box_type == *known {
                    return true;
                }
            }

            let box_size = u32::from_be_bytes([
                header[offset],
                header[offset + 1],
                header[offset + 2],
                header[offset + 3],
            ]) as usize;

            if box_size < 8 {
                break;
            }
            offset += box_size;
            if offset > 4096 {
                break;
            }
        }

        for pattern in [b"ftyp", b"styp", b"moov", b"moof"] {
            if header.windows(4).any(|window| window == pattern) {
                return true;
            }
        }

        false
    }

    pub fn verify_file(path: &Path) -> bool {
        use std::io::Read;
        if let Ok(mut file) = std::fs::File::open(path) {
            let mut buf = [0u8; 4096];
            if let Ok(bytes_read) = file.read(&mut buf) {
                if bytes_read >= 8 {
                    return Self::verify_container_header(&buf[..bytes_read]);
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fast_atom_inspector() {
        let valid_ftyp_header = [
            0x00, 0x00, 0x00, 0x20, b'f', b't', b'y', b'p',
            b'i', b's', b'o', b'm', 0x00, 0x00, 0x02, 0x00,
        ];
        assert!(FastAtomInspector::verify_container_header(&valid_ftyp_header));

        let invalid_header = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0];
        assert!(!FastAtomInspector::verify_container_header(&invalid_header));
    }
}
