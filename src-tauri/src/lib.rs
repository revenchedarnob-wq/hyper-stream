pub mod bridge;
pub mod extension_setup;
pub mod browser;
pub mod downloader;

use tauri::Manager;
use std::sync::atomic::{AtomicU32, Ordering};

pub static ACTIVE_TRANSFERS: AtomicU32 = AtomicU32::new(0);

#[cfg(target_os = "windows")]
pub fn trim_working_set_if_idle() {
    if ACTIVE_TRANSFERS.load(Ordering::Relaxed) == 0 {
        use windows_sys::Win32::System::ProcessStatus::EmptyWorkingSet;
        use windows_sys::Win32::System::Threading::GetCurrentProcess;
        unsafe {
            EmptyWorkingSet(GetCurrentProcess());
        }
    }
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemVitals {
    /// MB/s across all running downloads.
    pub throughput: f64,
    pub active_transfers: u32,
    pub storage_free_gb: f64,
    pub storage_total_gb: f64,
    pub storage_percentage: u32,
}

/// (free, total) bytes on the volume holding `path` (or its nearest existing parent).
#[cfg(target_os = "windows")]
fn disk_space(path: &std::path::Path) -> Option<(u64, u64)> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        probe = probe.parent()?.to_path_buf();
    }
    let mut wide: Vec<u16> = probe.to_string_lossy().encode_utf16().collect();
    wide.push(0);
    let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    (ok != 0 && total > 0).then_some((free, total))
}

#[cfg(not(target_os = "windows"))]
fn disk_space(_path: &std::path::Path) -> Option<(u64, u64)> {
    None
}

/// Shows a file selected in Explorer, or opens a folder. Falls back to the nearest existing parent.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let p = std::path::Path::new(&path);
        let mut cmd = Command::new("explorer");
        if p.is_file() {
            // explorer needs `/select,"path"` as one raw argument to handle spaces.
            cmd.raw_arg(format!("/select,\"{}\"", path));
        } else {
            let mut dir = p.to_path_buf();
            while !dir.is_dir() {
                match dir.parent() {
                    Some(parent) => dir = parent.to_path_buf(),
                    None => return Err("That folder no longer exists.".to_string()),
                }
            }
            cmd.arg(dir);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_system_vitals(
    state: tauri::State<'_, downloader::DownloadOrchestrator>,
    download_dir: Option<String>,
) -> Result<SystemVitals, String> {
    let mut total_speed_bps = 0u64;
    let mut active_count = 0u32;
    for task in state.get_tasks() {
        if matches!(task.state, downloader::DownloadState::Downloading | downloader::DownloadState::Remuxing) {
            active_count += 1;
            total_speed_bps = total_speed_bps.saturating_add(task.speed_bytes_per_sec);
        }
    }
    let throughput = ((total_speed_bps as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0;

    let dir = download_dir
        .filter(|d| !d.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(downloader::default_download_dir);
    let gb = |b: u64| ((b as f64) / (1024.0 * 1024.0 * 1024.0) * 10.0).round() / 10.0;
    let (free, total) = disk_space(&dir).unwrap_or((0, 0));

    Ok(SystemVitals {
        throughput,
        active_transfers: active_count,
        storage_free_gb: gb(free),
        storage_total_gb: gb(total),
        storage_percentage: if total > 0 { ((free as f64) / (total as f64) * 100.0) as u32 } else { 0 },
    })
}

#[tauri::command]
async fn get_windows_accent_color() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // Read the DWM accent straight from the registry (starting PowerShell took ~0.7 s).
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
        let key: Vec<u16> = r"Software\Microsoft\Windows\DWM".encode_utf16().chain(Some(0)).collect();
        let name: Vec<u16> = "AccentColor".encode_utf16().chain(Some(0)).collect();
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut value as *mut u32).cast(),
                &mut size,
            )
        };
        if status == 0 {
            // Stored as 0xAABBGGRR.
            let (r, g, b) = (value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF);
            return Ok(format!("#{r:02x}{g:02x}{b:02x}"));
        }
        Ok("#3b82f6".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    Ok("#3b82f6".to_string())
}

#[tauri::command]
async fn pick_storage_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            use std::process::Command;
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select HyperStream Media Storage Directory'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
            ]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let output = cmd
                .output()
                .map_err(|e| e.to_string())?;
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                Ok(Some(path))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[cfg(not(target_os = "windows"))]
    Ok(None)
}

