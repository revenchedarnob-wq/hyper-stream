//! Connection to the HyperStream browser extension (Chrome, Edge, Brave and other Chromium browsers).
//!
//! The browser starts this exe as a "native messaging host" (first argument
//! `chrome-extension://…`). That short-lived process passes each message to the running app
//! over a local named pipe, starting the app first if needed, and returns the app's answer.

use std::io::{BufRead, BufReader, Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

pub const HOST_NAME: &str = "com.hyperstream.bridge";
/// Extensions allowed to talk to the app: the unpacked development build (fixed by its key).
/// Store builds get their IDs added here when they're published.
const EXTENSION_IDS: &[&str] = &["dnhmkngncoccmkbmdbmknjjdficnmenh"];
// Store builds: keep in step with `extension_setup::CHROME_STORE_ID` / `EDGE_STORE_ID`.
/// Browsers that read native messaging hosts from these per-user registry keys.
const BROWSER_KEYS: &[&str] = &[
    r"Software\Google\Chrome\NativeMessagingHosts",
    r"Software\Microsoft\Edge\NativeMessagingHosts",
    r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    r"Software\Chromium\NativeMessagingHosts",
];
/// Cookies, headers and URLs fit comfortably; anything bigger is not a real request.
const MAX_MESSAGE: usize = 8 * 1024 * 1024;

fn pipe_name() -> String {
    let user: String = std::env::var("USERNAME").unwrap_or_default().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!(r"\\.\pipe\HyperStream.bridge.{}", user)
}

pub fn is_host_launch() -> bool {
    std::env::args().nth(1).is_some_and(|a| a.starts_with("chrome-extension://"))
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
struct BrowserCookie {
    domain: String,
    #[serde(rename = "hostOnly")]
    host_only: bool,
    path: String,
    secure: bool,
    expires: i64,
    name: String,
    value: String,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct Request {
    kind: String,
    url: String,
    title: String,
    page: String,
    referrer: String,
    filename: String,
    cookies: Vec<BrowserCookie>,
    #[serde(rename = "userAgent")]
    user_agent: String,
    /// Added by the helper: which browser the extension runs in.
    browser: String,
}

// ------------------------------------------------------------------ host process (started by the browser)

/// Runs instead of the app when a browser starts us for its extension.
pub fn host_main() {
    let browser = crate::extension_setup::browser_id_from_exe(&parent_exe_name().unwrap_or_default());
    // Being started at all means the extension is installed in this browser.
    crate::extension_setup::mark_connected(browser);
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    loop {
        let mut len = [0u8; 4];
        if stdin.read_exact(&mut len).is_err() {
            return;
        }
        let len = u32::from_le_bytes(len) as usize;
        if len > MAX_MESSAGE {
            return;
        }
        let mut message = vec![0u8; len];
        if stdin.read_exact(&mut message).is_err() {
            return;
        }
        let message = with_browser(&message, browser);
        let reply = forward(&message)
            .unwrap_or_else(|e| serde_json::json!({ "ok": false, "error": e }).to_string());
        let bytes = reply.into_bytes();
        let _ = stdout.write_all(&(bytes.len() as u32).to_le_bytes());
        let _ = stdout.write_all(&bytes);
        let _ = stdout.flush();
    }
}

/// Adds `"browser": "<id>"` so the app knows where the request came from.
fn with_browser(message: &[u8], browser: &str) -> Vec<u8> {
    match serde_json::from_slice::<serde_json::Value>(message) {
        Ok(serde_json::Value::Object(mut map)) => {
            map.insert("browser".into(), serde_json::Value::String(browser.into()));
            serde_json::to_vec(&map).unwrap_or_else(|_| message.to_vec())
        }
        _ => message.to_vec(),
    }
}

/// Program name of the process that started this one (the browser).
#[cfg(windows)]
fn parent_exe_name() -> Option<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let me = std::process::id();
    let mut entries: Vec<(u32, u32, String)> = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            entries.push((entry.th32ProcessID, entry.th32ParentProcessID, String::from_utf16_lossy(&entry.szExeFile[..len])));
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
    }
    let parent = entries.iter().find(|e| e.0 == me)?.1;
    entries.into_iter().find(|e| e.0 == parent).map(|e| e.2)
}

#[cfg(not(windows))]
fn parent_exe_name() -> Option<String> {
    None
}

fn open_pipe() -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new().read(true).write(true).open(pipe_name())
}

