//! Reuses the in-app browser's session for sites that need sign-in.
//! Cookies are read fresh right before each yt-dlp run and never persisted.

use tauri::AppHandle;

pub struct CookieLine<'a> {
    pub domain: &'a str,
    pub host_only: bool,
    pub path: &'a str,
    pub secure: bool,
    /// Unix seconds; 0 for session cookies.
    pub expires: i64,
    pub name: &'a str,
    pub value: &'a str,
}

/// Renders cookies in the Netscape format yt-dlp's `--cookies` expects.
pub fn to_netscape(cookies: &[CookieLine<'_>]) -> String {
    let mut out = String::from("# Netscape HTTP Cookie File\n");
    for c in cookies {
        // Tabs/newlines would corrupt the file format.
        if c.name.contains(['\t', '\n']) || c.value.contains(['\t', '\n']) {
            continue;
        }
        let domain = if c.host_only || c.domain.starts_with('.') {
            c.domain.to_string()
        } else {
            format!(".{}", c.domain)
        };
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            domain,
            if c.host_only { "FALSE" } else { "TRUE" },
            if c.path.is_empty() { "/" } else { c.path },
            if c.secure { "TRUE" } else { "FALSE" },
            c.expires.max(0),
            c.name,
            c.value
        ));
    }
    out
}

/// Cookies the in-app browser's profile holds for `url` (saved sign-ins survive restarts),
/// or None when there are none. Must run off the main thread (WebView2 deadlocks otherwise).
pub fn browser_cookies_for(app: &AppHandle, url: &str) -> Option<String> {
    let parsed: tauri::Url = url.parse().ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = parsed.host_str()?.to_string();
    let webview = crate::browser::webview_for_cookies(app, url)?;
    let cookies = webview.cookies_for_url(parsed).ok()?;
    if cookies.is_empty() {
        return None;
    }

    let lines: Vec<CookieLine<'_>> = cookies
        .iter()
        .map(|c| {
            let (domain, host_only) = match c.domain() {
                Some(d) => (d, false),
                None => (host.as_str(), true),
            };
            CookieLine {
                domain,
                host_only,
                path: c.path().unwrap_or("/"),
                secure: c.secure().unwrap_or(false),
                expires: c
                    .expires()
                    .and_then(|e| e.datetime())
                    .map(|dt| dt.unix_timestamp())
                    .unwrap_or(0),
                name: c.name(),
                value: c.value(),
            }
        })
        .collect();
    Some(to_netscape(&lines))
}

/// Async-safe wrapper: reads browser cookies on a blocking thread.
pub async fn browser_cookies_async(app: &AppHandle, url: &str) -> Option<String> {
    // Sent by the browser extension along with the link: the user's own browser sign-in.
    if let Some(cookies) = crate::bridge::cookies_from_extension(url) {
        return Some(cookies);
    }
    let app = app.clone();
    let url = url.to_string();
    tauri::async_runtime::spawn_blocking(move || browser_cookies_for(&app, &url))
        .await
        .ok()
        .flatten()
}

/// The Cookie header a browser would send to `url`, from Netscape-format cookies.
pub fn header_for_url(netscape: &str, url: &str) -> Option<String> {
    let parsed: tauri::Url = url.parse().ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let path = parsed.path();
    let https = parsed.scheme() == "https";
    let pairs: Vec<String> = netscape
        .lines()
        .filter(|l| !l.starts_with('#') || l.starts_with("#HttpOnly_"))
        .filter_map(|l| {
            let l = l.strip_prefix("#HttpOnly_").unwrap_or(l);
            let f: Vec<&str> = l.split('\t').collect();
            if f.len() < 7 {
                return None;
            }
            let domain = f[0].trim_start_matches('.').to_ascii_lowercase();
            let domain_ok = host == domain || (f[1] == "TRUE" && host.ends_with(&format!(".{}", domain)));
            let path_ok = path.starts_with(f[2]);
            let secure_ok = f[3] != "TRUE" || https;
            (domain_ok && path_ok && secure_ok).then(|| format!("{}={}", f[5], f[6]))
        })
        .collect();
    (!pairs.is_empty()).then(|| pairs.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_header_matches_domain_path_and_scheme() {
        let text = "# Netscape HTTP Cookie File\n.x.test\tTRUE\t/\tTRUE\t0\ta\t1\nfiles.x.test\tFALSE\t/dl\tFALSE\t0\tb\t2\nother.test\tTRUE\t/\tFALSE\t0\tc\t3\n";
        assert_eq!(header_for_url(text, "https://files.x.test/dl/a.zip").as_deref(), Some("a=1; b=2"));
        assert_eq!(header_for_url(text, "http://files.x.test/other").as_deref(), None);
    }

    #[test]
    fn renders_netscape_lines() {
        let text = to_netscape(&[
            CookieLine { domain: ".instagram.com", host_only: false, path: "/", secure: true, expires: 1900000000, name: "sessionid", value: "abc" },
            CookieLine { domain: "www.example.com", host_only: true, path: "", secure: false, expires: 0, name: "a", value: "b" },
            CookieLine { domain: "example.com", host_only: false, path: "/", secure: false, expires: 0, name: "bad", value: "x\ty" },
        ]);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "# Netscape HTTP Cookie File");
        assert_eq!(lines[1], ".instagram.com\tTRUE\t/\tTRUE\t1900000000\tsessionid\tabc");
        assert_eq!(lines[2], "www.example.com\tFALSE\t/\tFALSE\t0\ta\tb");
        assert_eq!(lines.len(), 3, "cookies with tabs must be skipped");
    }
}