#[cfg(target_os = "windows")]
fn enable_kill_child_processes_on_exit() {
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if !job.is_null() {
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let _ = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            let _ = AssignProcessToJobObject(job, GetCurrentProcess());
        }
    }
}

/// Whether one of this app's windows is in front. Focus moving into the built-in browser's page
/// (or away from it when the page hides) doesn't make the app inactive.
#[tauri::command]
fn is_app_foreground() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid == std::process::id()
    }
    #[cfg(not(target_os = "windows"))]
    true
}

/// Pages sent from another browser (`hyperstream://download?url=…`) that the UI hasn't taken yet.
static PENDING_LINKS: std::sync::Mutex<Vec<ExternalLink>> = std::sync::Mutex::new(Vec::new());

#[derive(Clone, serde::Serialize)]
struct ExternalLink {
    url: String,
    /// Sent by the HyperStream extension (the user clicked it there). Links from web pages
    /// (`hyperstream://`) are never trusted to start a download by themselves.
    from_extension: bool,
}

/// The web page inside a `hyperstream://download?url=…` link. Anything else is ignored.
fn page_from_deep_link(link: &str) -> Option<String> {
    let parsed = tauri::Url::parse(link).ok()?;
    if parsed.scheme() != "hyperstream" {
        return None;
    }
    let target = parsed.query_pairs().find(|(k, _)| k == "url")?.1.into_owned();
    let page = tauri::Url::parse(target.trim()).ok()?;
    matches!(page.scheme(), "http" | "https").then(|| page.to_string())
}

/// Any website can open a `hyperstream://` link, so a received page only lands in the Hub's link
/// box with the window brought forward; the user still decides whether to download it.
fn receive_deep_links(app: &tauri::AppHandle, links: &[tauri::Url]) {
    for page in links.iter().filter_map(|u| page_from_deep_link(u.as_str())) {
        queue_external_page(app, page, false);
    }
}

