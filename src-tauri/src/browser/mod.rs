//! The built-in browser: one WebView2 child view inside the main window, with its own profile
//! (sign-ins persist and are reused for downloads), Shields and extensions.

pub mod extensions;
mod native;
mod package;
#[cfg(debug_assertions)]
pub mod selftest;
pub mod site_icon;
mod shields;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager};

pub const LABEL: &str = "in_app_browser";

static SHIELDS_SCRIPT: &str = include_str!("../shields_script.js");

/// `%LOCALAPPDATA%\com.hyperstream.desktop`
pub fn data_root() -> PathBuf {
    let root = std::env::var("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("com.hyperstream.desktop"))
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&root);
    root
}

pub fn extensions_dir() -> PathBuf {
    let dir = data_root().join("browser_extensions");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn profile_dir() -> PathBuf {
    let dir = data_root().join("browser_profile");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Archives often wrap the extension in one top-level folder; the browser needs manifest.json at the root.
pub(crate) fn hoist_single_subfolder(dir: &Path) -> Result<(), String> {
    if dir.join("manifest.json").is_file() {
        return Ok(());
    }
    let subdirs: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir())
        .collect();
    if subdirs.len() != 1 || !subdirs[0].path().join("manifest.json").is_file() {
        return Err("The package doesn't contain a browser extension.".into());
    }
    let inner = subdirs[0].path();
    for entry in std::fs::read_dir(&inner).map_err(|e| e.to_string())?.flatten() {
        std::fs::rename(entry.path(), dir.join(entry.file_name())).map_err(|e| e.to_string())?;
    }
    std::fs::remove_dir(&inner).map_err(|e| e.to_string())
}

pub(crate) fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)?.flatten() {
        let target = dest.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub struct BrowserState {
    /// Where the page sits in the window (logical pixels), as last reported by the UI.
    pub bounds: Mutex<tauri::Rect>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            bounds: Mutex::new(tauri::Rect {
                position: tauri::Position::Logical(tauri::LogicalPosition::new(280.0, 96.0)),
                size: tauri::Size::Logical(tauri::LogicalSize::new(960.0, 640.0)),
            }),
        }
    }
}

/// A video on the page is full screen: the page covers the whole window.
static PAGE_FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// The UI wants the page shown (it may not exist yet when the first page is requested).
static WANT_VISIBLE: AtomicBool = AtomicBool::new(false);
static CREATE_LOCK: Mutex<()> = Mutex::new(());
/// Bumped on every show/hide so a pending unload only applies to the latest hide.
static VISIBILITY_GEN: AtomicU64 = AtomicU64::new(0);
/// After this long away, the browser is shut down completely (its processes and memory are freed).
/// The page comes back when the Browser tab is opened again. PCs with 4 GB of RAM or less get the
/// memory back after a minute; elsewhere five minutes keeps quick returns instant.
fn unload_after() -> std::time::Duration {
    let default = if is_low_memory_pc() { 60 } else { 300 };
    let secs = std::env::var("HYPERSTREAM_BROWSER_UNLOAD_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(default);
    std::time::Duration::from_secs(secs)
}

pub(crate) fn is_low_memory_pc() -> bool {
    total_ram_gb().is_some_and(|gb| gb <= 4.5)
}
/// The page that was open when the browser was unloaded.
static PARKED_URL: Mutex<Option<tauri::Url>> = Mutex::new(None);

fn webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview(LABEL)
}

fn current_rect(app: &AppHandle) -> tauri::Rect {
    if PAGE_FULLSCREEN.load(Ordering::Relaxed) {
        if let Some(size) = app.get_window("main").and_then(|w| w.inner_size().ok()) {
            return tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: tauri::Size::Physical(size),
            };
        }
    }
    app.state::<BrowserState>().bounds.lock().map(|b| *b).unwrap_or_else(|_| BrowserState::default().bounds.into_inner().unwrap())
}

fn apply_bounds(app: &AppHandle) {
    if let Some(w) = webview(app) {
        let _ = w.set_bounds(current_rect(app));
    }
}