/// Hands one message to the app and returns its answer (a JSON line).
fn forward(message: &[u8]) -> Result<String, String> {
    let mut pipe = match open_pipe() {
        Ok(p) => p,
        Err(_) => {
            let is_ping = serde_json::from_slice::<Request>(message).is_ok_and(|r| r.kind == "ping");
            if is_ping {
                // The popup only asks whether the app is there; don't start it for that.
                return Err("HyperStream isn't running.".into());
            }
            start_app()?;
            let started = Instant::now();
            loop {
                std::thread::sleep(Duration::from_millis(150));
                match open_pipe() {
                    Ok(p) => break p,
                    Err(_) if started.elapsed() < Duration::from_secs(25) => continue,
                    Err(_) => return Err("HyperStream didn't start in time.".into()),
                }
            }
        }
    };
    pipe.write_all(message).map_err(|e| e.to_string())?;
    pipe.write_all(b"\n").map_err(|e| e.to_string())?;
    pipe.flush().map_err(|e| e.to_string())?;
    let mut reply = String::new();
    BufReader::new(pipe).take(64 * 1024).read_line(&mut reply).map_err(|e| e.to_string())?;
    if reply.trim().is_empty() {
        return Err("HyperStream closed the connection.".into());
    }
    Ok(reply.trim().to_string())
}

fn start_app() -> Result<(), String> {
    // The browser's pipes must not be inherited: the app would hold them open and the browser
    // would keep waiting on a helper that has already answered.
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT};
        for handle in [std::io::stdin().as_raw_handle(), std::io::stdout().as_raw_handle(), std::io::stderr().as_raw_handle()] {
            unsafe {
                SetHandleInformation(handle as _, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Not tied to the browser's helper process: closing the browser mustn't close the app.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(_) => {
            // Some browsers don't allow leaving their job object; start normally instead.
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let mut plain = std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
                plain.creation_flags(0x0000_0008 | 0x0000_0200);
                plain.spawn().map(|_| ()).map_err(|e| format!("Couldn't start HyperStream: {}", e))
            }
            #[cfg(not(windows))]
            Err("Couldn't start HyperStream.".into())
        }
    }
}

// ------------------------------------------------------------------ registration

/// Tells the browsers where the host is. Cheap, and keeps pointing at this copy of the app.
pub fn register() {
    #[cfg(windows)]
    {
        let Ok(exe) = std::env::current_exe() else { return };
        let Some(dir) = std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join("com.hyperstream.desktop").join("bridge")) else {
            return;
        };
        let _ = std::fs::create_dir_all(&dir);
        let manifest_path = dir.join(format!("{}.json", HOST_NAME));
        let manifest = serde_json::json!({
            "name": HOST_NAME,
            "description": "HyperStream",
            "path": exe.to_string_lossy(),
            "type": "stdio",
            "allowed_origins": EXTENSION_IDS.iter().map(|id| format!("chrome-extension://{}/", id)).collect::<Vec<_>>(),
        });
        let text = serde_json::to_string_pretty(&manifest).unwrap_or_default();
        if std::fs::read_to_string(&manifest_path).ok().as_deref() != Some(text.as_str()) && std::fs::write(&manifest_path, &text).is_err() {
            return;
        }
        for key in BROWSER_KEYS {
            set_default_value(&format!(r"{}\{}", key, HOST_NAME), &manifest_path.to_string_lossy());
        }
    }
}

#[cfg(windows)]
fn set_default_value(subkey: &str, value: &str) {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let key: Vec<u16> = subkey.encode_utf16().chain(Some(0)).collect();
    let data: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
    unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            std::ptr::null(),
            REG_SZ,
            data.as_ptr().cast(),
            (data.len() * 2) as u32,
        );
    }
}

// ------------------------------------------------------------------ inside the app

/// Sign-ins handed over by the extension, per site, for the next look-up and download.
static BROWSER_SIGN_INS: Mutex<Vec<(String, Instant, String)>> = Mutex::new(Vec::new());
const SIGN_IN_KEPT_FOR: Duration = Duration::from_secs(2 * 3600);

/// Cookies the extension sent for this site (Netscape format), if recent.
pub fn cookies_from_extension(url: &str) -> Option<String> {
    let site = crate::browser::site_key_of_url(url)?;
    let mut list = BROWSER_SIGN_INS.lock().ok()?;
    list.retain(|(_, at, _)| at.elapsed() < SIGN_IN_KEPT_FOR);
    list.iter().rev().find(|(s, _, _)| *s == site).map(|(_, _, c)| c.clone())
}

