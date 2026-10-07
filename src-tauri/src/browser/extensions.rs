//! Browser extensions: install from the Chrome Web Store, Edge Add-ons or a folder, then turn on/off,
//! remove and update them while the browser is running.
//!
//! Each extension is an unpacked folder in `browser_extensions/`. `browser_extensions.json` remembers
//! where it came from, whether it's on, and the id WebView2 gave it.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::{native, package};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    Chrome,
    Edge,
}

impl Store {
    fn label(self) -> &'static str {
        match self {
            Store::Chrome => "Chrome Web Store",
            Store::Edge => "Edge Add-ons",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    runtime_id: Option<String>,
    #[serde(default)]
    store: Option<Store>,
    #[serde(default)]
    store_id: Option<String>,
}

fn enabled_by_default() -> bool {
    true
}

impl Default for Record {
    fn default() -> Self {
        Self { enabled: true, runtime_id: None, store: None, store_id: None }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    extensions: BTreeMap<String, Record>,
    /// Unix seconds of the last automatic update check.
    #[serde(default)]
    last_update_check: u64,
}

/// What the Extensions panel shows for one installed extension.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    /// Folder name; stable across updates.
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    /// data: URL of the extension's icon.
    pub icon: Option<String>,
    pub has_options: bool,
    pub has_popup: bool,
    pub store: Option<Store>,
    pub store_id: Option<String>,
    pub homepage: Option<String>,
    /// Why the browser couldn't load it, if it couldn't.
    pub error: Option<String>,
    /// Manifest V2: an older format current browsers are phasing out.
    pub legacy_format: bool,
}

/// Folders created by earlier versions (GitHub builds) and the store listing they correspond to.
const LEGACY_FOLDERS: &[(&str, &str)] = &[
    ("adguard", "bgnkhhnnamicmpeenaelnjfhikgbkllg"),
    ("sponsorblock", "mnjggcdmjocbbbhaepdhchncahnbgone"),
    ("dark-reader", "eimadpbcbfnmbkopoojfekhnkhdbieeh"),
    ("return-dislike", "gebbhagfogifgggkldgodflihgfeippi"),
];

static STATE_LOCK: Mutex<()> = Mutex::new(());
static LOAD_ERRORS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static SYNCED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
/// One install/remove/update at a time.
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn state_path() -> PathBuf {
    super::data_root().join("browser_extensions.json")
}

fn load_state() -> State {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(state: &State) {
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let path = state_path();
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> T {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut state = load_state();
    let out = f(&mut state);
    save_state(&state);
    out
}

fn set_error(folder: &str, error: Option<String>) {
    let mut errors = LOAD_ERRORS.lock().unwrap_or_else(|p| p.into_inner());
    let map = errors.get_or_insert_with(HashMap::new);
    match error {
        Some(e) => {
            map.insert(folder.to_string(), e);
        }
        None => {
            map.remove(folder);
        }
    }
}

fn load_error(folder: &str) -> Option<String> {
    LOAD_ERRORS.lock().ok()?.as_ref()?.get(folder).cloned()
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Extension ids become folder names, so keep them to a safe character set.
pub fn is_safe_folder_name(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn installed_folders() -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = std::fs::read_dir(super::extensions_dir())
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().join("manifest.json").is_file())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    is_safe_folder_name(&name).then(|| (name, e.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

// ---------- Manifest ----------

struct Manifest {
    name: String,
    version: String,
    description: String,
    manifest_version: u64,
    icon: Option<String>,
    options_page: Option<String>,
    popup: Option<String>,
    homepage: Option<String>,
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Resolves `__MSG_key__` placeholders from `_locales`.
fn localize(dir: &Path, default_locale: Option<&str>, value: &str) -> String {
    let Some(key) = value.strip_prefix("__MSG_").and_then(|v| v.strip_suffix("__")) else {
        return value.to_string();
    };
    let locales = [default_locale.unwrap_or("en"), "en", "en_US"];
    for locale in locales {
        if let Some(serde_json::Value::Object(messages)) = read_json(&dir.join("_locales").join(locale).join("messages.json")) {
            if let Some((_, entry)) = messages.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)) {
                if let Some(message) = entry.get("message").and_then(|m| m.as_str()) {
                    return message.to_string();
                }
            }
        }
    }
    value.to_string()
}

fn icon_data_url(dir: &Path, manifest: &serde_json::Value) -> Option<String> {
    let pick = |icons: &serde_json::Value| -> Option<String> {
        if let Some(path) = icons.as_str() {
            return Some(path.to_string());
        }
        let mut sizes: Vec<(u32, String)> = icons
            .as_object()?
            .iter()
            .filter_map(|(size, path)| Some((size.parse().ok()?, path.as_str()?.to_string())))
            .collect();
        sizes.sort_by_key(|(s, _)| *s);
        // Prefer crisp icon (48px or larger, else largest available) for high-DPI displays
        sizes
            .iter()
            .find(|(s, _)| *s >= 48)
            .or_else(|| sizes.last())
            .map(|(_, p)| p.clone())
    };
    let relative = manifest
        .get("icons")
        .and_then(pick)
        .or_else(|| {
            ["action", "browser_action", "page_action", "sidebar_action"]
                .iter()
                .find_map(|k| manifest.get(k)?.get("default_icon").and_then(pick))
        })?;

    // Normalize path separators and strip leading relative prefixes to avoid Windows drive-root jumps
    let clean_relative = relative.replace('\\', "/");
    let clean_relative = clean_relative
        .trim_start_matches("./")
        .trim_start_matches('/');
    let path = dir.join(clean_relative);
    let bytes = std::fs::read(&path).ok().filter(|b| b.len() < 1024 * 1024)?;
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        _ => return None,
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    let json = read_json(&dir.join("manifest.json"))?;
    let default_locale = json.get("default_locale").and_then(|v| v.as_str());
    let text = |key: &str| json.get(key).and_then(|v| v.as_str()).map(|v| localize(dir, default_locale, v));
    let popup = ["action", "browser_action", "page_action"]
        .iter()
        .find_map(|k| json.get(k)?.get("default_popup")?.as_str())
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    let options_page = json
        .get("options_ui")
        .and_then(|o| o.get("page"))
        .or_else(|| json.get("options_page"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(Manifest {
        name: text("name").unwrap_or_default(),
        version: json.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        description: text("description").unwrap_or_default(),
        manifest_version: json.get("manifest_version").and_then(|v| v.as_u64()).unwrap_or(0),
        icon: icon_data_url(dir, &json),
        options_page,
        popup,
        homepage: json.get("homepage_url").and_then(|v| v.as_str()).map(str::to_string),
    })
}

fn info_for(folder: &str, dir: &Path, record: &Record) -> Option<ExtensionInfo> {
    let manifest = read_manifest(dir)?;
    Some(ExtensionInfo {
        id: folder.to_string(),
        name: if manifest.name.is_empty() { folder.to_string() } else { manifest.name },
        version: manifest.version,
        description: manifest.description,
        enabled: record.enabled,
        icon: manifest.icon,
        has_options: manifest.options_page.is_some(),
        has_popup: manifest.popup.is_some(),
        store: record.store,
        store_id: record.store_id.clone(),
        homepage: manifest.homepage,
        error: load_error(folder),
        legacy_format: manifest.manifest_version == 2,
    })
}

/// Makes a freshly unpacked folder loadable: removes store metadata (Chromium refuses folders
/// starting with "_" other than _locales) and pins the store id via the developer key.
fn prepare_folder(dir: &Path, public_key: Option<&[u8]>) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dir.join("_metadata"));
    super::hoist_single_subfolder(dir)?;
    let manifest_path = dir.join("manifest.json");
    let mut json = read_json(&manifest_path).ok_or("The extension's manifest.json can't be read.")?;
    match json.get("manifest_version").and_then(|v| v.as_u64()) {
        Some(2) | Some(3) => {}
        _ => return Err("This isn't a supported browser extension.".into()),
    }
    if let (Some(key), Some(obj)) = (public_key, json.as_object_mut()) {
        if !obj.contains_key("key") {
            obj.insert("key".into(), base64::engine::general_purpose::STANDARD.encode(key).into());
            let text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
            std::fs::write(&manifest_path, text).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Moves `staging` into place at `target`. Returns the previous version's backup folder, if any.
fn swap_into_place(staging: &Path, target: &Path) -> Result<Option<PathBuf>, String> {
    let backup = if target.exists() {
        let backup = staging.with_extension("previous");
        let _ = std::fs::remove_dir_all(&backup);
        std::fs::rename(target, &backup)
            .map_err(|_| "The extension's files are in use. Restart HyperStream and try again.".to_string())?;
        Some(backup)
    } else {
        None
    };
    if let Err(e) = std::fs::rename(staging, target) {
        if let Some(b) = &backup {
            let _ = std::fs::rename(b, target);
        }
        return Err(format!("Couldn't install the extension: {e}"));
    }
    Ok(backup)
}

fn restore_backup(target: &Path, backup: Option<PathBuf>) {
    let _ = std::fs::remove_dir_all(target);
    if let Some(b) = backup {
        let _ = std::fs::rename(b, target);
    }
}

fn staging_dir(name: &str) -> PathBuf {
    let dir = super::data_root().join("extension_staging");
    let _ = std::fs::create_dir_all(&dir);
    dir.join(name)
}

// ---------- Stores ----------

/// Accepts a Chrome Web Store / Edge Add-ons link or a bare 32-letter extension id.
pub fn parse_store_input(input: &str) -> Option<(Option<Store>, String)> {
    let input = input.trim();
    if package::is_store_id(input) {
        return Some((None, input.to_string()));
    }
    let with_scheme = if input.contains("://") { input.to_string() } else { format!("https://{input}") };
    let url = tauri::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let store = match host.as_str() {
        "chromewebstore.google.com" | "chrome.google.com" => Store::Chrome,
        "microsoftedge.microsoft.com" => Store::Edge,
        _ => return None,
    };
    let id = url
        .path_segments()?
        .find(|s| package::is_store_id(s))
        .map(str::to_string)
        .or_else(|| url.query_pairs().find(|(k, v)| k == "id" && package::is_store_id(v)).map(|(_, v)| v.to_string()))?;
    Some((Some(store), id))
}

fn browser_version() -> String {
    tauri::webview_version().unwrap_or_else(|_| "140.0.0.0".into())
}

fn crx_url(store: Store, id: &str) -> String {
    match store {
        Store::Chrome => format!(
            "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion={}&x=id%3D{id}%26installsource%3Dondemand%26uc",
            browser_version()
        ),
        Store::Edge => format!(
            "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D{id}%26installsource%3Dondemand%26uc"
        ),
    }
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

async fn download_package(store: Store, id: &str) -> Result<Vec<u8>, String> {
    let not_found = || format!("That extension isn't available in the {}.", store.label());
    let response = http()?
        .get(crx_url(store, id))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the {}: {e}", store.label()))?;
    if !response.status().is_success() {
        return Err(not_found());
    }
    let bytes = response.bytes().await.map_err(|e| format!("The download was interrupted: {e}"))?;
    if !(bytes.starts_with(b"Cr24") || bytes.starts_with(b"PK\x03\x04")) {
        return Err(not_found());
    }
    Ok(bytes.to_vec())
}

/// Newest version the Chrome Web Store offers, without downloading the package.
async fn chrome_latest_version(id: &str) -> Option<String> {
    let url = format!(
        "https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion={}&x=id%3D{id}%26uc",
        browser_version()
    );
    let xml = http().ok()?.get(url).send().await.ok()?.text().await.ok()?;
    let check = xml.split("<updatecheck").nth(1)?;
    let start = check.find(" version=\"")? + 10;
    let version = &check[start..];
    Some(version[..version.find('"')?].to_string())
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (a, b) = (parse(candidate), parse(current));
    (0..a.len().max(b.len())).map(|i| (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0))).find(|(x, y)| x != y).is_some_and(|(x, y)| x > y)
}

// ---------- Loading into the browser ----------

/// Loads a folder into the running browser and records the id it got.
async fn load_folder(webview: &tauri::Webview, folder: &str, dir: &Path) -> Result<(), String> {
    let result = native::add_extension(webview, dir.to_path_buf()).await;
    match result {
        Ok(ext) => {
            let enabled = with_state(|s| {
                let record = s.extensions.entry(folder.to_string()).or_default();
                record.runtime_id = Some(ext.id.clone());
                record.enabled
            });
            if ext.enabled != enabled {
                native::enable_extension(webview, &ext.id, enabled).await?;
            }
            set_error(folder, None);
            Ok(())
        }
        Err(e) => {
            set_error(folder, Some(e.clone()));
            Err(e)
        }
    }
}

/// Loads every installed extension into a newly created browser and drops leftovers.
async fn sync(webview: &tauri::Webview) {
    let folders = installed_folders();

    // Records for folders that no longer exist; adopt folders from older versions.
    with_state(|s| {
        s.extensions.retain(|name, _| folders.iter().any(|(f, _)| f == name));
        for (legacy, store_id) in LEGACY_FOLDERS {
            if folders.iter().any(|(f, _)| f == legacy) {
                let record = s.extensions.entry(legacy.to_string()).or_default();
                if record.store_id.is_none() {
                    record.store = Some(Store::Chrome);
                    record.store_id = Some(store_id.to_string());
                }
            }
        }
    });

    // Leftovers from folders deleted by older versions are left alone: the profile also holds
    // WebView2's built-in extensions (e.g. the PDF viewer), which must never be removed.
    // The profile remembers extensions between launches, so only ones it doesn't have yet are
    // loaded (re-adding every extension on each start was the slowest part of opening a page).
    let loaded = native::list_extensions(webview).await.unwrap_or_default();
    for (folder, dir) in &folders {
        let known = with_state(|s| s.extensions.get(folder.as_str()).and_then(|r| r.runtime_id.clone().map(|id| (id, r.enabled))));
        if let Some((id, enabled)) = known {
            if let Some(ext) = loaded.iter().find(|e| e.id == id) {
                if ext.enabled != enabled {
                    let _ = native::enable_extension(webview, &id, enabled).await;
                }
                set_error(folder, None);
                continue;
            }
        }
        let _ = std::fs::remove_dir_all(dir.join("_metadata"));
        let _ = load_folder(webview, folder, dir).await;
    }

    let due = now_secs().saturating_sub(load_state().last_update_check) > 24 * 60 * 60;
    if due {
        let webview = webview.clone();
        tauri::async_runtime::spawn(async move {
            let _ = update_all(&webview).await;
        });
    }
}

/// The browser webview with every extension loaded. Creates the browser (hidden) if needed.
pub async fn ready_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    let webview = super::ensure_webview(app)?;
    SYNCED.get_or_init(|| sync(&webview)).await;
    Ok(webview)
}

// ---------- Operations ----------

async fn install_package(webview: &tauri::Webview, store: Store, id: &str, bytes: Vec<u8>) -> Result<(), String> {
    let _op = OPERATION.lock().await;

    let staging = staging_dir(id);
    let key = {
        let staging = staging.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Vec<u8>>, String> {
            let crx = package::parse_crx(&bytes)?;
            if let Some(key) = &crx.public_key {
                if package::extension_id_from_key(key) != id {
                    return Err("The downloaded package doesn't match that extension.".into());
                }
            }
            let _ = std::fs::remove_dir_all(&staging);
            std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
            package::extract_zip(crx.zip, &staging)?;
            Ok(crx.public_key)
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let prepared = key.and_then(|key| prepare_folder(&staging, key.as_deref()));
    if let Err(e) = prepared {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }

    let target = super::extensions_dir().join(id);
    let backup = swap_into_place(&staging, &target)?;
    let previous = with_state(|s| {
        let previous = s.extensions.get(id).cloned();
        let record = s.extensions.entry(id.to_string()).or_default();
        record.store = Some(store);
        record.store_id = Some(id.to_string());
        previous
    });

    match load_folder(webview, id, &target).await {
        Ok(()) => {
            if let Some(b) = backup {
                let _ = std::fs::remove_dir_all(b);
            }
            Ok(())
        }
        Err(e) => {
            // Put back whatever was there before (or nothing).
            let had_previous = backup.is_some();
            restore_backup(&target, backup);
            with_state(|s| match previous {
                Some(p) => {
                    s.extensions.insert(id.to_string(), p);
                }
                None => {
                    s.extensions.remove(id);
                }
            });
            if had_previous {
                let _ = load_folder(webview, id, &target).await;
            } else {
                set_error(id, None);
            }
            Err(e)
        }
    }
}

/// Installs from a store link or id. Tries the Chrome Web Store, then Edge Add-ons, for bare ids.
pub async fn install_from_store(app: &AppHandle, input: &str) -> Result<String, String> {
    super::suppress_extension_popups(app, 30);
    let (store, id) = parse_store_input(input)
        .ok_or("Paste a link to an extension in the Chrome Web Store or Edge Add-ons.")?;
    let (store, bytes) = match store {
        Some(store) => (store, download_package(store, &id).await?),
        None => match download_package(Store::Chrome, &id).await {
            Ok(bytes) => (Store::Chrome, bytes),
            Err(chrome_error) => match download_package(Store::Edge, &id).await {
                Ok(bytes) => (Store::Edge, bytes),
                Err(_) => return Err(chrome_error),
            },
        },
    };
    install_package(&ready_webview(app).await?, store, &id, bytes).await?;
    Ok(id)
}

/// Downloads newer versions of store extensions. Returns how many were updated.
pub async fn update_all(webview: &tauri::Webview) -> Result<u32, String> {
    with_state(|s| s.last_update_check = now_secs());
    let candidates: Vec<(String, Store, String)> = load_state()
        .extensions
        .iter()
        .filter_map(|(folder, r)| Some((folder.clone(), r.store?, r.store_id.clone()?)))
        .collect();
    let mut updated = 0;
    for (folder, store, store_id) in candidates {
        let dir = super::extensions_dir().join(&folder);
        let Some(current) = read_manifest(&dir).map(|m| m.version) else { continue };
        let bytes = match store {
            Store::Chrome => match chrome_latest_version(&store_id).await {
                Some(latest) if version_is_newer(&latest, &current) => download_package(store, &store_id).await.ok(),
                _ => None,
            },
            // Edge doesn't offer a cheap version check; compare the package's manifest instead.
            Store::Edge => download_package(store, &store_id).await.ok().filter(|bytes| {
                package::parse_crx(bytes)
                    .ok()
                    .and_then(|crx| package::zip_entry(crx.zip, "manifest.json"))
                    .and_then(|m| serde_json::from_slice::<serde_json::Value>(&m).ok())
                    .and_then(|m| m.get("version")?.as_str().map(str::to_string))
                    .is_some_and(|v| version_is_newer(&v, &current))
            }),
        };
        let Some(bytes) = bytes else { continue };
        if install_package(webview, store, &store_id, bytes).await.is_ok() {
            if folder != store_id {
                // A legacy folder was replaced by the store copy; remove the old one.
                let _ = uninstall_from(webview, &folder).await;
            }
            updated += 1;
        }
    }
    Ok(updated)
}

pub async fn uninstall(app: &AppHandle, folder: &str) -> Result<(), String> {
    if !is_safe_folder_name(folder) {
        return Err("Unknown extension.".into());
    }
    super::suppress_extension_popups(app, 30);
    uninstall_from(&ready_webview(app).await?, folder).await
}

async fn uninstall_from(webview: &tauri::Webview, folder: &str) -> Result<(), String> {
    let _op = OPERATION.lock().await;
    if let Some(runtime_id) = load_state().extensions.get(folder).and_then(|r| r.runtime_id.clone()) {
        native::remove_extension(webview, &runtime_id).await?;
    }
    let dir = super::extensions_dir().join(folder);
    if dir.exists() && std::fs::remove_dir_all(&dir).is_err() {
        // The browser can hold files for a moment after unloading.
        tokio::time::sleep(Duration::from_millis(500)).await;
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't delete the extension's files: {e}"))?;
    }
    with_state(|s| s.extensions.remove(folder));
    set_error(folder, None);
    Ok(())
}

pub async fn set_enabled(app: &AppHandle, folder: &str, enabled: bool) -> Result<(), String> {
    super::suppress_extension_popups(app, 30);
    let webview = ready_webview(app).await?;
    let _op = OPERATION.lock().await;
    let runtime_id = with_state(|s| {
        let record = s.extensions.entry(folder.to_string()).or_default();
        record.enabled = enabled;
        record.runtime_id.clone()
    });
    match runtime_id {
        Some(id) => native::enable_extension(&webview, &id, enabled).await,
        None => {
            let dir = super::extensions_dir().join(folder);
            load_folder(&webview, folder, &dir).await
        }
    }
}

pub async fn install_from_folder(app: &AppHandle, source: &Path) -> Result<String, String> {
    super::suppress_extension_popups(app, 30);
    if !source.join("manifest.json").is_file() {
        return Err("That folder doesn't contain a manifest.json file.".into());
    }
    let base: String = source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
        .collect::<String>()
        .trim_start_matches('.')
        .chars()
        .take(48)
        .collect();
    let base = if base.is_empty() { "extension".to_string() } else { base };
    let webview = ready_webview(app).await?;
    let _op = OPERATION.lock().await;

    let staging = staging_dir(&base);
    let _ = std::fs::remove_dir_all(&staging);
    super::copy_dir_recursive(source, &staging).map_err(|e| format!("Couldn't copy the extension: {e}"))?;
    if let Err(e) = prepare_folder(&staging, None) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    // Loading the same folder again updates it in place.
    let folder = base;
    let target = super::extensions_dir().join(&folder);
    let backup = swap_into_place(&staging, &target)?;
    match load_folder(&webview, &folder, &target).await {
        Ok(()) => {
            if let Some(b) = backup {
                let _ = std::fs::remove_dir_all(b);
            }
            Ok(folder)
        }
        Err(e) => {
            let had_previous = backup.is_some();
            restore_backup(&target, backup);
            if had_previous {
                let _ = load_folder(&webview, &folder, &target).await;
            } else {
                with_state(|s| s.extensions.remove(&folder));
                set_error(&folder, None);
            }
            Err(e)
        }
    }
}

pub fn list() -> Vec<ExtensionInfo> {
    let state = load_state();
    installed_folders()
        .iter()
        .filter_map(|(folder, dir)| info_for(folder, dir, &state.extensions.get(folder).cloned().unwrap_or_default()))
        .collect()
}

/// chrome-extension:// address of an extension's options page or popup.
pub fn page_url(folder: &str, page: &str) -> Result<String, String> {
    let runtime_id = load_state()
        .extensions
        .get(folder)
        .and_then(|r| r.runtime_id.clone())
        .ok_or("This extension isn't loaded yet.")?;
    let manifest = read_manifest(&super::extensions_dir().join(folder)).ok_or("Unknown extension.")?;
    let path = match page {
        "options" => manifest.options_page,
        _ => manifest.popup,
    }
    .ok_or("This extension has no settings page.")?;
    Ok(format!("chrome-extension://{runtime_id}/{}", path.trim_start_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn understands_store_links_and_ids() {
        assert_eq!(
            parse_store_input("https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh?hl=en"),
            Some((Some(Store::Chrome), "eimadpbcbfnmbkopoojfekhnkhdbieeh".into()))
        );
        assert_eq!(
            parse_store_input("chrome.google.com/webstore/detail/x/eimadpbcbfnmbkopoojfekhnkhdbieeh"),
            Some((Some(Store::Chrome), "eimadpbcbfnmbkopoojfekhnkhdbieeh".into()))
        );
        assert_eq!(
            parse_store_input("https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak"),
            Some((Some(Store::Edge), "odfafepnkmbhccpbejgmiehpchacaeak".into()))
        );
        assert_eq!(parse_store_input("  eimadpbcbfnmbkopoojfekhnkhdbieeh "), Some((None, "eimadpbcbfnmbkopoojfekhnkhdbieeh".into())));
        assert_eq!(parse_store_input("https://example.com/detail/eimadpbcbfnmbkopoojfekhnkhdbieeh"), None);
        assert_eq!(parse_store_input("dark reader"), None);
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(version_is_newer("4.9.133", "4.9.132"));
        assert!(version_is_newer("1.10", "1.9.9"));
        assert!(version_is_newer("2.0", "1.99"));
        assert!(!version_is_newer("1.0", "1.0.0"));
        assert!(!version_is_newer("1.0.1", "1.0.2"));
    }

    #[test]
    fn folder_names_cannot_escape_the_extensions_folder() {
        assert!(is_safe_folder_name("ublock-origin"));
        assert!(is_safe_folder_name("eimadpbcbfnmbkopoojfekhnkhdbieeh"));
        assert!(!is_safe_folder_name(""));
        assert!(!is_safe_folder_name(".."));
        assert!(!is_safe_folder_name(r"..\..\Windows"));
        assert!(!is_safe_folder_name("a/b"));
    }

    #[test]
    fn localizes_names_and_prepares_store_folders() {
        let dir = std::env::temp_dir().join(format!("hs-ext-manifest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("_locales").join("en")).unwrap();
        std::fs::create_dir_all(dir.join("_metadata")).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            "\u{feff}{\"manifest_version\":3,\"name\":\"__MSG_extName__\",\"version\":\"1.2.3\",\"default_locale\":\"en\",\"options_ui\":{\"page\":\"options.html\"},\"action\":{\"default_popup\":\"popup.html\"}}",
        )
        .unwrap();
        std::fs::write(dir.join("_locales").join("en").join("messages.json"), r#"{"extname":{"message":"Dark Reader"}}"#).unwrap();

        prepare_folder(&dir, Some(b"key-bytes")).unwrap();
        assert!(!dir.join("_metadata").exists());
        let manifest = read_manifest(&dir).unwrap();
        assert_eq!(manifest.name, "Dark Reader");
        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(manifest.options_page.as_deref(), Some("options.html"));
        assert_eq!(manifest.popup.as_deref(), Some("popup.html"));
        let json = read_json(&dir.join("manifest.json")).unwrap();
        assert_eq!(json["key"], base64::engine::general_purpose::STANDARD.encode(b"key-bytes"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_manifest_icons_properly() {
        let dir = std::env::temp_dir().join(format!("hs-ext-icon-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("icons")).unwrap();
        std::fs::write(dir.join("icons").join("48.png"), b"\x89PNG\r\n\x1a\nfake-png-data").unwrap();
        let manifest = serde_json::json!({
            "icons": {
                "16": "icons/16.png",
                "48": "icons/48.png"
            }
        });
        let icon = icon_data_url(&dir, &manifest).expect("should produce icon data url");
        assert!(icon.starts_with("data:image/png;base64,"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