/// The app's own interface runs lean while the window is minimized and returns to normal on restore.
pub(crate) fn on_main_minimized(app: &AppHandle, minimized: bool) {
    static WAS_MINIMIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if WAS_MINIMIZED.swap(minimized, std::sync::atomic::Ordering::Relaxed) == minimized {
        return;
    }
    if let Some(ui) = app.get_webview("main") {
        native::set_memory_target(&ui, minimized);
    }
}

pub(crate) fn on_window_resized(app: &AppHandle) {
    if PAGE_FULLSCREEN.load(Ordering::Relaxed) {
        apply_bounds(app);
    }
}

pub(crate) fn set_page_fullscreen(app: &AppHandle, on: bool) {
    if PAGE_FULLSCREEN.swap(on, Ordering::Relaxed) == on {
        return;
    }
    if let Some(window) = app.get_window("main") {
        let _ = window.set_fullscreen(on);
    }
    apply_bounds(app);
    let _ = app.emit("browser-fullscreen", on);
}

fn shields_page_script() -> String {
    format!("{}\n{}", shields::page_script_config(), SHIELDS_SCRIPT)
}

static UNINSTALL_SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

pub fn suppress_uninstall_popups(duration_secs: u64) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    UNINSTALL_SUPPRESS_UNTIL_MS.store(now + duration_secs * 1000, Ordering::SeqCst);
}

pub fn is_uninstall_popup_suppressed(url: &tauri::Url) -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let in_suppression_window = now < UNINSTALL_SUPPRESS_UNTIL_MS.load(Ordering::Relaxed);
    let url_str = url.as_str().to_lowercase();
    in_suppression_window || url_str.contains("uninstall") || url_str.contains("farewell")
}

/// Creates the browser view once, hidden, at about:blank (so Back from the first page returns to the start page).
fn create(app: &AppHandle, rect: tauri::Rect) -> Result<tauri::Webview, String> {
    let _guard = CREATE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(existing) = webview(app) {
        return Ok(existing);
    }
    let window = app.get_window("main").ok_or("The main window isn't available.")?;
    let app_for_popups = app.clone();
    let builder = tauri::webview::WebviewBuilder::new(LABEL, tauri::WebviewUrl::External("about:blank".parse().unwrap()))
        .browser_extensions_enabled(true)
        .data_directory(profile_dir())
        .additional_browser_args(&browser_args())
        .on_new_window(move |url, features| {
            // Block uninvited extension farewell / uninstall survey popups
            if is_uninstall_popup_suppressed(&url) {
                log::info!("Blocked extension farewell/uninstall popup: {url}");
                return tauri::webview::NewWindowResponse::Deny;
            }

            // Sign-in popups (sized windows that talk back to the page) open as real popups;
            // plain "open in new tab" links open here, since the browser has one tab.
            if features.size().is_some() {
                return match open_popup(&app_for_popups, features) {
                    Some(window) => tauri::webview::NewWindowResponse::Create { window },
                    None => tauri::webview::NewWindowResponse::Deny,
                };
            }
            if matches!(url.scheme(), "http" | "https") {
                let _ = app_for_popups.emit("browser-open-tab", url.to_string());
            }
            tauri::webview::NewWindowResponse::Deny
        });
    let created = window.add_child(builder, rect.position, rect.size).map_err(|e| e.to_string())?;
    let _ = created.hide();
    native::attach(app, &created);
    native::set_page_script(&created, shields_page_script());
    Ok(created)
}

/// Engine flags for the browser. Keeps WebView2's defaults (no mini menu or SmartScreen),
/// caps page processes, and turns on Chromium's low-memory mode on PCs with 4 GB of RAM or less.
fn browser_args() -> String {
    let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=4");
    if is_low_memory_pc() {
        args.push_str(" --enable-low-end-device-mode");
    }
    args
}

#[cfg(windows)]
fn total_ram_gb() -> Option<f64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    (unsafe { GlobalMemoryStatusEx(&mut status) } != 0).then(|| status.ullTotalPhys as f64 / 1_073_741_824.0)
}

#[cfg(not(windows))]
fn total_ram_gb() -> Option<f64> {
    None
}

