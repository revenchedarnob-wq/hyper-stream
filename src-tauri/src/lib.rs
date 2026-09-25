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
    pub throughput: f64,
    pub active_transfers: u32,
    pub storage_free_gb: f64,
    pub storage_total_gb: f64,
    pub storage_percentage: u32,
    pub engine_status: String,
    pub nvme_free_tb: f64,
    pub nvme_percentage: u32,
}

fn detect_hardware_engine() -> &'static str {
    static ENGINE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ENGINE.get_or_init(|| {
        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
            let mut device: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let mut dev_idx = 0;
            while unsafe { EnumDisplayDevicesW(std::ptr::null(), dev_idx, &mut device, 0) } != 0 {
                let name = String::from_utf16_lossy(&device.DeviceString);
                let name = name.trim_matches(char::from(0)).to_lowercase();
                if name.contains("nvidia") || name.contains("geforce") || name.contains("rtx") || name.contains("gtx") {
                    return "NVENC Turbo (D3D12)".to_string();
                } else if name.contains("amd") || name.contains("radeon") {
                    return "AMD AMF Turbo (D3D12)".to_string();
                } else if name.contains("intel") || name.contains("arc") || name.contains("iris") {
                    return "Intel QSV Turbo (D3D12)".to_string();
                }
                dev_idx += 1;
                device = unsafe { std::mem::zeroed() };
                device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            }
            "D3D12 Direct Pipeline".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "Hardware Acceleration".to_string()
        }
    })
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_system_vitals(
    state: tauri::State<'_, downloader::DownloadOrchestrator>,
) -> Result<SystemVitals, String> {
    let tasks = state.get_tasks();
    let mut total_speed_bps = 0u64;
    let mut active_count = 0u32;
    for task in &tasks {
        match task.state {
            downloader::DownloadState::Downloading | downloader::DownloadState::Remuxing => {
                active_count += 1;
                total_speed_bps = total_speed_bps.saturating_add(task.speed_bytes_per_sec);
            }
            _ => {}
        }
    }
    let throughput_mb = (total_speed_bps as f64) / (1024.0 * 1024.0);
    let throughput_rounded = (throughput_mb * 10.0).round() / 10.0;

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free: u64 = 0;

        let download_path = if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = std::path::PathBuf::from(profile).join("Downloads");
            if p.exists() {
                let mut s = p.to_string_lossy().to_string();
                if !s.ends_with('\\') {
                    s.push('\\');
                }
                let mut v: Vec<u16> = s.encode_utf16().collect();
                v.push(0);
                v
            } else {
                "C:\\\0".encode_utf16().collect()
            }
        } else {
            "C:\\\0".encode_utf16().collect()
        };

        let success = unsafe {
            GetDiskFreeSpaceExW(
                download_path.as_ptr(),
                &mut free_bytes,
                &mut total_bytes,
                &mut total_free,
            )
        };
        let (free_gb, total_gb, percentage) = if success != 0 && total_bytes > 0 {
            let free_gb = (free_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
            let total_gb = (total_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
            let pct = ((free_bytes as f64) / (total_bytes as f64) * 100.0) as u32;
            (free_gb, total_gb, pct)
        } else {
            (0.0, 0.0, 0)
        };

        return Ok(SystemVitals {
            throughput: throughput_rounded,
            active_transfers: active_count,
            storage_free_gb: (free_gb * 10.0).round() / 10.0,
            storage_total_gb: (total_gb * 10.0).round() / 10.0,
            storage_percentage: percentage,
            engine_status: detect_hardware_engine().to_string(),
            nvme_free_tb: ((free_gb / 1024.0) * 100.0).round() / 100.0,
            nvme_percentage: percentage,
        });
    }

    #[cfg(not(target_os = "windows"))]
    Ok(SystemVitals {
        throughput: throughput_rounded,
        active_transfers: active_count,
        storage_free_gb: 0.0,
        storage_total_gb: 0.0,
        storage_percentage: 0,
        engine_status: detect_hardware_engine().to_string(),
        nvme_free_tb: 0.0,
        nvme_percentage: 0,
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

#[cfg(target_os = "windows")]
fn cleanup_orphaned_webviews() {
    // If an earlier session exited abnormally, lingering msedgewebview2 processes
    // can hold exclusive locks on EBWebView directory causing HRESULT 0x800700AA.
    // Clean them up before initializing WebView2.
    use std::process::Command;
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | Where-Object { $_.CommandLine -like '*com.hyperstream.desktop*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.output();
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    cleanup_orphaned_webviews();
    app.exit(0);
}

fn get_browser_extensions_dir() -> std::path::PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(local_app_data)
            .join("com.hyperstream.desktop")
            .join("browser_extensions");
        let _ = std::fs::create_dir_all(&dir);
        dir
    } else {
        std::path::PathBuf::from("browser_extensions")
    }
}

fn get_browser_data_dir() -> std::path::PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(local_app_data)
            .join("com.hyperstream.desktop")
            .join("browser_profile");
        let _ = std::fs::create_dir_all(&dir);
        dir
    } else {
        std::path::PathBuf::from("browser_profile")
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub description: String,
}

#[tauri::command]
fn get_installed_extensions() -> Result<Vec<ExtensionInfo>, String> {
    let ext_dir = get_browser_extensions_dir();
    let mut list = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&ext_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let id = entry.file_name().to_string_lossy().to_string();
                let manifest_path = entry.path().join("manifest.json");
                let mut name = id.clone();
                let mut version = "1.0.0".to_string();
                let mut description = String::new();
                if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(n) = json.get("name").and_then(|v| v.as_str()) {
                            name = n.to_string();
                        }
                        if let Some(v) = json.get("version").and_then(|v| v.as_str()) {
                            version = v.to_string();
                        }
                        if let Some(d) = json.get("description").and_then(|v| v.as_str()) {
                            description = d.to_string();
                        }
                    }
                }
                list.push(ExtensionInfo {
                    id,
                    name,
                    version,
                    enabled: true,
                    description,
                });
            }
        }
    }
    Ok(list)
}

