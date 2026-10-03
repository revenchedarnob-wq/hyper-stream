//! Site logos for start-page shortcuts. Fetched once from the site itself (no third-party
//! favicon service, so the user's site list never leaves the PC) and cached on disk.

use base64::Engine;
use regex::Regex;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

const MAX_PAGE_BYTES: usize = 512 * 1024;
const MAX_ICON_BYTES: usize = 256 * 1024;
/// A site that had no usable icon is asked again after this long.
const RETRY_MISSING_AFTER: Duration = Duration::from_secs(3 * 24 * 3600);
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

fn cache_dir() -> PathBuf {
    let dir = super::data_root().join("site-icons");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Lowercase host without "www.", restricted to characters that are safe in a file name.
fn host_key(url: &reqwest::Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let safe = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    safe.then_some(host)
}

fn parse_url(input: &str) -> Option<reqwest::Url> {
    let input = input.trim();
    let with_scheme = if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    reqwest::Url::parse(&with_scheme).ok().filter(|u| u.host_str().is_some())
}

/// MIME type from the file's first bytes; anything else is not an image we show.
fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else if bytes.starts_with(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
        head.contains("<svg").then_some("image/svg+xml")
    }
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn read_cached(host: &str) -> Option<Option<String>> {
    let path = cache_dir().join(host);
    if let Ok(bytes) = std::fs::read(&path) {
        return sniff_mime(&bytes).map(|mime| Some(data_url(mime, &bytes)));
    }
    let missing = cache_dir().join(format!("{host}.none"));
    let fresh = std::fs::metadata(&missing)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < RETRY_MISSING_AFTER);
    fresh.then_some(None)
}

async fn read_limited(response: reqwest::Response, limit: usize) -> Option<Vec<u8>> {
    if response.content_length().is_some_and(|len| len as usize > limit) {
        return None;
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > limit {
            return None;
        }
    }
    Some(body)
}

struct Candidate {
    href: String,
    score: u32,
}

