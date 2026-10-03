//! Direct WebView2 access for the built-in browser: navigation state, context menu, keyboard
//! shortcuts, page full screen, request blocking, extensions and page snapshots.
//! COM calls run on the main thread via `with_webview`; results come back through channels.

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::*;
use windows::core::{Interface, BOOL, HSTRING, PWSTR};
use windows::Win32::System::Com::{IStream, STREAM_SEEK_SET};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_F6, VK_MENU};
use windows::Win32::UI::Shell::SHCreateMemStream;

use super::shields;

// `webview2_com::*` brings its own Result; ours carries plain messages.
type Result<T, E = String> = std::result::Result<T, E>;

/// What the toolbar shows. Sent as `browser-state` whenever any of it changes.
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavState {
    pub url: String,
    pub title: String,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub loading: bool,
}

static LAST_STATE: Mutex<Option<NavState>> = Mutex::new(None);
/// Requests Shields blocked on the current page.
static BLOCKED_ON_PAGE: AtomicU32 = AtomicU32::new(0);

pub fn blocked_on_page() -> u32 {
    BLOCKED_ON_PAGE.load(Ordering::Relaxed)
}

pub fn last_state() -> Option<NavState> {
    LAST_STATE.lock().ok().and_then(|s| s.clone())
}

fn read_string(f: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> String {
    let mut value = PWSTR::null();
    match f(&mut value) {
        Ok(()) => take_pwstr(value),
        Err(_) => String::new(),
    }
}

fn read_bool(f: impl FnOnce(*mut BOOL) -> windows::core::Result<()>) -> bool {
    let mut value = BOOL::default();
    f(&mut value).is_ok() && value.as_bool()
}

fn host_of(url: &str) -> Option<String> {
    tauri::Url::parse(url).ok()?.host_str().map(str::to_string)
}

unsafe fn nav_state(core: &ICoreWebView2, loading: bool) -> NavState {
    NavState {
        url: read_string(|p| core.Source(p)),
        title: read_string(|p| core.DocumentTitle(p)),
        can_go_back: read_bool(|b| core.CanGoBack(b)),
        can_go_forward: read_bool(|b| core.CanGoForward(b)),
        loading,
    }
}

/// Which "Download with HyperStream" entry to offer for a right-clicked element, if any.
pub fn download_target(is_media: bool, is_page: bool, link: &str, source: &str, page: &str) -> Option<(&'static str, String)> {
    let is_web = |u: &str| u.starts_with("https://") || u.starts_with("http://");
    if is_web(link) {
        return Some(("Download link with HyperStream", link.to_string()));
    }
    if is_media {
        // Players usually stream from blob: URLs; the page link is what yt-dlp understands.
        let url = if is_web(source) { source } else { page };
        return is_web(url).then(|| ("Download with HyperStream", url.to_string()));
    }
    if is_page && is_web(page) {
        return Some(("Download with HyperStream", page.to_string()));
    }
    None
}

/// Registers every browser event handler. Called once, right after the webview is created.
pub fn attach(app: &AppHandle, webview: &tauri::Webview) {
    let app = app.clone();
    let _ = webview.with_webview(move |pw| unsafe {
        if let Err(e) = register(app, pw.controller(), pw.environment()) {
            log::warn!("Browser events unavailable: {e}");
        }
    });
}

unsafe fn register(app: AppHandle, controller: ICoreWebView2Controller, env: ICoreWebView2Environment) -> windows::core::Result<()> {
    let core = controller.CoreWebView2()?;
    let loading = Rc::new(Cell::new(false));
    let mut token = 0i64;

    let publish: Rc<dyn Fn(&ICoreWebView2)> = {
        let app = app.clone();
        let loading = loading.clone();
        Rc::new(move |core: &ICoreWebView2| {
            let state = nav_state(core, loading.get());
            if let Ok(mut last) = LAST_STATE.lock() {
                *last = Some(state.clone());
            }
            let _ = app.emit("browser-state", state);
        })
    };

    {
        let (publish, loading) = (publish.clone(), loading.clone());
        core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |sender, _| {
                loading.set(true);
                BLOCKED_ON_PAGE.store(0, Ordering::Relaxed);
                if let Some(core) = sender {
                    publish(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let (publish, loading) = (publish.clone(), loading.clone());
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                loading.set(false);
                if let Some(core) = sender {
                    publish(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let publish = publish.clone();
        core.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    publish(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let publish = publish.clone();
        core.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    publish(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    {
        let publish = publish.clone();
        core.add_DocumentTitleChanged(
            &DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    publish(&core);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // A video's full-screen button fills the whole window, like a real browser.
    {
        let app = app.clone();
        core.add_ContainsFullScreenElementChanged(
            &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(core) = sender {
                    let on = read_bool(|b| core.ContainsFullScreenElement(b));
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { super::set_page_fullscreen(&app, on) });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // The app window stays active while the page has keyboard focus; tell the UI so it doesn't
    // treat a click in the page as the app going to the background.
    for focused in [true, false] {
        let app = app.clone();
        let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
            let _ = app.emit("browser-page-focus", focused);
            Ok(())
        }));
        if focused {
            controller.add_GotFocus(&handler, &mut token)?;
        } else {
            controller.add_LostFocus(&handler, &mut token)?;
        }
    }

    // Ctrl+L / Alt+D / F6 jump to the address bar even while the page has focus; Ctrl+D saves a shortcut.
    {
        let app = app.clone();
        controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                    return Ok(());
                }
                let mut key = 0u32;
                args.VirtualKey(&mut key)?;
                let ctrl = GetKeyState(VK_CONTROL.0 as i32) < 0;
                let alt = GetKeyState(VK_MENU.0 as i32) < 0;
                let action = if (ctrl && !alt && key == u32::from(b'L')) || (alt && !ctrl && key == u32::from(b'D')) || key == u32::from(VK_F6.0) {
                    Some("focus-address")
                } else if ctrl && !alt && key == u32::from(b'D') {
                    Some("bookmark")
                } else {
                    None
                };
                if let Some(action) = action {
                    args.SetHandled(true)?;
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if action == "focus-address" {
                            if let Some(main) = app.get_webview("main") {
                                let _ = main.set_focus();
                            }
                        }
                        let _ = app.emit("browser-shortcut", action);
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Keep each visited site's icon for the start page; covers sites that refuse direct requests.
    if let Ok(core15) = core.cast::<ICoreWebView2_15>() {
        core15.add_FaviconChanged(
            &FaviconChangedEventHandler::create(Box::new(move |sender, _| {
                let Some(core15) = sender.and_then(|c| c.cast::<ICoreWebView2_15>().ok()) else { return Ok(()) };
                let page = read_string(|p| core15.Source(p));
                core15.GetFavicon(
                    COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
                    &GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
                        if let (Ok(()), Some(stream)) = (result, stream) {
                            if let Ok(bytes) = read_stream(&stream) {
                                super::site_icon::remember_from_browser(&page, bytes);
                            }
                        }
                        Ok(())
                    })),
                )
            })),
            &mut token,
        )?;
    }

    // Right-click → "Download with HyperStream" on links, videos and pages.
    if let (Ok(core11), Ok(env9)) = (core.cast::<ICoreWebView2_11>(), env.cast::<ICoreWebView2Environment9>()) {
        let app = app.clone();
        core11.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let target = args.ContextMenuTarget()?;
                let mut kind = COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND::default();
                target.Kind(&mut kind)?;
                let link = if read_bool(|b| target.HasLinkUri(b)) { read_string(|p| target.LinkUri(p)) } else { String::new() };
                let source = if read_bool(|b| target.HasSourceUri(b)) { read_string(|p| target.SourceUri(p)) } else { String::new() };
                let page = read_string(|p| target.PageUri(p));
                let is_media = kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_VIDEO || kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_AUDIO;
                let is_page = kind == COREWEBVIEW2_CONTEXT_MENU_TARGET_KIND_PAGE;
                let Some((label, url)) = download_target(is_media, is_page, &link, &source, &page) else {
                    return Ok(());
                };

                let item = env9.CreateContextMenuItem(&HSTRING::from(label), None::<&IStream>, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                let app = app.clone();
                let mut item_token = 0i64;
                item.add_CustomItemSelected(
                    &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        let _ = app.emit("browser-download-request", url.clone());
                        Ok(())
                    })),
                    &mut item_token,
                )?;
                let separator = env9.CreateContextMenuItem(&HSTRING::new(), None::<&IStream>, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR)?;
                let items = args.MenuItems()?;
                items.InsertValueAtIndex(0, &item)?;
                items.InsertValueAtIndex(1, &separator)?;
                Ok(())
            })),
            &mut token,
        )?;
    }

    // Shields: WebView2 only calls us for requests to listed ad/tracker hosts.
    for filter in shields::request_filters() {
        core.AddWebResourceRequestedFilter(&HSTRING::from(filter), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
    }
    core.add_WebResourceRequested(
        &WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
            let (Some(core), Some(args)) = (sender, args) else { return Ok(()) };
            let request = args.Request()?;
            let uri = read_string(|p| request.Uri(p));
            let page = read_string(|p| core.Source(p));
            let (Some(request_host), Some(page_host)) = (host_of(&uri), host_of(&page)) else { return Ok(()) };
            if shields::should_block(&request_host, &page_host) {
                let response = env.CreateWebResourceResponse(None::<&IStream>, 403, &HSTRING::from("Blocked"), &HSTRING::new())?;
                args.SetResponse(&response)?;
                BLOCKED_ON_PAGE.fetch_add(1, Ordering::Relaxed);
            }
            Ok(())
        })),
        &mut token,
    )?;

    publish(&core);
    Ok(())
}

