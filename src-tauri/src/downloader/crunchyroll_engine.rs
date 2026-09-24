use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use aes::Aes128;
use cipher::{KeyIvInit, StreamCipher};
use ctr::Ctr128BE;

// 1. In-Memory Key Cache & Persistent Key Store
pub struct KeyStore {
    keys: RwLock<HashMap<String, [u8; 16]>>,
    key_file: PathBuf,
}

impl KeyStore {
    pub fn new() -> Self {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
        let key_file = PathBuf::from(home).join(".hyperstream").join("keys.txt");
        let store = Self {
            keys: RwLock::new(HashMap::new()),
            key_file,
        };
        store.reload();
        store
    }

    pub fn reload(&self) {
        if !self.key_file.exists() {
            return;
        }

        if let Ok(content) = std::fs::read_to_string(&self.key_file) {
            let mut map = self.keys.write().unwrap();
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 2 {
                    let kid = parts[0].trim().to_lowercase();
                    let key_hex = parts[1].trim();
                    if let Ok(bytes) = hex::decode(key_hex) {
                        if bytes.len() == 16 {
                            let mut key_arr = [0u8; 16];
                            key_arr.copy_from_slice(&bytes);
                            map.insert(kid, key_arr);
                        }
                    }
                }
            }
        }
    }

    pub fn get_key(&self, kid_hex: &str) -> Option<[u8; 16]> {
        let clean_kid = kid_hex.trim().to_lowercase();
        let map = self.keys.read().unwrap();
        map.get(&clean_kid).copied()
    }

    pub fn key_count(&self) -> usize {
        let map = self.keys.read().unwrap();
        map.len()
    }

    pub fn insert_and_persist(&self, kid_hex: &str, key_hex: &str) -> Result<(), String> {
        let clean_kid = kid_hex.trim().to_lowercase();
        let clean_key = key_hex.trim().to_lowercase();

        let bytes = hex::decode(&clean_key)
            .map_err(|e| format!("Invalid hex key: {}", e))?;
        if bytes.len() != 16 {
            return Err("Key length must be exactly 16 bytes (32 hex characters)".to_string());
        }

        let mut key_arr = [0u8; 16];
        key_arr.copy_from_slice(&bytes);

        {
            let mut map = self.keys.write().unwrap();
            map.insert(clean_kid.clone(), key_arr);
        }

        // Append to keys.txt
        if let Some(parent) = self.key_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.key_file)
            .map_err(|e| e.to_string())?;

        writeln!(file, "{}:{}", clean_kid, clean_key)
            .map_err(|e| e.to_string())?;

        Ok(())
    }
}

// 2. Hardware-Accelerated AES-128-CTR Decryptor
pub struct StreamDecryptor;

impl StreamDecryptor {
    pub fn decrypt_in_place(data: &mut [u8], key: &[u8; 16], iv: &[u8; 16]) {
        let mut cipher = Ctr128BE::<Aes128>::new(key.into(), iv.into());
        cipher.apply_keystream(data);
    }

    pub fn decrypt_bytes(data: &[u8], key: &[u8; 16], iv: &[u8; 16]) -> Vec<u8> {
        let mut copy = data.to_vec();
        Self::decrypt_in_place(&mut copy, key, iv);
        copy
    }
}

// 3. Fast ISO Atom Inspector (Sub-millisecond validation)
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

        // Secondary check: simple substring scan for ftyp/styp/moov/moof
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

