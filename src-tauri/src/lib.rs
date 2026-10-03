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
        tauri::async_runtime::spawn_blocking(|| {
            use std::process::Command;
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-Command",
                "(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\DWM' -Name 'AccentColor' -ErrorAction SilentlyContinue).AccentColor",
            ]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let output = cmd.output();
            if let Ok(out) = output {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(color_num) = s.parse::<u32>() {
                    let r = (color_num & 0xFF) as u8;
                    let g = ((color_num >> 8) & 0xFF) as u8;
                    let b = ((color_num >> 16) & 0xFF) as u8;
                    return format!("#{:02x}{:02x}{:02x}", r, g, b);
                }
            }
            "#3b82f6".to_string()
        })
        .await
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    // WebView2, yt-dlp and FFmpeg belong to the kill-on-close job object, so they exit with us.
    app.exit(0);
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

#[tauri::command]
async fn query_media_info(app: tauri::AppHandle, url: String) -> Result<downloader::MediaMetadata, String> {
    let cookies = downloader::cookies::browser_cookies_async(&app, &url).await;
    tauri::async_runtime::spawn_blocking(move || {
        downloader::UniversalExtractor::query_info(&url, cookies.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            app.manage(browser::BrowserState::default());
            let orchestrator = downloader::DownloadOrchestrator::new();
            orchestrator.attach_app(app.handle().clone());
            app.manage(orchestrator);

            // Keep the app-managed yt-dlp fresh; sites change their pages constantly.
            tauri::async_runtime::spawn(async {
                if downloader::BinaryManager::managed_ytdlp_is_stale() {
                    let _ = downloader::BinaryManager::download_yt_dlp(&|_, _, _| {}).await;
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
                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::apply_acrylic;
                    let _ = apply_acrylic(&window, Some((15, 20, 30, 20)));
                }
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