// ---------- One-shot calls with a result ----------

/// Delivers one result from a COM callback back to the waiting async task.
struct Reply<T>(Rc<RefCell<Option<tokio::sync::oneshot::Sender<Result<T, String>>>>>);

impl<T> Clone for Reply<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> Reply<T> {
    fn send(&self, value: Result<T, String>) {
        if let Some(tx) = self.0.borrow_mut().take() {
            let _ = tx.send(value);
        }
    }
}

async fn with_core<T: Send + 'static>(
    webview: &tauri::Webview,
    f: impl FnOnce(ICoreWebView2, Reply<T>) + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |pw| {
            let reply = Reply(Rc::new(RefCell::new(Some(tx))));
            match unsafe { pw.controller().CoreWebView2() } {
                Ok(core) => f(core, reply),
                Err(e) => reply.send(Err(e.message())),
            }
        })
        .map_err(|e| e.to_string())?;
    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("The browser closed before finishing.".into()),
        Err(_) => Err("The browser didn't respond.".into()),
    }
}

/// Fire-and-forget COM call on the main thread.
fn with_core_do(webview: &tauri::Webview, f: impl FnOnce(ICoreWebView2) + Send + 'static) {
    let _ = webview.with_webview(move |pw| {
        if let Ok(core) = unsafe { pw.controller().CoreWebView2() } {
            f(core);
        }
    });
}

