//! Getting the HyperStream extension into the user's browser.
//!
//! Browsers never let a program install an extension by itself. With a store listing, "Add"
//! opens the listing in the user's browser and one click there installs it. Until the
//! extension is listed, the browser's extensions page opens and the user loads the folder.

use std::path::PathBuf;

/// Store listings. Fill in when published (and add the IDs to `bridge::EXTENSION_IDS`).
pub const CHROME_STORE_ID: Option<&str> = None;
pub const EDGE_STORE_ID: Option<&str> = None;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BrowserInfo {
    /// "chrome", "edge", "brave", "vivaldi", "chromium", "firefox", "opera" or "other".
    pub id: String,
    pub name: String,
    #[serde(skip)]
    pub exe: Option<PathBuf>,
}

#[derive(Debug, serde::Serialize)]
pub struct ExtensionStatus {
    /// The browser that opens web links on this PC.
    pub browser: Option<BrowserInfo>,
    /// The extension works in this browser (Chromium-based).
    pub supported: bool,
    /// The extension has connected from this browser.
    pub installed: bool,
    /// One-click install from the browser's store is available.
    pub store: bool,
    /// Extension folder, for loading it by hand.
    pub folder: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct AddOutcome {
    /// "store": the listing opened. "manual": the extensions page opened, load the folder.
    pub mode: String,
    pub folder: Option<String>,
    /// The browser's extensions page ("chrome://extensions"), for the manual steps.
    pub extensions_page: Option<String>,
}

/// Which browser a registry ProgId belongs to.
fn browser_from_prog_id(prog_id: &str) -> BrowserInfo {
    let p = prog_id.to_ascii_lowercase();
    let (id, name) = if p.starts_with("chromehtml") {
        ("chrome", "Chrome")
    } else if p.starts_with("msedgehtm") {
        ("edge", "Edge")
    } else if p.starts_with("bravehtml") || p.starts_with("brave") {
        ("brave", "Brave")
    } else if p.starts_with("vivaldihtm") {
        ("vivaldi", "Vivaldi")
    } else if p.starts_with("chromiumhtm") {
        ("chromium", "Chromium")
    } else if p.starts_with("firefoxurl") || p.starts_with("firefox") {
        ("firefox", "Firefox")
    } else if p.starts_with("opera") {
        ("opera", "Opera")
    } else {
        ("other", "your browser")
    };
    BrowserInfo { id: id.into(), name: name.into(), exe: None }
}

/// Which browser started the extension helper, from its program name.
pub fn browser_id_from_exe(exe_name: &str) -> &'static str {
    match exe_name.to_ascii_lowercase().as_str() {
        "chrome.exe" => "chrome",
        "msedge.exe" => "edge",
        "brave.exe" => "brave",
        "vivaldi.exe" => "vivaldi",
        _ => "chromium",
    }
}

fn is_supported(id: &str) -> bool {
    matches!(id, "chrome" | "edge" | "brave" | "vivaldi" | "chromium")
}

/// `"C:\Program Files\...\chrome.exe" --single-argument %1` -> the exe path.
fn exe_from_command(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    let path = if let Some(rest) = command.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        command.split(" -").next()?.split(" %").next()?.trim()
    };
    let path = PathBuf::from(path);
    path.is_file().then_some(path)
}

#[cfg(windows)]
fn registry_string(root: windows_sys::Win32::System::Registry::HKEY, key: &str, value: Option<&str>) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let key_w: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let value_w: Option<Vec<u16>> = value.map(|v| v.encode_utf16().chain(Some(0)).collect());
    let value_ptr = value_w.as_ref().map_or(std::ptr::null(), |v| v.as_ptr());
    let mut size = 0u32;
    let status = unsafe { RegGetValueW(root, key_w.as_ptr(), value_ptr, RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) };
    if status != 0 || size == 0 {
        return None;
    }
    let mut buf = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe {
        RegGetValueW(root, key_w.as_ptr(), value_ptr, RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size)
    };
    if status != 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

/// The browser Windows opens web links with.
#[cfg(windows)]
pub fn default_browser() -> Option<BrowserInfo> {
    use windows_sys::Win32::System::Registry::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
    let prog_id = registry_string(
        HKEY_CURRENT_USER,
        r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
        Some("ProgId"),
    )?;
    let mut info = browser_from_prog_id(&prog_id);
    info.exe = registry_string(HKEY_CLASSES_ROOT, &format!(r"{}\shell\open\command", prog_id), None).and_then(|c| exe_from_command(&c));
    Some(info)
}