/// `<link rel="…icon…">` tags, best first: big touch icons and SVGs beat 16px favicons.
fn icon_candidates(html: &str) -> Vec<Candidate> {
    static LINK: OnceLock<Regex> = OnceLock::new();
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let link = LINK.get_or_init(|| Regex::new(r"(?is)<link\b[^>]*>").unwrap());
    let attr = ATTR.get_or_init(|| Regex::new(r#"(?is)([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());

    let mut out = Vec::new();
    for tag in link.find_iter(html) {
        let (mut rel, mut href, mut sizes, mut kind) = (String::new(), String::new(), String::new(), String::new());
        for cap in attr.captures_iter(tag.as_str()) {
            let value = cap.get(2).or(cap.get(3)).or(cap.get(4)).map_or("", |m| m.as_str());
            match cap[1].to_ascii_lowercase().as_str() {
                "rel" => rel = value.to_ascii_lowercase(),
                "href" => href = value.replace("&amp;", "&"),
                "sizes" => sizes = value.to_ascii_lowercase(),
                "type" => kind = value.to_ascii_lowercase(),
                _ => {}
            }
        }
        // mask-icon is a single-colour stencil, not a logo.
        if href.is_empty() || !rel.contains("icon") || rel.contains("mask-icon") {
            continue;
        }
        let declared = sizes
            .split_whitespace()
            .filter_map(|s| s.split('x').next()?.parse::<u32>().ok())
            .max();
        let is_svg = kind.contains("svg") || href.to_ascii_lowercase().split('?').next().unwrap_or("").ends_with(".svg");
        let size = declared.unwrap_or(if rel.contains("apple-touch-icon") {
            180
        } else if is_svg || sizes == "any" {
            160
        } else {
            16
        });
        // Prefer 64–256px; past that it only costs bytes.
        let score = if size > 256 { 256 - (size - 256).min(200) / 4 } else { size };
        out.push(Candidate { href, score });
    }
    out.sort_by(|a, b| b.score.cmp(&a.score));
    out
}

async fn fetch_icon(client: &reqwest::Client, url: reqwest::Url) -> Option<(&'static str, Vec<u8>)> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = read_limited(response, MAX_ICON_BYTES).await?;
    let mime = sniff_mime(&bytes)?;
    Some((mime, bytes))
}

async fn discover(origin: reqwest::Url) -> Option<(&'static str, Vec<u8>)> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let mut urls: Vec<reqwest::Url> = Vec::new();
    if let Ok(page) = client.get(origin.clone()).send().await {
        // Relative hrefs resolve against where redirects actually landed.
        let base = page.url().clone();
        if page.status().is_success() {
            if let Some(body) = read_limited(page, MAX_PAGE_BYTES).await {
                let html = String::from_utf8_lossy(&body);
                urls.extend(icon_candidates(&html).iter().filter_map(|c| base.join(&c.href).ok()));
            }
        }
        for fallback in ["/apple-touch-icon.png", "/favicon.ico"] {
            if let Ok(u) = base.join(fallback) {
                urls.push(u);
            }
        }
    }
    for fallback in ["/apple-touch-icon.png", "/favicon.ico"] {
        if let Ok(u) = origin.join(fallback) {
            urls.push(u);
        }
    }
    urls.dedup();

    for url in urls.into_iter().filter(|u| matches!(u.scheme(), "http" | "https")).take(6) {
        if let Some(found) = fetch_icon(&client, url).await {
            return Some(found);
        }
    }
    None
}

/// Icon the built-in browser showed for a page. Fills the cache when the site had none or
/// refused direct requests; never replaces a logo already fetched (usually a larger one).
pub(crate) fn remember_from_browser(page_url: &str, png: Vec<u8>) {
    let Some(host) = parse_url(page_url).as_ref().and_then(host_key) else { return };
    // Skip empty or 1px placeholders.
    if png.len() < 100 || sniff_mime(&png) != Some("image/png") {
        return;
    }
    let path = cache_dir().join(&host);
    if path.exists() {
        return;
    }
    let _ = std::fs::write(path, png);
    let _ = std::fs::remove_file(cache_dir().join(format!("{host}.none")));
}

/// The site's logo as a `data:` URL (so the page can also read its colours), or `None`.
#[tauri::command]
pub async fn site_icon(url: String) -> Result<Option<String>, String> {
    let Some(parsed) = parse_url(&url) else { return Ok(None) };
    let Some(host) = host_key(&parsed) else { return Ok(None) };
    if let Some(cached) = read_cached(&host) {
        return Ok(cached);
    }
    let Ok(origin) = reqwest::Url::parse(&format!("{}://{}/", parsed.scheme(), parsed.host_str().unwrap_or(&host))) else {
        return Ok(None);
    };
    match discover(origin).await {
        Some((mime, bytes)) => {
            let _ = std::fs::write(cache_dir().join(&host), &bytes);
            let _ = std::fs::remove_file(cache_dir().join(format!("{host}.none")));
            Ok(Some(data_url(mime, &bytes)))
        }
        None => {
            let _ = std::fs::write(cache_dir().join(format!("{host}.none")), b"");
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_touch_icons_and_svg_over_tiny_favicons() {
        let html = r#"<link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
            <link rel="mask-icon" href="/mask.svg">
            <link rel='icon' type='image/png' sizes='32x32' href='/32.png?a=1&amp;b=2'>"#;
        let hrefs: Vec<_> = icon_candidates(html).into_iter().map(|c| c.href).collect();
        assert_eq!(hrefs, vec!["/touch.png", "/32.png?a=1&b=2", "/favicon.ico"]);
    }

    #[test]
    fn host_key_rejects_unsafe_names() {
        let ok = parse_url("www.YouTube.com/watch").unwrap();
        assert_eq!(host_key(&ok).as_deref(), Some("youtube.com"));
        assert!(parse_url("").is_none());
    }

    #[test]
    fn sniffs_only_real_images() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(sniff_mime(b"<?xml?><svg xmlns='x'/>"), Some("image/svg+xml"));
        assert_eq!(sniff_mime(b"<html>not found</html>"), None);
    }
}
