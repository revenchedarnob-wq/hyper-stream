use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const INITIAL_WAIT: Duration = Duration::from_millis(50);
const MAX_WAIT: Duration = Duration::from_millis(800);
const MAX_ATTEMPTS: usize = 12;

/// Determines whether an I/O error is caused by a Windows file lock or permission issue.
/// - 32: ERROR_SHARING_VIOLATION (another process or antivirus has the file open)
/// - 33: ERROR_LOCK_VIOLATION (byte-range or file lock)
/// - 5:  ERROR_ACCESS_DENIED (permission denied or transient delete-pending lock)
pub fn is_lock_error(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(32 | 33 | 5))
}

/// Computes an exponential backoff delay with pseudo-random jitter (+/- 25%).
fn jitter_delay(base: Duration) -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(42);
    // 0.80 .. 1.25 multiplier
    let factor = 0.80 + ((nanos % 46) as f64) / 100.0;
    base.mul_f64(factor)
}

/// Atomically renames `from` to `to`, retrying with exponential backoff and jitter if
/// another process (e.g. Windows Defender, indexer) holds an exclusive lock or sharing violation.
pub fn resilient_rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> std::io::Result<()> {
    let from = from.as_ref();
    let to = to.as_ref();
    let mut wait = INITIAL_WAIT;

    for _ in 0..MAX_ATTEMPTS {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if is_lock_error(&e) => {
                // On Windows, if destination exists and is causing access denial, attempt removal
                if to.exists() {
                    let _ = std::fs::remove_file(to);
                }
                std::thread::sleep(jitter_delay(wait));
                wait = (wait * 2).min(MAX_WAIT);
            }
            Err(e) => return Err(e),
        }
    }
    std::fs::rename(from, to)
}

/// Asynchronous version of `resilient_rename` using tokio sleep.
pub async fn resilient_rename_async(from: impl AsRef<Path>, to: impl AsRef<Path>) -> std::io::Result<()> {
    let from = from.as_ref();
    let to = to.as_ref();
    let mut wait = INITIAL_WAIT;

    for _ in 0..MAX_ATTEMPTS {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if is_lock_error(&e) => {
                if to.exists() {
                    let _ = std::fs::remove_file(to);
                }
                tokio::time::sleep(jitter_delay(wait)).await;
                wait = (wait * 2).min(MAX_WAIT);
            }
            Err(e) => return Err(e),
        }
    }
    std::fs::rename(from, to)
}

/// Removes a file, retrying with exponential backoff and jitter if locked.
/// Returns Ok(()) if the file was deleted or did not exist.
pub fn resilient_remove(path: impl AsRef<Path>) -> std::io::Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }
    let mut wait = INITIAL_WAIT;

    for _ in 0..MAX_ATTEMPTS {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if is_lock_error(&e) => {
                std::thread::sleep(jitter_delay(wait));
                wait = (wait * 2).min(MAX_WAIT);
            }
            Err(e) => return Err(e),
        }
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Asynchronous version of `resilient_remove` using tokio sleep.
pub async fn resilient_remove_async(path: impl AsRef<Path>) -> std::io::Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }
    let mut wait = INITIAL_WAIT;

    for _ in 0..MAX_ATTEMPTS {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if is_lock_error(&e) => {
                tokio::time::sleep(jitter_delay(wait)).await;
                wait = (wait * 2).min(MAX_WAIT);
            }
            Err(e) => return Err(e),
        }
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_resilient_rename_happy_path() {
        let dir = std::env::temp_dir().join("hyperstream-test-fs-rename");
        let _ = fs::create_dir_all(&dir);
        let src = dir.join("src.txt");
        let dst = dir.join("dst.txt");
        fs::write(&src, b"hello").unwrap();
        let _ = fs::remove_file(&dst);

        assert!(resilient_rename(&src, &dst).is_ok());
        assert_eq!(fs::read(&dst).unwrap(), b"hello");
        assert!(!src.exists());

        let _ = fs::remove_file(&dst);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn test_resilient_remove_nonexistent() {
        let dir = std::env::temp_dir().join("hyperstream-test-fs-nonexistent");
        let p = dir.join("nope.txt");
        assert!(resilient_remove(&p).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn test_resilient_rename_waits_for_locked_destination() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = std::env::temp_dir().join("hyperstream-test-fs-lock");
        let _ = fs::create_dir_all(&dir);
        let src = dir.join("src_locked.bin");
        let dst = dir.join("dst_locked.bin");
        fs::write(&src, b"new_data").unwrap();
        fs::write(&dst, b"old_data").unwrap();

        // Lock destination with share_mode(0)
        let holder = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&dst)
            .unwrap();

        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(holder);
        });

        assert!(resilient_rename(&src, &dst).is_ok());
        handle.join().unwrap();
        assert_eq!(fs::read(&dst).unwrap(), b"new_data");

        let _ = fs::remove_file(&dst);
        let _ = fs::remove_dir(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn test_resilient_remove_waits_for_locked_file() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = std::env::temp_dir().join("hyperstream-test-fs-rm-lock");
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("file_locked.bin");
        fs::write(&file, b"data_to_delete").unwrap();

        let holder = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&file)
            .unwrap();

        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(holder);
        });

        assert!(resilient_remove(&file).is_ok());
        handle.join().unwrap();
        assert!(!file.exists());

        let _ = fs::remove_dir(&dir);
    }
}