/// A site's popup (e.g. "Sign in with Google") as a HyperStream window owned by the main window,
/// sharing the browser's session. Closing the app closes it too.
fn open_popup(app: &AppHandle, features: tauri::webview::NewWindowFeatures) -> Option<tauri::WebviewWindow> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let label = format!("browser-popup-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let main = app.get_window("main")?;
    let mut builder = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External("about:blank".parse().ok()?))
        .window_features(features)
        // The opener's WebView2 environment (profile, extensions) comes with the features.
        .title("HyperStream")
        .theme(Some(tauri::Theme::Dark))
        .min_inner_size(320.0, 240.0)
        .on_document_title_changed(|window, title| {
            let title = title.trim();
            let _ = window.set_title(if title.is_empty() { "HyperStream" } else { title });
        });
    #[cfg(windows)]
    if let Ok(hwnd) = main.hwnd() {
        builder = builder.owner_raw(hwnd);
    }
    let popup = builder.build().map_err(|e| log::warn!("Popup window failed: {e}")).ok()?;
    // Sites rarely say where to put it; center it over HyperStream so it's never off-screen.
    if let (Ok(pos), Ok(size), Ok(own)) = (main.outer_position(), main.outer_size(), popup.outer_size()) {
        let x = pos.x + (size.width as i32 - own.width as i32) / 2;
        let y = pos.y + ((size.height as i32 - own.height as i32) / 2).max(0);
        let _ = popup.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = popup.set_focus();
    Some(popup)
}

/// The browser view, creating it hidden and off-screen when needed (downloads and the Extensions
/// panel can run before the Browser tab shows a page). Doesn't wait for extensions to load.
pub(crate) fn ensure_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    if let Some(existing) = webview(app) {
        return Ok(existing);
    }
    let offscreen = tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(-4000.0, -4000.0)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(1.0, 1.0)),
    };
    create(app, offscreen)
}

/// For reading saved sign-ins. Must run off the main thread.
/// The browser, for reading the sign-in cookies a download of `url` may need. Starting the browser
/// engine costs hundreds of MB, so it's only woken for sites that were opened in it (only those
/// can hold a sign-in), and a browser woken just for this is unloaded again shortly after.
pub(crate) fn webview_for_cookies(app: &AppHandle, url: &str) -> Option<tauri::Webview> {
    let site = site_key_of_url(url)?;
    let known = load_visited_sites();
    if known.as_ref().is_some_and(|sites| !sites.contains(&site)) {
        return None;
    }
    let was_running = webview(app).is_some();
    let w = ensure_webview(app).ok()?;
    if known.is_none() {
        seed_visited_sites(&w);
    }
    if !was_running {
        release_after_cookie_read(app.clone(), w.clone());
    }
    Some(w)
}

/// Unloads a browser that was only started to read cookies, unless the user opened it meanwhile.
fn release_after_cookie_read(app: AppHandle, w: tauri::Webview) {
    let generation = VISIBILITY_GEN.load(Ordering::Relaxed);
    tauri::async_runtime::spawn(async move {
        // Downloads queued together reuse it; then it goes.
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if VISIBILITY_GEN.load(Ordering::Relaxed) == generation && !WANT_VISIBLE.load(Ordering::Relaxed) {
            unload(&app, &w);
        }
    });
}

// ---------- Sites opened in the built-in browser ----------

static VISITED_SITES: Mutex<Option<std::collections::BTreeSet<String>>> = Mutex::new(None);

fn visited_sites_file() -> PathBuf {
    data_root().join("browser_sites.json")
}

/// None until the list exists (first run after an update: the profile's cookies seed it once).
fn load_visited_sites() -> Option<std::collections::BTreeSet<String>> {
    let mut cache = VISITED_SITES.lock().ok()?;
    if cache.is_none() {
        let bytes = std::fs::read(visited_sites_file()).ok()?;
        *cache = serde_json::from_slice(&bytes).ok();
    }
    cache.clone()
}

fn save_visited_sites(sites: &std::collections::BTreeSet<String>) {
    if let Ok(bytes) = serde_json::to_vec(sites) {
        let _ = std::fs::write(visited_sites_file(), bytes);
    }
}

