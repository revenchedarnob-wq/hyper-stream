//! Debug-only end-to-end check of the browser plumbing. Run with HS_BROWSER_SELFTEST=1
//! (and LOCALAPPDATA/APPDATA pointed at a scratch folder); results go to HS_BROWSER_SELFTEST_LOG.

use std::io::Write;
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn log(line: String) {
    let path = std::env::var("HS_BROWSER_SELFTEST_LOG").unwrap_or_else(|_| "hs_selftest.log".into());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

async fn eval(w: &tauri::Webview, js: &str) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = std::sync::Mutex::new(Some(tx));
    let _ = w.eval_with_callback(js, move |result| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    });
    tokio::time::timeout(Duration::from_secs(10), rx).await.ok().and_then(|r| r.ok()).unwrap_or_else(|| "<timeout>".into())
}

async fn wait_loaded(secs: u64) {
    for _ in 0..secs * 4 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if super::native::last_state().is_some_and(|s| !s.loading && s.url != "about:blank") {
            tokio::time::sleep(Duration::from_millis(800)).await;
            return;
        }
    }
}

pub fn run(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        log("== start".into());
        let state = app.state::<super::BrowserState>();
        let _ = super::update_browser_bounds(app.clone(), state, 0, 0, 1000, 700);
        let _ = super::set_browser_visibility(app.clone(), true, None);
        super::browser_set_shields(app.clone(), true, vec![]);

        let t = std::time::Instant::now();
        let r = super::navigate_browser(app.clone(), app.state(), "https://example.com/".into(), None).await;
        log(format!("navigate example.com: {r:?} after {:?}", t.elapsed()));
        wait_loaded(20).await;
        log(format!("state: {:?}", super::native::last_state()));
        let w = app.get_webview(super::LABEL).unwrap();
        log(format!("page script: {}", eval(&w, "JSON.stringify([typeof window.__HYPERSTREAM_SHIELDS__, window.__HYPERSTREAM_SHIELDS_CONFIG__])").await));

        let _ = super::navigate_browser(app.clone(), app.state(), "https://www.iana.org/help/example-domains".into(), None).await;
        wait_loaded(20).await;
        log(format!("second page: {:?}", super::native::last_state()));
        super::browser_go_back(app.clone());
        tokio::time::sleep(Duration::from_secs(3)).await;
        log(format!("after back: {:?}", super::native::last_state()));
        super::browser_go_back(app.clone());
        tokio::time::sleep(Duration::from_secs(2)).await;
        log(format!("after back to start: {:?}", super::native::last_state()));

        match super::browser_snapshot(app.clone()).await {
            Ok(Some(s)) => log(format!("snapshot: {} chars, {}", s.len(), &s[..30])),
            other => log(format!("snapshot: {other:?}")),
        }

        let _ = super::navigate_browser(app.clone(), app.state(), "https://edition.cnn.com/".into(), None).await;
        wait_loaded(30).await;
        tokio::time::sleep(Duration::from_secs(4)).await;
        log(format!("cnn blocked requests: {}", super::native::blocked_on_page()));

        for input in [
            "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh",
            "ddkjiahejlhfcafbddmgiahcphecmpfh",
            "https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odfafepnkmbhccpbejgmiehpchacaeak",
        ] {
            let t = std::time::Instant::now();
            let r = super::extensions::install_from_store(&app, input).await;
            log(format!("install {input}: {r:?} after {:?}", t.elapsed()));
        }
        for ext in super::extensions::list() {
            log(format!(
                "listed: {} {} {} enabled={} options={} popup={} icon={} err={:?} legacy={}",
                ext.id, ext.name, ext.version, ext.enabled, ext.has_options, ext.has_popup, ext.icon.is_some(), ext.error, ext.legacy_format
            ));
        }
        log(format!("native: {:?}", super::native::list_extensions(&w).await.map(|l| l.iter().map(|e| (e.id.clone(), e.enabled)).collect::<Vec<_>>())));
        log(format!("options url: {:?}", super::extensions::page_url("eimadpbcbfnmbkopoojfekhnkhdbieeh", "options")));
        if let Ok(url) = super::extensions::page_url("eimadpbcbfnmbkopoojfekhnkhdbieeh", "options") {
            let r = super::navigate_browser(app.clone(), app.state(), url, None).await;
            wait_loaded(10).await;
            log(format!("open options: {r:?} state {:?}", super::native::last_state()));
        }
        log(format!("disable: {:?}", super::extensions::set_enabled(&app, "eimadpbcbfnmbkopoojfekhnkhdbieeh", false).await));
        log(format!("native after disable: {:?}", super::native::list_extensions(&w).await.map(|l| l.iter().map(|e| (e.id.clone(), e.enabled)).collect::<Vec<_>>())));
        log(format!("enable: {:?}", super::extensions::set_enabled(&app, "eimadpbcbfnmbkopoojfekhnkhdbieeh", true).await));
        log(format!("uninstall: {:?}", super::extensions::uninstall(&app, "eimadpbcbfnmbkopoojfekhnkhdbieeh").await));
        log(format!("native after uninstall: {:?}", super::native::list_extensions(&w).await.map(|l| l.len())));
        log(format!("updates: {:?}", super::extensions::update_all(&w).await));
        log("== done".into());
        tokio::time::sleep(Duration::from_millis(500)).await;
        app.exit(0);
    });
}