#[tauri::command]
fn install_browser_extension(extension_id: String, download_url: String) -> Result<String, String> {
    let ext_dir = get_browser_extensions_dir();
    let target_dir = ext_dir.join(&extension_id);
    let _ = std::fs::create_dir_all(&target_dir);

    let ps_script = format!(
        "$tempFile = Join-Path $env:TEMP ('hyperstream_ext_' + [guid]::NewGuid().ToString() + '.zip'); \
        curl.exe -s -L -o $tempFile '{url}'; \
        $bytes = [System.IO.File]::ReadAllBytes($tempFile); \
        if ($bytes.Length -gt 16 -and $bytes[0] -eq 0x43 -and $bytes[1] -eq 0x72 -and $bytes[2] -eq 0x32 -and $bytes[3] -eq 0x34) {{ \
            $hLen = [System.BitConverter]::ToUInt32($bytes, 8); \
            $zOff = 12 + $hLen; \
            $zBytes = New-Object byte[] ($bytes.Length - $zOff); \
            [System.Array]::Copy($bytes, $zOff, $zBytes, 0, $zBytes.Length); \
            [System.IO.File]::WriteAllBytes($tempFile, $zBytes); \
        }} \
        Expand-Archive -Path $tempFile -DestinationPath '{dest}' -Force; \
        Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue",
        url = download_url,
        dest = target_dir.to_string_lossy().replace('\\', "\\\\")
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &ps_script]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(format!("Extension {} installed successfully", extension_id))
}

#[tauri::command]
fn uninstall_browser_extension(extension_id: String) -> Result<String, String> {
    let ext_dir = get_browser_extensions_dir();
    let target_dir = ext_dir.join(&extension_id);
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    Ok(format!("Extension {} removed", extension_id))
}

#[tauri::command]
fn load_unpacked_extension(source_path: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&source_path);
    if !src.exists() || !src.is_dir() {
        return Err("Selected path is not a valid directory".to_string());
    }
    let manifest = src.join("manifest.json");
    if !manifest.exists() {
        return Err("Directory does not contain a manifest.json file".to_string());
    }
    let folder_name = src.file_name().unwrap_or_default().to_string_lossy().to_string();
    let ext_dir = get_browser_extensions_dir();
    let dest = ext_dir.join(&folder_name);
    let _ = std::fs::create_dir_all(&dest);

    let ps_script = format!(
        "Copy-Item -Path '{src}\\*' -Destination '{dest}' -Recurse -Force",
        src = src.to_string_lossy().replace('\\', "\\\\"),
        dest = dest.to_string_lossy().replace('\\', "\\\\")
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &ps_script]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd
        .output()
        .map_err(|e| e.to_string())?;

    Ok(format!("Extension {} loaded successfully", folder_name))
}

use std::sync::Mutex;

static SHIELDS_SCRIPT: &str = include_str!("shields_script.js");