/// Records a page the browser showed.
pub(crate) fn remember_visit(url: &str) {
    let Some(key) = site_key_of_url(url) else { return };
    let Ok(mut cache) = VISITED_SITES.lock() else { return };
    let sites = cache.get_or_insert_with(|| {
        std::fs::read(visited_sites_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    });
    if sites.insert(key) {
        save_visited_sites(sites);
    }
}

/// Existing profiles: every site that already has a cookie counts as visited.
fn seed_visited_sites(w: &tauri::Webview) {
    let mut sites: std::collections::BTreeSet<String> = w
        .cookies()
        .unwrap_or_default()
        .iter()
        .filter_map(|c| c.domain().map(|d| site_key(d.trim_start_matches('.'))))
        .collect();
    if let Ok(mut cache) = VISITED_SITES.lock() {
        if let Some(existing) = cache.as_ref() {
            sites.extend(existing.iter().cloned());
        }
        save_visited_sites(&sites);
        *cache = Some(sites);
    }
}

pub(crate) fn site_key_of_url(url: &str) -> Option<String> {
    let parsed: tauri::Url = url.parse().ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    Some(site_key(parsed.host_str()?))
}

/// Registrable domain ("m.youtube.com" → "youtube.com", "bbc.co.uk" stays), with short-link
/// domains mapped to the site whose sign-in they use.
pub(crate) fn site_key(host: &str) -> String {
    const SECOND_LEVEL: &[&str] = &["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go"];
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    let keep = if labels.len() >= 3 && labels[labels.len() - 1].len() == 2 && SECOND_LEVEL.contains(&labels[labels.len() - 2]) {
        3
    } else {
        2
    };
    let key = labels[labels.len().saturating_sub(keep)..].join(".");
    match key.as_str() {
        "youtu.be" => "youtube.com".into(),
        "twitter.com" => "x.com".into(),
        "instagr.am" => "instagram.com".into(),
        "fb.watch" | "fb.com" => "facebook.com".into(),
        _ => key,
    }
}

// ---------- Commands ----------

#[derive(serde::Deserialize, Clone, Copy, Debug)]
pub struct BrowserBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl BrowserBounds {
    fn to_rect(self) -> Option<tauri::Rect> {
        (self.width >= 10 && self.height >= 10).then(|| tauri::Rect {
            position: tauri::Position::Logical(tauri::LogicalPosition::new(self.x as f64, self.y as f64)),
            size: tauri::Size::Logical(tauri::LogicalSize::new(self.width as f64, self.height as f64)),
        })
    }
}

#[tauri::command]
pub fn set_browser_visibility(app: AppHandle, visible: bool, pause_media: Option<bool>) -> Result<(), String> {
    WANT_VISIBLE.store(visible, Ordering::Relaxed);
    let generation = VISIBILITY_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    if visible {
        // The browser may have been unloaded (or recreated empty by a prewarm) while away.
        restore_parked(app.clone());
    }
    let Some(w) = webview(&app) else { return Ok(()) };
    if visible {
        native::put_is_suspended(&w, false);
        apply_bounds(&app);
        let _ = w.show();
    } else {
        // A hidden page is silent and paused; nothing plays in the background.
        let _ = pause_media;
        let _ = w.eval("try { document.querySelectorAll('video, audio').forEach(el => el.pause()); } catch (e) {}");
        native::set_muted(&w, true);
        let _ = w.hide();
        native::put_is_suspended(&w, true);
        if PAGE_FULLSCREEN.load(Ordering::Relaxed) {
            set_page_fullscreen(&app, false);
        }
        #[cfg(target_os = "windows")]
        crate::trim_working_set_if_idle();
        tauri::async_runtime::spawn(async move {
            let still_hidden = || VISIBILITY_GEN.load(Ordering::Relaxed) == generation && !WANT_VISIBLE.load(Ordering::Relaxed);
            tokio::time::sleep(unload_after()).await;
            if still_hidden() {
                unload(&app, &w);
            }
        });
    }
    Ok(())
}

/// Shuts the browser down, remembering its page. Skipped while a sign-in popup is open.
fn unload(app: &AppHandle, w: &tauri::Webview) {
    if app.webview_windows().keys().any(|label| label.starts_with("browser-popup-")) {
        return;
    }
    let url = w.url().ok().filter(|u| matches!(u.scheme(), "http" | "https"));
    if let Ok(mut parked) = PARKED_URL.lock() {
        *parked = url;
    }
    let _ = w.close();
    #[cfg(target_os = "windows")]
    crate::trim_working_set_if_idle();
    log::info!("Browser unloaded after being hidden");
}

/// Reopens the page the browser had before it was unloaded.
fn restore_parked(app: AppHandle) {
    let Some(url) = PARKED_URL.lock().ok().and_then(|mut p| p.take()) else { return };
    tauri::async_runtime::spawn(async move {
        let Ok(w) = extensions::ready_webview(&app).await else { return };
        let _ = w.navigate(url);
        apply_bounds(&app);
        if WANT_VISIBLE.load(Ordering::Relaxed) {
            let _ = w.show();
        }
    });
}

#[tauri::command]
pub fn update_browser_bounds(app: AppHandle, state: tauri::State<BrowserState>, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    if let Some(rect) = (BrowserBounds { x, y, width, height }).to_rect() {
        if let Ok(mut b) = state.bounds.lock() {
            *b = rect;
        }
        apply_bounds(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn navigate_browser(app: AppHandle, state: tauri::State<'_, BrowserState>, url: String, bounds: Option<BrowserBounds>) -> Result<(), String> {
    if let Some(rect) = bounds.and_then(BrowserBounds::to_rect) {
        if let Ok(mut b) = state.bounds.lock() {
            *b = rect;
        }
    }
    let target: tauri::Url = if url.trim().is_empty() { "about:blank".parse().unwrap() } else { url.parse().map_err(|_| "That address isn't valid.".to_string())? };
    if !matches!(target.scheme(), "http" | "https" | "about" | "chrome-extension") {
        return Err("That kind of address can't be opened here.".into());
    }
    if target.as_str() == "about:blank" {
        if let Some(w) = webview(&app) {
            let _ = w.eval("try { document.querySelectorAll('video, audio').forEach(el => el.pause()); } catch (e) {}");
            let _ = w.navigate(target);
            let _ = w.hide();
        }
        return Ok(());
    }
    if let Ok(mut parked) = PARKED_URL.lock() {
        *parked = None;
    }
    // Extensions load before the first page so their content scripts apply to it.
    let w = extensions::ready_webview(&app).await?;
    w.navigate(target).map_err(|e| e.to_string())?;
    apply_bounds(&app);
    if WANT_VISIBLE.load(Ordering::Relaxed) {
        let _ = w.show();
    }
    Ok(())
}

/// Starts the browser engine (and extensions) in the background while the start page is
/// showing, so the first site opens instantly. Does nothing once it's running.
#[tauri::command]
pub async fn prewarm_browser(app: AppHandle) -> Result<(), String> {
    let started = std::time::Instant::now();
    let fresh = webview(&app).is_none();
    extensions::ready_webview(&app).await?;
    if fresh {
        log::info!("Browser ready in {} ms", started.elapsed().as_millis());
    }
    Ok(())
}

#[tauri::command]
pub fn browser_go_back(app: AppHandle) {
    if let Some(w) = webview(&app) {
        native::go_back(&w);
    }
}

#[tauri::command]
pub fn browser_go_forward(app: AppHandle) {
    if let Some(w) = webview(&app) {
        native::go_forward(&w);
    }
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) {
    if let Some(w) = webview(&app) {
        let _ = w.reload();
    }
}

#[tauri::command]
pub fn browser_stop(app: AppHandle) {
    if let Some(w) = webview(&app) {
        native::stop(&w);
    }
}

#[tauri::command]
pub fn get_browser_zoom() -> f64 {
    native::get_zoom_factor()
}

#[tauri::command]
pub fn set_browser_zoom(app: AppHandle, factor: f64) {
    if let Some(w) = webview(&app) {
        native::set_zoom_factor(&w, factor);
    }
}

#[tauri::command]
pub fn browser_find_in_page(app: AppHandle, query: String, backwards: bool) -> Result<(), String> {
    let Some(w) = webview(&app) else { return Ok(()) };
    let escaped = serde_json::to_string(&query).unwrap_or_default();
    let code = format!("try {{ window.find({escaped}, false, {backwards}, true, false, false, false); }} catch(e) {{}}");
    let _ = w.eval(code);
    Ok(())
}

/// Latest navigation state (the UI asks when it mounts; later changes arrive as `browser-state`).
#[tauri::command]
pub fn browser_state() -> Option<native::NavState> {
    native::last_state()
}

/// A picture of the page, shown behind app panels while the page itself is hidden.
#[tauri::command]
pub async fn browser_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    let Some(w) = webview(&app) else { return Ok(None) };
    let jpeg = native::capture_jpeg(&w).await?;
    if jpeg.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg))))
}

