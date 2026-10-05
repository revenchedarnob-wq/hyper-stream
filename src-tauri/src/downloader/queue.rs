use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use super::orchestrator::{DownloadOptions, DownloadState};

/// A single task queued for processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueEntry {
    pub task_id: String,
    pub options: DownloadOptions,
    pub priority: i32,        // higher first; default 0
    pub enqueued_at: u64,     // unix ms, FIFO tiebreak
    pub attempts: u32,
    pub target_dir: PathBuf,
    #[serde(default)]
    pub had_cookies: bool,
}

/// Global queue concurrency and retry configuration.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueueConfig {
    pub max_concurrent: usize, // default 3, range 1..=8
    pub max_retries: u32,      // default 2
    pub retry_backoff_ms: u64, // default 5000, doubles per attempt
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 3,
            max_retries: 2,
            retry_backoff_ms: 5000,
        }
    }
}

impl QueueConfig {
    pub fn sanitized(mut self) -> Self {
        self.max_concurrent = self.max_concurrent.clamp(1, 8);
        self.max_retries = self.max_retries.clamp(0, 10);
        self.retry_backoff_ms = self.retry_backoff_ms.clamp(1000, 60_000);
        self
    }
}

/// Payload sent via `download-queue-changed` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueChangedPayload {
    pub order: Vec<String>,
    pub running: usize,
    pub max_concurrent: usize,
}

/// Persisted queue item stored in %APPDATA%/HyperStream/queue.json.
/// Cookies are strictly stripped before writing to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedQueueEntry {
    pub task_id: String,
    pub options: DownloadOptions,
    pub priority: i32,
    pub enqueued_at: u64,
    pub attempts: u32,
    pub target_dir: PathBuf,
    pub had_cookies: bool,
    pub state: DownloadState,
}

/// Strip cookies before persisting to disk.
pub fn sanitize_for_persistence(entry: &QueueEntry, state: DownloadState) -> PersistedQueueEntry {
    let mut options = entry.options.clone();
    let had_cookies = options.cookies.is_some() || entry.had_cookies;
    options.cookies = None;

    PersistedQueueEntry {
        task_id: entry.task_id.clone(),
        options,
        priority: entry.priority,
        enqueued_at: entry.enqueued_at,
        attempts: entry.attempts,
        target_dir: entry.target_dir.clone(),
        had_cookies,
        state,
    }
}

/// %APPDATA%/HyperStream — shared home for queue.json, library.json and thumbnails.
pub fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .or_else(|_| std::env::var("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string())).join(".hyperstream")
        });
    let dir = base.join("HyperStream");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Path to queue.json in %APPDATA%/HyperStream.
pub fn get_queue_file_path() -> PathBuf {
    app_data_dir().join("queue.json")
}

/// Save entries to disk atomically (write to temp file then rename).
pub fn save_queue_to_path(path: &Path, entries: &[PersistedQueueEntry]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize queue: {}", e))?;

    let tmp_path = path.with_extension(format!("tmp.{}", uuid_simple_q()));
    std::fs::write(&tmp_path, json.as_bytes())
        .map_err(|e| format!("Failed to write temporary queue file: {}", e))?;

    crate::utils::fs::resilient_rename(&tmp_path, path)
        .map_err(|e| format!("Failed to finalize queue file: {}", e))?;

    Ok(())
}

/// Load entries from disk.
pub fn load_queue_from_path(path: &Path) -> Result<Vec<PersistedQueueEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read queue file: {}", e))?;

    let entries: Vec<PersistedQueueEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to deserialize queue: {}", e))?;

    Ok(entries)
}

/// Helper function to classify whether a download error is transient
/// (suitable for automatic retry) or permanent (abort immediately).
pub fn is_transient_error(err: &str) -> bool {
    let lower = err.to_lowercase();

    // Permanent errors — NEVER retry
    let permanent = [
        "http error 400", "http error 401", "http error 403", "http error 404", "http error 405",
        "forbidden", "not found", "unauthorized",
        "geo", "region", "country",
        "sign in", "log in", "login required", "requires authentication",
        "private video", "members-only", "members only", "this video is private",
        "unsupported url", "no video formats", "unable to extract", "no media found",
        "no space left", "disk full", "not enough space",
        "permission denied", "access is denied", "os error 5",
        "ffmpeg", "merger", "not installed",
        "failed container validation", "corrupted",
    ];

    for p in &permanent {
        if lower.contains(p) {
            return false;
        }
    }

    // Transient errors — retry with backoff
    let transient = [
        "http error 429", "too many requests", "rate-limiting", "rate limit",
        "lost the connection", "server is busy", "was using the file",
        "http error 500", "http error 502", "http error 503", "http error 504",
        "internal server error", "bad gateway", "service unavailable", "gateway timeout",
        "timed out", "timeout", "connection reset", "connection aborted",
        "connection refused", "read timed out", "network error",
        "name or service not known", "getaddrinfo", "failed to resolve",
        "temporary failure in name resolution", "transport endpoint",
        "broken pipe", "unexpected eof",
    ];

    for t in &transient {
        if lower.contains(t) {
            return true;
        }
    }

    false
}