// 4. Crunchyroll Models
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioVersion {
    #[serde(rename = "audioLocale")]
    pub audio_locale: String,
    pub guid: String,
    #[serde(default)]
    pub original: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaybackSession {
    pub guid: String,
    pub manifest_url: String,
    pub play_token: Option<String>,
    pub audio_locale: Option<String>,
    pub versions: Vec<AudioVersion>,
    pub slot_released: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: Option<u64>,
}

pub struct CrunchyrollEngine {
    client: reqwest::Client,
    pub key_store: KeyStore,
}

impl CrunchyrollEngine {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            client,
            key_store: KeyStore::new(),
        }
    }

    pub fn extract_guid(input: &str) -> String {
        let trimmed = input.trim();
        if let Some(pos) = trimmed.find("/watch/") {
            let after = &trimmed[pos + 7..];
            let guid = after.split('/').next().unwrap_or(after);
            return guid.to_string();
        }
        trimmed.to_string()
    }

    pub async fn refresh_access_token(&self, etp_rt: &str) -> Result<String, String> {
        let url = "https://beta-api.crunchyroll.com/auth/v1/token";
        let device_id = uuid_v4_simple();

        let body_str = format!(
            "grant_type=etp_rt_cookie&device_id={}&device_type=Chrome+on+Windows",
            device_id
        );

        let response = self.client.post(url)
            .header("Authorization", "Basic bm9haWhkZXZtXzZpeWcwYThsMHE6")
            .header("Cookie", format!("etp_rt={}", etp_rt))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body_str)
            .send()
            .await
            .map_err(|e| format!("Auth request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Auth failed (HTTP {}): {}", status, text));
        }

        let data: TokenResponse = response.json().await
            .map_err(|e| format!("Failed to parse token payload: {}", e))?;

        Ok(data.access_token)
    }

    // Bulletproof "Fetch and Delete" Slot Release Flow
    pub async fn acquire_playback_session(&self, guid: &str, access_token: &str) -> Result<PlaybackSession, String> {
        let play_url = format!("https://www.crunchyroll.com/playback/v1/{}/web/chrome/play", guid);

        let response = self.client.get(&play_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
            .header("Origin", "https://www.crunchyroll.com")
            .header("Referer", "https://www.crunchyroll.com/")
            .send()
            .await
            .map_err(|e| format!("Playback acquisition error: {}", e))?;

        if response.status() == 403 {
            return Err("All Crunchyroll playback slots are currently occupied. Please retry in a few moments.".to_string());
        }

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Playback request failed (HTTP {}): {}", status, text));
        }

        let json_val: serde_json::Value = response.json().await
            .map_err(|e| format!("Invalid playback JSON: {}", e))?;

        let manifest_url = json_val.get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Manifest URL missing in playback response".to_string())?
            .to_string();

        let play_token = json_val.get("token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let audio_locale = json_val.get("audioLocale")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut versions = Vec::new();
        if let Some(arr) = json_val.get("versions").and_then(|v| v.as_array()) {
            for item in arr {
                if let (Some(loc), Some(g)) = (
                    item.get("audioLocale").and_then(|v| v.as_str()),
                    item.get("guid").and_then(|v| v.as_str()),
                ) {
                    versions.push(AudioVersion {
                        audio_locale: loc.to_string(),
                        guid: g.to_string(),
                        original: item.get("original").and_then(|v| v.as_bool()).unwrap_or(false),
                    });
                }
            }
        }

        // IMMEDIATE SLOT RELEASE HACK: Delete stream token to unlock server concurrency
        let mut slot_released = false;
        if let Some(ref token) = play_token {
            let delete_url = format!("https://www.crunchyroll.com/playback/v1/token/{}/{}", guid, token);
            let del_resp = self.client.delete(&delete_url)
                .header("Authorization", format!("Bearer {}", access_token))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
                .send()
                .await;

            if let Ok(res) = del_resp {
                slot_released = res.status().is_success();
            }
        }

        Ok(PlaybackSession {
            guid: guid.to_string(),
            manifest_url,
            play_token,
            audio_locale,
            versions,
            slot_released,
        })
    }
}

fn uuid_v4_simple() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:016x}{:016x}", now, now ^ 0x5a5a5a5a5a5a5a5a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_guid_extractor() {
        assert_eq!(
            CrunchyrollEngine::extract_guid("https://www.crunchyroll.com/watch/GK9U3KKW2/test-title"),
            "GK9U3KKW2"
        );
        assert_eq!(
            CrunchyrollEngine::extract_guid("G50UZ0G37"),
            "G50UZ0G37"
        );
    }

    #[test]
    fn test_keystore_load_and_lookup() {
        let store = KeyStore::new();
        // keys.txt contains 68 verified keys on this machine
        let count = store.key_count();
        assert!(count >= 60, "Expected at least 60 cached keys from keys.txt, got {}", count);

        // Check known key from keys.txt line 1: bed388b93ea239458ddead8063ae14c7
        let key = store.get_key("bed388b93ea239458ddead8063ae14c7");
        assert!(key.is_some(), "Known key bed388b93ea239458ddead8063ae14c7 should be cached");
    }

    #[test]
    fn test_aes_128_ctr_hardware_decrypt() {
        let key = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10];
        let iv = [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
        let original_data = b"HyperStream High-Throughput Media Payload Verification 2026";

        let encrypted = StreamDecryptor::decrypt_bytes(original_data, &key, &iv);
        assert_ne!(&encrypted[..], original_data);

        // Decrypting again with same CTR keystream recovers original plaintext
        let decrypted = StreamDecryptor::decrypt_bytes(&encrypted, &key, &iv);
        assert_eq!(&decrypted[..], original_data);
    }

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