pub struct BrowserState {
    pub bounds: Mutex<tauri::Rect>,
    pub current_url: Mutex<String>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            bounds: Mutex::new(tauri::Rect {
                position: tauri::Position::Logical(tauri::LogicalPosition::new(280.0, 96.0)),
                size: tauri::Size::Logical(tauri::LogicalSize::new(960.0, 640.0)),
            }),
            current_url: Mutex::new(String::new()),
        }
    }
}

#[tauri::command]
fn set_browser_visibility(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(webview) = app.get_webview("in_app_browser") {
        if visible {
            let _ = webview.show();
        } else {
            let _ = webview.eval("try { document.querySelectorAll('video, audio').forEach(el => el.pause()); } catch(e) {}");
            let _ = webview.hide();
            #[cfg(target_os = "windows")]
            trim_working_set_if_idle();
        }
    }
    Ok(())
}

#[derive(serde::Deserialize, Clone, Copy, Debug)]
pub struct BrowserBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(target_os = "windows")]
fn apply_bounds_and_clipping(app: &tauri::AppHandle, rect: tauri::Rect) {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.set_bounds(rect);
        if let Some(window) = app.get_window("main") {
            if let Ok(parent_hwnd) = window.hwnd() {
                unsafe {
                    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
                    use windows_sys::Win32::Graphics::Gdi::SetWindowRgn;
                    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};

                    unsafe extern "system" fn enum_child_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
                        let matches = &mut *(lparam as *mut Vec<HWND>);
                        let mut class_name = [0u16; 64];
                        let len = GetClassNameW(hwnd, class_name.as_mut_ptr(), 64);
                        if len > 0 {
                            let name = String::from_utf16_lossy(&class_name[..len as usize]);
                            if name.starts_with("Chrome_WidgetWin") || name.starts_with("Intermediate D3D") {
                                matches.push(hwnd);
                            }
                        }
                        1
                    }

                    let mut chrome_windows: Vec<HWND> = Vec::new();
                    EnumChildWindows(
                        parent_hwnd.0 as _,
                        Some(enum_child_proc),
                        &mut chrome_windows as *mut _ as LPARAM,
                    );

                    // Clear any leftover GDI region on all child windows so webview content
                    // fills cleanly edge-to-edge like Google Chrome without black corner notches.
                    for child in chrome_windows {
                        SetWindowRgn(child, std::ptr::null_mut(), 1);
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_bounds_and_clipping(app: &tauri::AppHandle, rect: tauri::Rect) {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.set_bounds(rect);
    }
}

#[tauri::command]
fn update_browser_bounds(
    app: tauri::AppHandle,
    state: tauri::State<BrowserState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if width < 10 || height < 10 {
        return Ok(());
    }

    let pos = tauri::Position::Logical(tauri::LogicalPosition::new(x as f64, y as f64));
    let size = tauri::Size::Logical(tauri::LogicalSize::new(width as f64, height as f64));
    let rect = tauri::Rect {
        position: pos,
        size,
    };

    if let Ok(mut b) = state.bounds.lock() {
        *b = rect;
    }

    apply_bounds_and_clipping(&app, rect);
    Ok(())
}

#[tauri::command]
async fn navigate_browser(
    app: tauri::AppHandle,
    state: tauri::State<'_, BrowserState>,
    url: String,
    bounds: Option<BrowserBounds>,
) -> Result<(), String> {
    if url.is_empty() || url == "about:blank" {
        if let Some(webview) = app.get_webview("in_app_browser") {
            let _ = webview.eval("try { document.querySelectorAll('video, audio').forEach(el => el.pause()); } catch(e) {}");
            if let Ok(blank) = "about:blank".parse() {
                let _ = webview.navigate(blank);
            }
            let _ = webview.hide();
        }
        if let Ok(mut u) = state.current_url.lock() {
            u.clear();
        }
        return Ok(());
    }

    let rect = if let Some(b) = bounds {
        if b.width >= 10 && b.height >= 10 {
            let r = tauri::Rect {
                position: tauri::Position::Logical(tauri::LogicalPosition::new(b.x as f64, b.y as f64)),
                size: tauri::Size::Logical(tauri::LogicalSize::new(b.width as f64, b.height as f64)),
            };
            if let Ok(mut lock) = state.bounds.lock() {
                *lock = r;
            }
            r
        } else if let Ok(lock) = state.bounds.lock() {
            *lock
        } else {
            tauri::Rect {
                position: tauri::Position::Logical(tauri::LogicalPosition::new(280.0, 96.0)),
                size: tauri::Size::Logical(tauri::LogicalSize::new(960.0, 640.0)),
            }
        }
    } else if let Ok(lock) = state.bounds.lock() {
        *lock
    } else {
        tauri::Rect {
            position: tauri::Position::Logical(tauri::LogicalPosition::new(280.0, 96.0)),
            size: tauri::Size::Logical(tauri::LogicalSize::new(960.0, 640.0)),
        }
    };

    if let Ok(mut u) = state.current_url.lock() {
        *u = url.clone();
    }

    let parsed_url: tauri::Url = match url.parse() {
        Ok(u) => u,
        Err(e) => return Err(e.to_string()),
    };

    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.navigate(parsed_url);
        let _ = webview.show();
        apply_bounds_and_clipping(&app, rect);
    } else if let Some(window) = app.get_window("main") {
        let app_handle = app.clone();
        let ext_dir = get_browser_extensions_dir();
        let data_dir = get_browser_data_dir();
        let webview_builder = tauri::webview::WebviewBuilder::new(
            "in_app_browser",
            tauri::WebviewUrl::External(parsed_url),
        )
        .browser_extensions_enabled(true)
        .extensions_path(&ext_dir)
        .data_directory(data_dir)
        .initialization_script(SHIELDS_SCRIPT)
        .on_page_load(move |_webview, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                use tauri::Emitter;
                let _ = app_handle.emit("browser-page-loaded", payload.url().as_str());
            }
        });

        let _ = window.add_child(
            webview_builder,
            rect.position,
            rect.size,
        ).map_err(|e| e.to_string())?;

        apply_bounds_and_clipping(&app, rect);
    }
    Ok(())
}