/// A page sent from outside the app (link or browser extension): shown in the Hub's link box.
pub(crate) fn queue_external_page(app: &tauri::AppHandle, page: String, from_extension: bool) {
    use tauri::Emitter;
    if let Ok(mut pending) = PENDING_LINKS.lock() {
        pending.push(ExternalLink { url: page, from_extension });
    }
    let _ = app.emit("external-link", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn browser_extension_folder(app: tauri::AppHandle) -> Option<String> {
    extension_folder(&app)
}

/// Whether the extension is in the default browser, and whether one-click install is available.
#[tauri::command]
async fn browser_extension_status(app: tauri::AppHandle) -> extension_setup::ExtensionStatus {
    let folder = extension_folder(&app);
    tauri::async_runtime::spawn_blocking(move || extension_setup::status(folder))
        .await
        .unwrap_or_else(|_| extension_setup::status(None))
}

/// Opens the extension's store page (or the browser's extensions page) in the default browser.
#[tauri::command]
async fn add_browser_extension(app: tauri::AppHandle) -> Result<extension_setup::AddOutcome, String> {
    let folder = extension_folder(&app);
    tauri::async_runtime::spawn_blocking(move || extension_setup::add(folder))
        .await
        .map_err(|e| e.to_string())?
}

/// The browser extension's folder (for "Load unpacked" until it's in the browser stores).
fn extension_folder(app: &tauri::AppHandle) -> Option<String> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let mut candidates = vec![exe_dir.join("extension")];
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("extension"));
    }
    // Development builds run from src-tauri/target/<profile>/.
    candidates.push(exe_dir.join("../../../extension"));
    candidates
        .into_iter()
        .find(|dir| dir.join("manifest.json").is_file())
        .and_then(|dir| dir.canonicalize().ok())
        .map(|dir| dir.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

#[tauri::command]
fn take_external_links() -> Vec<ExternalLink> {
    PENDING_LINKS.lock().map(|mut p| std::mem::take(&mut *p)).unwrap_or_default()
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    shut_down(&app);
}

/// Set once the page engines have had their chance to save; the next exit request goes through.
static EXIT_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Quit without losing data. WebView2 writes localStorage (settings, shortcuts) and cookies in
/// batches several seconds apart, so killing it with the job object dropped recent changes.
/// Windows hide at once; the engines are closed and given up to 3 s to finish writing.
fn shut_down(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    for w in app.webview_windows().values() {
        let _ = w.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for w in app.webview_windows().values() {
            let _ = w.destroy();
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while webview_engines_running() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        EXIT_READY.store(true, Ordering::SeqCst);
        // yt-dlp and FFmpeg still belong to the kill-on-close job object, so they exit with us.
        app.exit(0);
    });
}

/// Whether a WebView2 browser process started by this app is still running.
#[cfg(target_os = "windows")]
fn webview_engines_running() -> bool {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    let me = std::process::id();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            if entry.th32ParentProcessID == me {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if name.eq_ignore_ascii_case("msedgewebview2.exe") {
                    found = true;
                    break;
                }
            }
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(not(target_os = "windows"))]
fn webview_engines_running() -> bool {
    false
}

#[tauri::command]
async fn get_engine_binary_status() -> Result<downloader::EngineBinariesReport, String> {
    tauri::async_runtime::spawn_blocking(downloader::BinaryManager::get_status)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
struct EngineSetupProgress {
    component: String,
    downloaded: u64,
    total: Option<u64>,
}

fn engine_progress_emitter(app: tauri::AppHandle) -> impl Fn(&str, u64, Option<u64>) + Send + Sync {
    move |component: &str, downloaded: u64, total: Option<u64>| {
        use tauri::Emitter;
        let _ = app.emit(
            "engine-setup-progress",
            EngineSetupProgress { component: component.to_string(), downloaded, total },
        );
    }
}

/// Installs yt-dlp and FFmpeg if they're missing. Emits `engine-setup-progress`.
#[tauri::command]
async fn ensure_engine_binaries(app: tauri::AppHandle) -> Result<downloader::EngineBinariesReport, String> {
    let progress = engine_progress_emitter(app);
    downloader::BinaryManager::ensure_installed(&progress).await
}

/// Downloads the latest yt-dlp into the app's own folder (sites change often).
#[tauri::command]
async fn update_engine(app: tauri::AppHandle) -> Result<downloader::EngineBinariesReport, String> {
    let progress = engine_progress_emitter(app);
    downloader::BinaryManager::download_yt_dlp(&progress).await?;
    downloader::BinaryManager::ensure_js_runtime(&progress).await;
    tauri::async_runtime::spawn_blocking(downloader::BinaryManager::get_status)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "experimental-drm")]
#[tauri::command]
async fn query_crunchyroll_stream(url: String, access_token: String) -> Result<downloader::PlaybackSession, String> {
    let engine = downloader::CrunchyrollEngine::new();
    let guid = downloader::CrunchyrollEngine::extract_guid(&url);
    engine.acquire_playback_session(&guid, &access_token).await
}

#[cfg(feature = "experimental-drm")]
#[tauri::command]
async fn refresh_crunchyroll_token(etp_rt: String) -> Result<String, String> {
    let engine = downloader::CrunchyrollEngine::new();
    engine.refresh_access_token(&etp_rt).await
}

#[cfg(feature = "experimental-drm")]
#[tauri::command]
fn get_cached_keys_count() -> Result<usize, String> {
    let store = downloader::KeyStore::new();
    Ok(store.key_count())
}

#[tauri::command]
fn inspect_media_container(path: String) -> Result<bool, String> {
    let p = std::path::PathBuf::from(&path);
    Ok(downloader::FastAtomInspector::verify_file(&p))
}

type LookupResult = Result<downloader::MediaMetadata, String>;

/// Look-ups in progress, so asking twice for the same link (a prefetch, then the Hub) waits
/// for the first one instead of starting yt-dlp again.
static LOOKUPS: std::sync::Mutex<Option<std::collections::HashMap<String, std::sync::Arc<tokio::sync::OnceCell<LookupResult>>>>> =
    std::sync::Mutex::new(None);

#[tauri::command]
async fn query_media_info(app: tauri::AppHandle, url: String) -> LookupResult {
    // Looked up in the last few minutes: answer from the saved result, no network.
    if let Some(meta) = downloader::extractor::recent_lookup(&url) {
        return Ok(meta);
    }
    let cell = {
        let mut map = LOOKUPS.lock().map_err(|e| e.to_string())?;
        map.get_or_insert_with(Default::default).entry(url.clone()).or_default().clone()
    };
    let result = cell.get_or_init(|| look_up(app, url.clone())).await.clone();
    if let Ok(mut map) = LOOKUPS.lock() {
        map.get_or_insert_with(Default::default).remove(&url);
    }
    result
}

/// Starts a look-up ahead of time (a copied link, the extension popup); the Hub's own
/// look-up then finds it done or joins it.
#[tauri::command]
fn prefetch_media_info(app: tauri::AppHandle, url: String) {
    prefetch(&app, url);
}

pub(crate) fn prefetch(app: &tauri::AppHandle, url: String) {
    let Ok(parsed) = tauri::Url::parse(url.trim()) else { return };
    if !matches!(parsed.scheme(), "http" | "https") {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = query_media_info(app, parsed.to_string()).await;
    });
}