fn keep_cookies(url: &str, cookies: &[BrowserCookie]) -> Option<String> {
    if cookies.is_empty() {
        return None;
    }
    let lines: Vec<crate::downloader::cookies::CookieLine<'_>> = cookies
        .iter()
        .map(|c| crate::downloader::cookies::CookieLine {
            domain: &c.domain,
            host_only: c.host_only,
            path: &c.path,
            secure: c.secure,
            expires: c.expires,
            name: &c.name,
            value: &c.value,
        })
        .collect();
    let text = crate::downloader::cookies::to_netscape(&lines);
    if let (Some(site), Ok(mut list)) = (crate::browser::site_key_of_url(url), BROWSER_SIGN_INS.lock()) {
        list.retain(|(s, at, _)| *s != site && at.elapsed() < SIGN_IN_KEPT_FOR);
        list.push((site, Instant::now(), text.clone()));
    }
    Some(text)
}

fn web_address(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url.trim()).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
}

fn bring_forward(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

async fn handle(app: &AppHandle, request: Request) -> serde_json::Value {
    use serde_json::json;
    match request.kind.as_str() {
        "ping" => {
            let _ = app.emit("extension-connected", &request.browser);
            json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })
        }
        "page" | "media" => {
            let Some(url) = web_address(&request.url) else { return json!({ "ok": false, "error": "Not a web address." }) };
            keep_cookies(&url, &request.cookies);
            if let Some(page) = web_address(&request.page) {
                keep_cookies(&page, &request.cookies);
            }
            // Same as other links from outside: it lands in the Hub, the user picks the quality.
            crate::queue_external_page(app, url);
            json!({ "ok": true })
        }
        "file" => {
            let Some(url) = web_address(&request.url) else { return json!({ "ok": false, "error": "Not a web address." }) };
            let cookies = keep_cookies(&url, &request.cookies);
            let filename = if request.filename.trim().is_empty() { crate::downloader::orchestrator::file_name_from_url(&url) } else { request.filename.clone() };
            let options = crate::downloader::DownloadOptions {
                url: url.clone(),
                title: if request.title.trim().is_empty() { filename.clone() } else { request.title.clone() },
                cookies,
                direct: Some(crate::downloader::orchestrator::DirectFile {
                    filename,
                    referrer: web_address(&request.referrer),
                    user_agent: (!request.user_agent.trim().is_empty()).then(|| request.user_agent.clone()),
                }),
                ..Default::default()
            };
            let orchestrator = app.state::<crate::downloader::DownloadOrchestrator>();
            match orchestrator.start_download(app.clone(), options, None).await {
                Ok(task_id) => {
                    let _ = app.emit("show-downloads", ());
                    bring_forward(app);
                    json!({ "ok": true, "task": task_id })
                }
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        _ => json!({ "ok": false, "error": "Unknown request." }),
    }
}

/// Listens for the host process. Only local connections from this user's session get through.
#[cfg(windows)]
pub fn serve(app: AppHandle) {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
    use tokio::net::windows::named_pipe::ServerOptions;

    tauri::async_runtime::spawn(async move {
        let name = pipe_name();
        let mut server = match ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(&name) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Browser extension connection unavailable: {e}");
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                continue;
            }
            let client = server;
            server = match ServerOptions::new().reject_remote_clients(true).create(&name) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("Browser extension connection stopped: {e}");
                    return;
                }
            };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let mut client = client;
                let mut line = String::new();
                {
                    let mut reader = tokio::io::BufReader::new(&mut client).take(MAX_MESSAGE as u64);
                    if reader.read_line(&mut line).await.is_err() {
                        return;
                    }
                }
                let reply = match serde_json::from_str::<Request>(line.trim()) {
                    Ok(request) => handle(&app, request).await,
                    Err(_) => serde_json::json!({ "ok": false, "error": "Unreadable request." }),
                };
                let _ = client.write_all(format!("{}\n", reply).as_bytes()).await;
                let _ = client.flush().await;
            });
        }
    });
}

#[cfg(not(windows))]
pub fn serve(_app: AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_parse_with_missing_fields() {
        let r: Request = serde_json::from_str(r#"{"v":1,"kind":"file","url":"https://x.test/a.zip","cookies":[{"domain":".x.test","hostOnly":false,"path":"/","secure":true,"expires":0,"name":"s","value":"1"}]}"#).unwrap();
        assert_eq!(r.kind, "file");
        assert_eq!(r.cookies.len(), 1);
        assert!(r.filename.is_empty());
    }

    #[test]
    fn only_web_addresses_are_accepted() {
        assert!(web_address("https://example.com/video").is_some());
        assert!(web_address("file:///C:/Windows/notepad.exe").is_none());
        assert!(web_address("javascript:alert(1)").is_none());
    }
}