/// Shields on/off, plus sites where the user turned them off.
#[tauri::command]
pub fn browser_set_shields(app: AppHandle, enabled: bool, allowed_sites: Vec<String>) {
    shields::configure(enabled, &allowed_sites);
    let Some(w) = webview(&app) else { return };
    native::set_page_script(&w, shields_page_script());
    let host = native::last_state()
        .and_then(|s| tauri::Url::parse(&s.url).ok())
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();
    let on = shields::active_for(&host);
    let _ = w.eval(format!("window.__HYPERSTREAM_SHIELDS__ && window.__HYPERSTREAM_SHIELDS__.set({on})"));
}

/// How many ad/tracker requests Shields blocked on the current page.
#[tauri::command]
pub fn browser_shields_stats() -> u32 {
    native::blocked_on_page()
}

/// Signs out of every site in the built-in browser and removes its cache and history.
#[tauri::command]
pub async fn clear_browsing_data(app: AppHandle) -> Result<(), String> {
    let webview = ensure_webview(&app)?;
    native::clear_browsing_data(&webview).await?;
    // Reload so the page reflects the signed-out state.
    if WANT_VISIBLE.load(Ordering::Relaxed) {
        let _ = webview.eval("location.reload()");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_installed_extensions(app: AppHandle) -> Result<Vec<extensions::ExtensionInfo>, String> {
    // Loading the browser reports extensions it can't run.
    extensions::ready_webview(&app).await?;
    Ok(tauri::async_runtime::spawn_blocking(extensions::list).await.map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn install_store_extension(app: AppHandle, input: String) -> Result<String, String> {
    extensions::install_from_store(&app, &input).await
}

#[tauri::command]
pub async fn uninstall_browser_extension(app: AppHandle, extension_id: String) -> Result<(), String> {
    extensions::uninstall(&app, &extension_id).await
}

#[tauri::command]
pub async fn set_extension_enabled(app: AppHandle, extension_id: String, enabled: bool) -> Result<(), String> {
    extensions::set_enabled(&app, &extension_id, enabled).await
}

#[tauri::command]
pub async fn load_unpacked_extension(app: AppHandle, source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }
    extensions::install_from_folder(&app, &src).await
}

#[tauri::command]
pub async fn update_browser_extensions(app: AppHandle) -> Result<u32, String> {
    let webview = extensions::ready_webview(&app).await?;
    extensions::update_all(&webview).await
}

/// chrome-extension:// address of an extension's settings page ("options") or popup.
#[tauri::command]
pub fn extension_page_url(extension_id: String, page: String) -> Result<String, String> {
    extensions::page_url(&extension_id, &page)
}

#[cfg(test)]
mod tests {
    #[test]
    fn site_keys_group_subdomains_and_short_links() {
        use super::site_key;
        assert_eq!(site_key("m.youtube.com"), "youtube.com");
        assert_eq!(site_key("youtu.be"), "youtube.com");
        assert_eq!(site_key("www.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(site_key("twitter.com"), "x.com");
        assert_eq!(site_key("127.0.0.1"), "0.1");
        assert_eq!(site_key("localhost"), "localhost");
    }

    use super::*;

    #[test]
    fn hoists_a_single_wrapper_folder() {
        let root = std::env::temp_dir().join(format!("hs-ext-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let inner = root.join("uBlock0.chromium");
        std::fs::create_dir_all(inner.join("js")).unwrap();
        std::fs::write(inner.join("manifest.json"), "{}").unwrap();
        std::fs::write(inner.join("js").join("a.js"), "").unwrap();

        hoist_single_subfolder(&root).unwrap();
        assert!(root.join("manifest.json").is_file());
        assert!(root.join("js").join("a.js").is_file());
        assert!(!inner.exists());

        // Already flat: no-op.
        hoist_single_subfolder(&root).unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_archives_without_a_manifest() {
        let root = std::env::temp_dir().join(format!("hs-ext-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        assert!(hoist_single_subfolder(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