/// Puts a hidden page to sleep (scripts, timers and rendering stop, memory is trimmed)
/// (it's already muted and paused). Showing or navigating the page wakes it automatically.
pub fn sleep_if_hidden(webview: &tauri::Webview) {
    let _ = webview.with_webview(|pw| unsafe {
        let controller = pw.controller();
        if read_bool(|b| controller.IsVisible(b)) {
            return;
        }
        let Ok(core) = controller.CoreWebView2() else { return };
        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
            let _ = core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
        }
        if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
            let _ = core3.TrySuspend(&TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(()))));
        }
    });
}

/// Silences (or restores) all sound from the page.
pub fn set_muted(webview: &tauri::Webview, muted: bool) {
    with_core_do(webview, move |core| unsafe {
        if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
            let _ = core8.SetIsMuted(muted);
        }
    });
}

/// Undoes `sleep_if_hidden` (and the mute) before the page is shown.
pub fn wake(webview: &tauri::Webview) {
    with_core_do(webview, |core| unsafe {
        if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
            let _ = core8.SetIsMuted(false);
        }
        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
            let _ = core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
        }
        if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
            let _ = core3.Resume();
        }
    });
}

pub fn go_back(webview: &tauri::Webview) {
    with_core_do(webview, |core| unsafe {
        let _ = core.GoBack();
    });
}

pub fn go_forward(webview: &tauri::Webview) {
    with_core_do(webview, |core| unsafe {
        let _ = core.GoForward();
    });
}

pub fn stop(webview: &tauri::Webview) {
    with_core_do(webview, |core| unsafe {
        let _ = core.Stop();
    });
}

thread_local! {
    static PAGE_SCRIPT: RefCell<(u64, Option<String>)> = const { RefCell::new((0, None)) };
}