async fn look_up(app: tauri::AppHandle, url: String) -> LookupResult {
    // Reading sign-ins can mean starting the built-in browser (seconds), and most links don't
    // need one. Look up right away; the sign-in is read alongside and used only if that fails
    // (age-restricted, members-only, private posts).
    let cookies = {
        let (app, url) = (app.clone(), url.clone());
        tauri::async_runtime::spawn(async move { downloader::cookies::browser_cookies_async(&app, &url).await })
    };
    let lookup = |cookies: Option<String>| {
        let url = url.clone();
        tauri::async_runtime::spawn_blocking(move || downloader::UniversalExtractor::query_info(&url, cookies.as_deref()))
    };
    let first = lookup(None).await.map_err(|e| e.to_string())?;
    if first.is_ok() {
        return first;
    }
    let cookies = cookies.await.ok().flatten();
    let result = match cookies.clone() {
        Some(c) => lookup(Some(c)).await.map_err(|e| e.to_string())?,
        None => first,
    };
    // The site may have changed: with a newer yt-dlp, try once more.
    if let Err(e) = &result {
        if downloader::binary_manager::may_be_fixed_by_update(e) && downloader::BinaryManager::update_after_site_failure().await {
            return lookup(cookies).await.map_err(|e| e.to_string())?;
        }
    }
    result
}

