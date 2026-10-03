//! Persistent media library: every completed download, stored in
//! %APPDATA%/HyperStream/library.json, with thumbnails cached next to it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::downloader::queue::app_data_dir;

static LIBRARY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    #[default]
    Video,
    Audio,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct LibraryItem {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub source_url: String,
    pub thumbnail_path: Option<String>,
    pub uploader: Option<String>,
    pub extractor: Option<String>,
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size_bytes: u64,
    /// Unix milliseconds.
    pub added_at: u64,
    pub kind: MediaKind,
    /// "MP4", "MKV", "M4A", ...
    pub container: String,
    pub audio_languages: Vec<String>,
    pub subtitle_languages: Vec<String>,
    /// Computed on read: the file was moved or deleted outside the app.
    pub missing: bool,
}

pub fn thumbnails_dir() -> PathBuf {
    let dir = app_data_dir().join("thumbnails");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn library_file() -> PathBuf {
    app_data_dir().join("library.json")
}

fn load_from(path: &Path) -> Vec<LibraryItem> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<LibraryItem>>(&s).ok())
        .unwrap_or_default()
}

fn save_to(path: &Path, items: &[LibraryItem]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("Couldn't save the library: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Couldn't save the library: {}", e))
}

/// Adds (or replaces, when the same file was downloaded again) an item. Newest first.
pub fn add(item: LibraryItem) -> Result<(), String> {
    let _guard = LIBRARY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = library_file();
    let mut items = load_from(&path);
    items.retain(|i| i.id != item.id && !i.file_path.eq_ignore_ascii_case(&item.file_path));
    items.insert(0, item);
    save_to(&path, &items)
}

/// All items, with `missing` and `size_bytes` refreshed from disk.
pub fn list() -> Vec<LibraryItem> {
    let _guard = LIBRARY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut items = load_from(&library_file());
    for item in &mut items {
        match std::fs::metadata(&item.file_path) {
            Ok(meta) => {
                item.missing = false;
                item.size_bytes = meta.len();
            }
            Err(_) => item.missing = true,
        }
        if let Some(thumb) = &item.thumbnail_path {
            if !Path::new(thumb).is_file() {
                item.thumbnail_path = None;
            }
        }
    }
    items
}

/// Removes an item from the library. With `delete_file`, the media file goes to the Recycle Bin.
pub fn remove(id: &str, delete_file: bool) -> Result<(), String> {
    let _guard = LIBRARY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = library_file();
    let mut items = load_from(&path);
    let Some(pos) = items.iter().position(|i| i.id == id) else {
        return Err("That item is no longer in the library.".to_string());
    };
    let item = items.remove(pos);

    if delete_file && Path::new(&item.file_path).exists() {
        move_to_recycle_bin(Path::new(&item.file_path))?;
    }
    if let Some(thumb) = &item.thumbnail_path {
        let _ = std::fs::remove_file(thumb);
    }
    save_to(&path, &items)
}

/// Finds the thumbnail yt-dlp wrote for a task (`<task_id>.<ext>`), if any.
pub fn find_thumbnail(task_id: &str) -> Option<String> {
    let dir = thumbnails_dir();
    let prefix = format!("{}.", task_id);
    std::fs::read_dir(&dir).ok()?.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        name.starts_with(&prefix).then(|| entry.path().to_string_lossy().to_string())
    })
}

#[cfg(target_os = "windows")]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
pub fn move_to_recycle_bin(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
        SHFILEOPSTRUCTW,
    };
    // pFrom must be double-null terminated.
    let mut from: Vec<u16> = path.to_string_lossy().encode_utf16().collect();
    from.push(0);
    from.push(0);

    let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    op.wFunc = FO_DELETE as _;
    op.pFrom = from.as_ptr();
    op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as _;

    let result = unsafe { SHFileOperationW(&mut op) };
    if result == 0 && op.fAnyOperationsAborted == 0 {
        Ok(())
    } else {
        Err("Couldn't move the file to the Recycle Bin. It may be open in another app.".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn move_to_recycle_bin(path: &Path) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

/// Opens a file with its default app (Media Player, VLC, ...).
#[cfg(target_os = "windows")]
pub fn open_with_default_app(path: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if !Path::new(path).exists() {
        return Err("The file was moved or deleted.".to_string());
    }
    if !is_openable_media(path) {
        return Err("HyperStream only opens downloaded media files.".to_string());
    }
    let verb = wide("open");
    let file = wide(path);
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };
    // ShellExecuteW returns a value > 32 on success.
    if result as isize > 32 {
        Ok(())
    } else {
        Err("Windows couldn't find an app to open this file.".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn open_with_default_app(path: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// "Open" hands the file to Windows, which would also run programs and scripts. Only media,
/// subtitles and images (what yt-dlp produces) are passed on.
pub fn is_openable_media(path: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "mp4", "m4v", "mkv", "webm", "mov", "avi", "flv", "ts", "3gp", "wmv", "mpg", "mpeg",
        "m4a", "mp3", "aac", "opus", "ogg", "oga", "flac", "wav", "alac", "wma",
        "srt", "vtt", "ass", "ssa", "lrc", "jpg", "jpeg", "png", "webp", "gif",
    ];
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| ALLOWED.iter().any(|a| a.eq_ignore_ascii_case(e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_media_but_never_programs() {
        assert!(is_openable_media("C:/Videos/clip.MP4"));
        assert!(is_openable_media("song.opus"));
        assert!(!is_openable_media("C:/Users/x/evil.exe"));
        assert!(!is_openable_media("run.bat"));
        assert!(!is_openable_media("noext"));
    }

    #[test]
    fn roundtrip_and_missing_detection() {
        let dir = std::env::temp_dir().join(format!("hs_lib_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let lib = dir.join("library.json");
        let media = dir.join("clip.mp4");
        std::fs::write(&media, b"12345").unwrap();

        let item = LibraryItem {
            id: "dl-1".into(),
            title: "Clip".into(),
            file_path: media.to_string_lossy().to_string(),
            ..Default::default()
        };
        save_to(&lib, &[item]).unwrap();
        let loaded = load_from(&lib);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "Clip");

        // Unknown/missing fields from older versions must still load.
        std::fs::write(&lib, r#"[{"id":"x","title":"Old","file_path":"C:/nope.mp4","legacy":1}]"#).unwrap();
        assert_eq!(load_from(&lib)[0].title, "Old");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