/// Replaces the script injected into every new document (Shields settings are baked in).
pub fn set_page_script(webview: &tauri::Webview, js: String) {
    with_core_do(webview, move |core| unsafe {
        let generation = PAGE_SCRIPT.with(|s| {
            let mut s = s.borrow_mut();
            if let Some(old) = s.1.take() {
                let _ = core.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(old));
            }
            s.0 += 1;
            s.0
        });
        let core_ = core.clone();
        let _ = core.AddScriptToExecuteOnDocumentCreated(
            &HSTRING::from(js),
            &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(move |result, id| {
                if result.is_ok() {
                    PAGE_SCRIPT.with(|s| {
                        let mut s = s.borrow_mut();
                        if s.0 == generation {
                            s.1 = Some(id);
                        } else {
                            // A newer script replaced this one while it was being added.
                            let _ = core_.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(id));
                        }
                    });
                }
                Ok(())
            })),
        );
    });
}

unsafe fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.message())?;
    let mut out = Vec::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let mut read = 0u32;
        let hr = stream.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read));
        if hr.is_err() || read == 0 {
            break;
        }
        out.extend_from_slice(&buf[..read as usize]);
    }
    Ok(out)
}

/// JPEG of what the page currently shows (drawn behind app panels while the page is hidden).
pub async fn capture_jpeg(webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    with_core(webview, |core, reply| unsafe {
        let Some(stream) = SHCreateMemStream(None) else {
            return reply.send(Err("Out of memory.".into()));
        };
        let (stream_, reply_) = (stream.clone(), reply.clone());
        let started = core.CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
            &stream,
            &CapturePreviewCompletedHandler::create(Box::new(move |result| {
                reply_.send(result.map_err(|e| e.message()).and_then(|_| read_stream(&stream_)));
                Ok(())
            })),
        );
        if let Err(e) = started {
            reply.send(Err(e.message()));
        }
    })
    .await
}

// ---------- Extensions ----------

#[derive(Clone, Debug)]
pub struct NativeExtension {
    pub id: String,
    pub enabled: bool,
}

unsafe fn describe(ext: &ICoreWebView2BrowserExtension) -> NativeExtension {
    NativeExtension {
        id: read_string(|p| ext.Id(p)),
        enabled: read_bool(|b| ext.IsEnabled(b)),
    }
}

unsafe fn profile(core: &ICoreWebView2) -> Result<ICoreWebView2Profile7, String> {
    core.cast::<ICoreWebView2_13>()
        .and_then(|c| c.Profile())
        .and_then(|p| p.cast::<ICoreWebView2Profile7>())
        .map_err(|_| "This version of WebView2 doesn't support extensions. Update Microsoft Edge WebView2 and try again.".to_string())
}

fn extension_error(e: windows::core::Error) -> String {
    let detail = e.message();
    let detail = detail.trim();
    if detail.is_empty() {
        format!("The browser couldn't turn on this extension (error {:#010x}).", e.code().0)
    } else {
        format!("The browser couldn't turn on this extension: {detail}")
    }
}

/// Deletes cookies, cache, history and site storage for the browser profile (signs out of every site).
/// Installed extensions stay.
pub async fn clear_browsing_data(webview: &tauri::Webview) -> Result<(), String> {
    with_core(webview, |core, reply| unsafe {
        let profile = match profile(&core) {
            Ok(p) => p,
            Err(e) => return reply.send(Err(e)),
        };
        let reply_ = reply.clone();
        let started = profile.ClearBrowsingDataAll(&ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
            reply_.send(result.map_err(|e| format!("The browser couldn't clear its data: {}", e.message())));
            Ok(())
        })));
        if let Err(e) = started {
            reply.send(Err(e.message()));
        }
    })
    .await
}

/// Loads (or reloads) an unpacked extension folder. Returns its runtime id.
pub async fn add_extension(webview: &tauri::Webview, folder: PathBuf) -> Result<NativeExtension, String> {
    with_core(webview, move |core, reply| unsafe {
        let profile = match profile(&core) {
            Ok(p) => p,
            Err(e) => return reply.send(Err(e)),
        };
        let reply_ = reply.clone();
        let started = profile.AddBrowserExtension(
            &HSTRING::from(folder.as_path()),
            &ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, ext| {
                reply_.send(match (result, ext) {
                    (Ok(()), Some(ext)) => Ok(describe(&ext)),
                    (Err(e), _) => Err(extension_error(e)),
                    (Ok(()), None) => Err("The browser didn't load the extension.".into()),
                });
                Ok(())
            })),
        );
        if let Err(e) = started {
            reply.send(Err(extension_error(e)));
        }
    })
    .await
}