#[tauri::command]
fn get_default_download_dir() -> String {
    downloader::default_download_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn retry_download(state: tauri::State<downloader::DownloadOrchestrator>, task_id: String) -> Result<(), String> {
    state.retry_task(&task_id)
}

#[tauri::command]
fn move_download(
    state: tauri::State<downloader::DownloadOrchestrator>,
    task_id: String,
    direction: String,
) -> Result<(), String> {
    state.move_task(&task_id, direction == "up")
}

#[tauri::command]
fn remove_download(state: tauri::State<downloader::DownloadOrchestrator>, task_id: String) -> Result<(), String> {
    state.remove_task(&task_id)
}

#[tauri::command]
async fn get_library() -> Result<Vec<downloader::LibraryItem>, String> {
    tauri::async_runtime::spawn_blocking(downloader::library::list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_library_item(app: tauri::AppHandle, id: String, delete_file: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || downloader::library::remove(&id, delete_file))
        .await
        .map_err(|e| e.to_string())??;
    use tauri::Emitter;
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
fn open_media_file(path: String) -> Result<(), String> {
    downloader::library::open_with_default_app(&path)
}

#[tauri::command]
async fn start_universal_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, downloader::DownloadOrchestrator>,
    options: downloader::DownloadOptions,
    priority: Option<i32>,
) -> Result<String, String> {
    state.start_download(app, options, priority).await
}

#[tauri::command]
fn cancel_download(
    state: tauri::State<downloader::DownloadOrchestrator>,
    task_id: String,
) -> Result<(), String> {
    state.cancel_task(&task_id)
}

#[tauri::command]
fn get_active_downloads(
    state: tauri::State<downloader::DownloadOrchestrator>,
) -> Result<Vec<downloader::DownloadProgress>, String> {
    Ok(state.get_tasks())
}

#[tauri::command]
fn pause_download(
    state: tauri::State<downloader::DownloadOrchestrator>,
    task_id: String,
) -> Result<(), String> {
    state.pause_task(&task_id)
}

#[tauri::command]
fn resume_download(
    state: tauri::State<downloader::DownloadOrchestrator>,
    task_id: String,
) -> Result<(), String> {
    state.resume_task(&task_id)
}

#[tauri::command]
fn reorder_download(
    state: tauri::State<downloader::DownloadOrchestrator>,
    task_id: String,
    priority: i32,
) -> Result<(), String> {
    state.reorder_task(&task_id, priority)
}

#[tauri::command]
fn get_queue_config(
    state: tauri::State<downloader::DownloadOrchestrator>,
) -> Result<downloader::QueueConfig, String> {
    Ok(state.get_config())
}

#[tauri::command]
fn set_queue_config(
    state: tauri::State<downloader::DownloadOrchestrator>,
    config: downloader::QueueConfig,
) -> Result<downloader::QueueConfig, String> {
    state.set_config(config)
}

/// One speed limit for all downloads (Settings → Speed limit).
#[tauri::command]
fn set_speed_limit(limit: downloader::bandwidth::SpeedLimit) {
    downloader::bandwidth::set(limit);
}

#[tauri::command]
fn pause_all(
    state: tauri::State<downloader::DownloadOrchestrator>,
) -> Result<(), String> {
    state.pause_all()
}

#[tauri::command]
fn resume_all(
    state: tauri::State<downloader::DownloadOrchestrator>,
) -> Result<(), String> {
    state.resume_all()
}

#[tauri::command]
fn clear_finished(
    state: tauri::State<downloader::DownloadOrchestrator>,
) -> Result<usize, String> {
    Ok(state.clear_finished())
}

#[cfg(test)]
mod deep_link_tests {
    use super::page_from_deep_link;

    #[test]
    fn accepts_only_web_pages_inside_hyperstream_links() {
        assert_eq!(
            page_from_deep_link("hyperstream://download?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc").as_deref(),
            Some("https://www.youtube.com/watch?v=abc")
        );
        assert_eq!(page_from_deep_link("hyperstream://download?url=file%3A%2F%2F%2FC%3A%2Fx.exe"), None);
        assert_eq!(page_from_deep_link("hyperstream://download?url=javascript%3Aalert(1)"), None);
        assert_eq!(page_from_deep_link("https://example.com/?url=https://x.com"), None);
        assert_eq!(page_from_deep_link("hyperstream://download"), None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// True when a browser started this exe to reach the HyperStream extension's helper.
pub fn is_browser_helper_launch() -> bool {
    bridge::is_host_launch()
}

/// The browser extension's helper: passes messages to the app, then exits.
pub fn run_browser_helper() {
    bridge::host_main();
}

pub fn run() {
    // Child processes (WebView2, yt-dlp, ffmpeg) die with the app via a job object.
    // Orphan cleanup only runs on exit: at launch it would kill an already-running instance.
    #[cfg(target_os = "windows")]
    enable_kill_child_processes_on_exit();

    std::panic::set_hook(Box::new(|panic_info| {
        let msg = format!("HyperStream Panic: {panic_info}");
        eprintln!("{msg}");
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let log_dir = std::path::PathBuf::from(local_app_data)
                .join("com.hyperstream.desktop")
                .join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            let panic_file = log_dir.join("panic.log");
            let _ = std::fs::write(panic_file, &msg);
        }
    }));


    tauri::Builder::default()
        .on_window_event(|window, event| {
            match event {
                #[cfg(target_os = "windows")]
                tauri::WindowEvent::Focused(false) => {
                    trim_working_set_if_idle();
                }
                tauri::WindowEvent::Resized(_) => {
                    use tauri::Emitter;
                    if window.label() == "main" {
                        browser::on_main_minimized(window.app_handle(), window.is_minimized().unwrap_or(false));
                    }
                    browser::on_window_resized(window.app_handle());
                    let _ = window.emit("window-resized", ());
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        // Reopen at the size and place the user left it (not visibility: setup shows the window).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            app.manage(browser::BrowserState::default());

            // HyperStream browser extension: register with the browsers, then listen for it.
            std::thread::spawn(bridge::register);
            bridge::serve(app.handle().clone());

            // "Send to HyperStream" from other browsers. Registering keeps the link pointing at
            // this copy of the app (installers register it too).
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(desktop)]
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("Couldn't register hyperstream:// links: {e}");
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| receive_deep_links(&handle, &event.urls()));
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    receive_deep_links(app.handle(), &urls);
                }
            }
            let orchestrator = downloader::DownloadOrchestrator::new();
            orchestrator.attach_app(app.handle().clone());
            app.manage(orchestrator);

            // Thumbnails saved by older versions are shrunk once, after startup has settled.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(20));
                downloader::library::shrink_existing_thumbnails();
            });

            // Keep the app-managed yt-dlp fresh; sites change their pages constantly.
            tauri::async_runtime::spawn(async {
                if downloader::BinaryManager::managed_ytdlp_is_stale() {
                    let _ = downloader::BinaryManager::refresh_yt_dlp().await;
                }
                // YouTube needs a JavaScript runtime for all formats; install it quietly if missing.
                let has_ytdlp = tauri::async_runtime::spawn_blocking(|| downloader::BinaryManager::find_binary("yt-dlp").is_some())
                    .await
                    .unwrap_or(false);
                if has_ytdlp {
                    downloader::BinaryManager::ensure_js_runtime(&|_, _, _| {}).await;
                }
            });
            #[cfg(debug_assertions)]
            if std::env::var_os("HS_BROWSER_SELFTEST").is_some() {
                browser::selftest::run(app.handle().clone());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reveal_in_explorer,
            get_system_vitals,
            get_windows_accent_color,
            pick_storage_folder,
            exit_app,
            take_external_links,
            browser_extension_folder,
            set_speed_limit,
            prefetch_media_info,
            browser_extension_status,
            add_browser_extension,
            is_app_foreground,
            browser::set_browser_visibility,
            browser::update_browser_bounds,
            browser::navigate_browser,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_reload,
            browser::browser_stop,
            browser::browser_state,
            browser::browser_snapshot,
            browser::browser_set_shields,
            browser::browser_shields_stats,
            browser::clear_browsing_data,
            browser::prewarm_browser,
            browser::site_icon::site_icon,
            browser::get_installed_extensions,
            browser::install_store_extension,
            browser::uninstall_browser_extension,
            browser::set_extension_enabled,
            browser::load_unpacked_extension,
            browser::update_browser_extensions,
            browser::extension_page_url,
            get_engine_binary_status,
            ensure_engine_binaries,
            #[cfg(feature = "experimental-drm")]
            query_crunchyroll_stream,
            #[cfg(feature = "experimental-drm")]
            refresh_crunchyroll_token,
            #[cfg(feature = "experimental-drm")]
            get_cached_keys_count,
            inspect_media_container,
            query_media_info,
            start_universal_download,
            cancel_download,
            get_active_downloads,
            pause_download,
            resume_download,
            reorder_download,
            get_queue_config,
            set_queue_config,
            pause_all,
            resume_all,
            clear_finished,
            retry_download,
            remove_download,
            move_download,
            get_default_download_dir,
            get_library,
            remove_library_item,
            open_media_file,
            update_engine
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Closing the last window, Alt+F4 or the title-bar X: let the engines save first.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !EXIT_READY.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    shut_down(app);
                }
            }
        });
}
