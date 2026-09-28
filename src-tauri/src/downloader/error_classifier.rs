//! Maps raw yt-dlp / network stderr into a single human-readable sentence.
//! Pure string logic — no I/O, no network — fully unit-testable.

/// Convert a raw error string (often several yt-dlp `ERROR:` lines joined
/// together) into one concise, user-friendly message for the UI.
pub fn classify_download_error(raw: &str) -> String {
    let lower = raw.to_lowercase();

    // Ordered most-specific → least-specific. First match wins.
    let rules: &[(&[&str], &str)] = &[
        (&["http error 403", "forbidden"],
            "Access was denied by the server (HTTP 403). The link may have expired — refresh the page and copy a fresh URL."),
        (&["http error 404", "not found"],
            "The media could not be found (HTTP 404). It may have been removed, or the URL is incorrect."),
        (&["http error 429", "too many requests"],
            "The server is rate-limiting requests (HTTP 429). Please wait a few minutes and try again."),
        (&["geo", "geo-restricted", "geo restricted", "not available in your country"],
            "This content is not available in your region."),
        (&["sign in", "log in", "login required", "requires authentication",
           "private video", "members-only", "members only", "this video is private"],
            "This content requires you to be signed in. Provide account cookies and try again."),
        (&["unsupported url", "no video formats", "unable to extract", "no media found"],
            "This site or URL is not supported, or no downloadable media was found on the page."),
        (&["name or service not known", "getaddrinfo", "failed to resolve",
           "temporary failure in name resolution"],
            "Network error: the server could not be reached. Check your internet connection."),
        (&["timed out", "timeout", "connection reset", "connection aborted",
           "read timed out", "connection refused"],
            "The connection timed out or was interrupted. Check your network and try again."),
        (&["certificate verify failed", "ssl", "certificate"],
            "A secure connection could not be established (SSL certificate error)."),
        (&["no space left", "disk full", "not enough space"],
            "Not enough free disk space to complete the download."),
        (&["permission denied", "access is denied", "os error 5"],
            "Permission was denied writing the output file. Choose a different folder and try again."),
        (&["ffmpeg", "postprocessing", "merger", "not installed"],
            "Post-processing failed while merging audio and video. The media engine (FFmpeg) may be missing or outdated."),
    ];

    for (needles, message) in rules {
        if needles.iter().any(|n| lower.contains(n)) {
            return message.to_string();
        }
    }

    // Fallback: strip noisy prefixes, cap length, keep it readable.
    let cleaned = raw.replace("ERROR:", "").replace("error:", "");
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "The download failed for an unknown reason. Please try again.".to_string()
    } else {
        let concise: String = cleaned.chars().take(300).collect();
        format!("Download failed: {}", concise.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_403() {
        let msg = classify_download_error("ERROR: unable to download video data: HTTP Error 403: Forbidden");
        assert!(msg.contains("HTTP 403"));
    }

    #[test]
    fn maps_geo_restriction() {
        let msg = classify_download_error("ERROR: This video is geo-restricted.");
        assert!(msg.contains("region"));
    }

    #[test]
    fn maps_login_required() {
        let msg = classify_download_error("ERROR: Private video. Sign in if you've been granted access.");
        assert!(msg.to_lowercase().contains("signed in"));
    }

    #[test]
    fn fallback_is_concise() {
        let msg = classify_download_error("ERROR: something totally unexpected happened");
        assert!(msg.starts_with("Download failed:"));
        assert!(!msg.contains("ERROR:"));
    }

    #[test]
    fn empty_input_has_default() {
        assert!(classify_download_error("   ").contains("unknown reason"));
    }
}