#[cfg(not(windows))]
pub fn default_browser() -> Option<BrowserInfo> {
    None
}

fn marker(browser_id: &str) -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("com.hyperstream.desktop").join("bridge").join(format!("connected-{}", browser_id)))
}

/// Called by the extension helper: the extension is installed in this browser.
pub fn mark_connected(browser_id: &str) {
    if let Some(path) = marker(browser_id) {
        if !path.is_file() {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, b"");
        }
    }
}

fn store_url(browser_id: &str) -> Option<String> {
    match (browser_id, EDGE_STORE_ID, CHROME_STORE_ID) {
        ("edge", Some(id), _) => Some(format!("https://microsoftedge.microsoft.com/addons/detail/{}", id)),
        // Edge can also install from the Chrome Web Store (it asks to allow other stores once).
        (_, _, Some(id)) => Some(format!("https://chromewebstore.google.com/detail/{}", id)),
        _ => None,
    }
}

pub fn status(folder: Option<String>) -> ExtensionStatus {
    let browser = default_browser();
    let id = browser.as_ref().map_or("other", |b| b.id.as_str()).to_string();
    ExtensionStatus {
        supported: is_supported(&id),
        installed: marker(&id).is_some_and(|m| m.is_file()),
        store: store_url(&id).is_some(),
        browser,
        folder,
    }
}

/// Opens the store listing in the user's default browser, or returns what's needed to add it by hand.
pub fn add(folder: Option<String>) -> Result<AddOutcome, String> {
    let browser = default_browser().ok_or("Couldn't find your default browser.")?;
    if !is_supported(&browser.id) {
        return Err(format!("The HyperStream extension works in Chrome, Edge and Brave, not in {} yet.", browser.name));
    }
    match store_url(&browser.id) {
        Some(url) => {
            open_in(&browser, &url)?;
            Ok(AddOutcome { mode: "store".into(), folder: None, extensions_page: None })
        }
        // Browsers refuse to open their internal pages (chrome://…) for other programs:
        // the user opens the extensions page and loads the folder by hand.
        None => {
            if folder.is_none() {
                return Err("The extension folder is missing. Reinstall HyperStream.".into());
            }
            let scheme = match browser.id.as_str() {
                "edge" => "edge",
                "brave" => "brave",
                "vivaldi" => "vivaldi",
                _ => "chrome",
            };
            Ok(AddOutcome { mode: "manual".into(), folder, extensions_page: Some(format!("{}://extensions", scheme)) })
        }
    }
}

fn open_in(browser: &BrowserInfo, url: &str) -> Result<(), String> {
    let exe = browser.exe.clone().ok_or_else(|| format!("Couldn't start {}.", browser.name))?;
    std::process::Command::new(exe).arg(url).spawn().map(|_| ()).map_err(|e| format!("Couldn't start {}: {}", browser.name, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prog_ids_map_to_browsers() {
        assert_eq!(browser_from_prog_id("ChromeHTML").id, "chrome");
        assert_eq!(browser_from_prog_id("MSEdgeHTM").id, "edge");
        assert_eq!(browser_from_prog_id("BraveHTML").id, "brave");
        assert_eq!(browser_from_prog_id("FirefoxURL-308046B0AF4A39CB").id, "firefox");
        assert_eq!(browser_from_prog_id("SomethingElse").id, "other");
        assert!(!is_supported("firefox") && is_supported("edge"));
    }

    #[test]
    fn helper_parent_names_map_to_browsers() {
        assert_eq!(browser_id_from_exe("chrome.exe"), "chrome");
        assert_eq!(browser_id_from_exe("MSEDGE.EXE"), "edge");
        assert_eq!(browser_id_from_exe("thorium.exe"), "chromium");
    }

    #[test]
    fn store_links_need_a_listing() {
        if CHROME_STORE_ID.is_none() && EDGE_STORE_ID.is_none() {
            assert_eq!(store_url("chrome"), None);
            assert_eq!(store_url("edge"), None);
        }
    }
}