#[tauri::command]
fn browser_go_back(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.eval("window.history.back()");
    }
    Ok(())
}

#[tauri::command]
fn browser_go_forward(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.eval("window.history.forward()");
    }
    Ok(())
}

#[tauri::command]
fn browser_reload(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let _ = webview.reload();
    }
    Ok(())
}

#[tauri::command]
fn browser_set_shields_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(webview) = app.get_webview("in_app_browser") {
        let script = format!(
            "if (window.__HYPERSTREAM_SET_SHIELDS__) {{ window.__HYPERSTREAM_SET_SHIELDS__({}); }}",
            enabled
        );
        let _ = webview.eval(&script);
    }
    Ok(())
}

#[tauri::command]
async fn get_engine_binary_status() -> Result<downloader::EngineBinariesReport, String> {
    tauri::async_runtime::spawn_blocking(downloader::BinaryManager::get_status)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ensure_engine_binaries() -> Result<downloader::EngineBinariesReport, String> {
    let status = downloader::BinaryManager::get_status();
    if !status.ytdlp.available {
        let _ = downloader::BinaryManager::download_yt_dlp().await?;
    }
    if !status.aria2c.available {
        let _ = downloader::BinaryManager::download_aria2c().await?;
    }
    Ok(downloader::BinaryManager::get_status())
}

#[tauri::command]
async fn query_crunchyroll_stream(url: String, access_token: String) -> Result<downloader::PlaybackSession, String> {
    let engine = downloader::CrunchyrollEngine::new();
    let guid = downloader::CrunchyrollEngine::extract_guid(&url);
    engine.acquire_playback_session(&guid, &access_token).await
}

#[tauri::command]
async fn refresh_crunchyroll_token(etp_rt: String) -> Result<String, String> {
    let engine = downloader::CrunchyrollEngine::new();
    engine.refresh_access_token(&etp_rt).await
}

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
async fn query_media_info(url: String, cookies: Option<String>) -> Result<downloader::MediaMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        downloader::UniversalExtractor::query_info(&url, cookies.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_universal_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, downloader::DownloadOrchestrator>,
    options: downloader::DownloadOptions,
) -> Result<String, String> {
    state.start_download(app, options).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        cleanup_orphaned_webviews();
        enable_kill_child_processes_on_exit();
    }

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
            app.manage(BrowserState::default());
            app.manage(downloader::DownloadOrchestrator::new());
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
            set_browser_visibility,
            update_browser_bounds,
            navigate_browser,
            browser_go_back,
            browser_go_forward,
            browser_reload,
            browser_set_shields_enabled,
            get_installed_extensions,
            install_browser_extension,
            uninstall_browser_extension,
            load_unpacked_extension,
            get_engine_binary_status,
            ensure_engine_binaries,
            query_crunchyroll_stream,
            refresh_crunchyroll_token,
            get_cached_keys_count,
            inspect_media_container,
            query_media_info,
            start_universal_download,
            cancel_download,
            get_active_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}