/// Runs `action` on each installed extension that matches `id` (or on all of them when `id` is None)
/// and returns the list as it was before.
async fn for_extensions(
    webview: &tauri::Webview,
    id: Option<String>,
    action: impl Fn(&ICoreWebView2BrowserExtension, Reply<Vec<NativeExtension>>, Vec<NativeExtension>) + 'static + Send,
) -> Result<Vec<NativeExtension>, String> {
    with_core(webview, move |core, reply| unsafe {
        let profile = match profile(&core) {
            Ok(p) => p,
            Err(e) => return reply.send(Err(e)),
        };
        let reply_ = reply.clone();
        let started = profile.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
            move |result, list| {
                let list = match (result, list) {
                    (Ok(()), Some(list)) => list,
                    (Err(e), _) => return Ok(reply_.send(Err(e.message()))),
                    _ => return Ok(reply_.send(Ok(Vec::new()))),
                };
                let mut count = 0u32;
                let _ = list.Count(&mut count);
                let all: Vec<(ICoreWebView2BrowserExtension, NativeExtension)> = (0..count)
                    .filter_map(|i| list.GetValueAtIndex(i).ok())
                    .map(|ext| {
                        let info = describe(&ext);
                        (ext, info)
                    })
                    .collect();
                let infos: Vec<NativeExtension> = all.iter().map(|(_, i)| i.clone()).collect();
                match &id {
                    Some(id) => match all.iter().find(|(_, info)| &info.id == id) {
                        Some((ext, _)) => action(ext, reply_.clone(), infos),
                        None => reply_.send(Ok(infos)),
                    },
                    None => reply_.send(Ok(infos)),
                }
                Ok(())
            },
        )));
        if let Err(e) = started {
            reply.send(Err(e.message()));
        }
    })
    .await
}

/// What the profile really has loaded (it remembers extensions between launches).
pub async fn list_extensions(webview: &tauri::Webview) -> Result<Vec<NativeExtension>, String> {
    for_extensions(webview, None, |_, reply, infos| reply.send(Ok(infos))).await
}

pub async fn remove_extension(webview: &tauri::Webview, id: &str) -> Result<(), String> {
    for_extensions(webview, Some(id.to_string()), |ext, reply, infos| unsafe {
        let reply_ = reply.clone();
        let started = ext.Remove(&BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
            reply_.send(result.map(|_| infos).map_err(|e| e.message()));
            Ok(())
        })));
        if let Err(e) = started {
            reply.send(Err(e.message()));
        }
    })
    .await
    .map(|_| ())
}

pub async fn enable_extension(webview: &tauri::Webview, id: &str, enabled: bool) -> Result<(), String> {
    for_extensions(webview, Some(id.to_string()), move |ext, reply, infos| unsafe {
        let reply_ = reply.clone();
        let started = ext.Enable(
            enabled,
            &BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| {
                reply_.send(result.map(|_| infos).map_err(|e| e.message()));
                Ok(())
            })),
        );
        if let Err(e) = started {
            reply.send(Err(e.message()));
        }
    })
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::download_target;

    #[test]
    fn offers_the_most_useful_download_link() {
        assert_eq!(
            download_target(false, false, "https://youtu.be/x", "", "https://www.youtube.com/").unwrap().1,
            "https://youtu.be/x"
        );
        // Blob-backed players fall back to the page.
        assert_eq!(
            download_target(true, false, "", "blob:https://www.youtube.com/123", "https://www.youtube.com/watch?v=x").unwrap().1,
            "https://www.youtube.com/watch?v=x"
        );
        assert_eq!(download_target(true, false, "", "https://cdn.site/v.mp4", "https://site/").unwrap().1, "https://cdn.site/v.mp4");
        assert_eq!(download_target(false, true, "", "", "https://vimeo.com/1").unwrap().1, "https://vimeo.com/1");
        assert!(download_target(false, false, "", "", "https://site/").is_none(), "images and selected text get no entry");
        assert!(download_target(false, true, "", "", "about:blank").is_none());
    }
}