fn uuid_simple_q() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_entry_ordering() {
        let mut entries = vec![
            QueueEntry {
                task_id: "dl-low".to_string(),
                options: DownloadOptions {
                url: "https://example.com/1".to_string(),
                title: "Low Priority".to_string(),
                cookies: None,
                ..Default::default()
            },
                priority: 0,
                enqueued_at: 200,
                attempts: 0,
                target_dir: PathBuf::from("downloads"),
                had_cookies: false,
            },
            QueueEntry {
                task_id: "dl-high".to_string(),
                options: DownloadOptions {
                url: "https://example.com/2".to_string(),
                title: "High Priority".to_string(),
                cookies: None,
                ..Default::default()
            },
                priority: 10,
                enqueued_at: 500,
                attempts: 0,
                target_dir: PathBuf::from("downloads"),
                had_cookies: false,
            },
            QueueEntry {
                task_id: "dl-first".to_string(),
                options: DownloadOptions {
                url: "https://example.com/3".to_string(),
                title: "First In".to_string(),
                cookies: None,
                ..Default::default()
            },
                priority: 0,
                enqueued_at: 100,
                attempts: 0,
                target_dir: PathBuf::from("downloads"),
                had_cookies: false,
            },
        ];

        // Sort by (-priority, enqueued_at)
        entries.sort_by(|a, b| {
            b.priority.cmp(&a.priority)
                .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
        });

        assert_eq!(entries[0].task_id, "dl-high"); // Highest priority (10)
        assert_eq!(entries[1].task_id, "dl-first"); // Priority 0, earlier enqueued_at (100)
        assert_eq!(entries[2].task_id, "dl-low"); // Priority 0, later enqueued_at (200)
    }

    #[test]
    fn test_retry_classifier() {
        assert!(is_transient_error("HTTP Error 429: Too Many Requests"));
        assert!(is_transient_error("Connection reset by peer"));
        assert!(is_transient_error("read timed out"));
        assert!(is_transient_error("HTTP Error 503: Service Unavailable"));
        assert!(is_transient_error("temporary failure in name resolution"));

        assert!(!is_transient_error("HTTP Error 403: Forbidden"));
        assert!(!is_transient_error("HTTP Error 404: Not Found"));
        assert!(!is_transient_error("This video is geo-restricted."));
        assert!(!is_transient_error("Private video. Sign in if you've been granted access."));
        assert!(!is_transient_error("Unsupported URL: https://unknown.site"));
    }

    #[test]
    fn test_persistence_roundtrip_strips_cookies() {
        let temp_dir = std::env::temp_dir().join(format!("hs_queue_test_{}", uuid_simple_q()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let queue_file = temp_dir.join("queue.json");

        let entry = QueueEntry {
            task_id: "dl-cookie-test".to_string(),
            options: DownloadOptions {
                url: "https://example.com/test".to_string(),
                title: "Sensitive Stream".to_string(),
                cookies: Some("session_secret=xyz12345; auth=token_abcdef".to_string()),
                ..Default::default()
            },
            priority: 5,
            enqueued_at: 1000,
            attempts: 1,
            target_dir: PathBuf::from("downloads"),
            had_cookies: false,
        };

        let sanitized = sanitize_for_persistence(&entry, DownloadState::Queued);
        assert_eq!(sanitized.options.cookies, None);
        assert!(sanitized.had_cookies);

        let entries = vec![sanitized];
        save_queue_to_path(&queue_file, &entries).expect("save should succeed");

        // Verify the raw file content contains no cookie secrets
        let raw_content = std::fs::read_to_string(&queue_file).unwrap();
        assert!(!raw_content.contains("session_secret"));
        assert!(!raw_content.contains("auth=token"));

        let loaded = load_queue_from_path(&queue_file).expect("load should succeed");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].task_id, "dl-cookie-test");
        assert_eq!(loaded[0].options.cookies, None);
        assert!(loaded[0].had_cookies);
        assert_eq!(loaded[0].priority, 5);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_queue_config_sanitized() {
        let cfg = QueueConfig {
            max_concurrent: 20, // out of range
            max_retries: 50,
            retry_backoff_ms: 100,
        }.sanitized();

        assert_eq!(cfg.max_concurrent, 8);
        assert_eq!(cfg.max_retries, 10);
        assert_eq!(cfg.retry_backoff_ms, 1000);
    }
}
