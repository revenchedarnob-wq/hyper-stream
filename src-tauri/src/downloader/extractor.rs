use std::collections::BTreeMap;
use std::process::Stdio;

use crate::downloader::binary_manager::BinaryManager;
use crate::downloader::classify_download_error;

/// A selectable audio language detected in the source (multi-audio videos).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct AudioTrack {
    /// yt-dlp language code, passed back verbatim in `DownloadOptions::audio_languages`.
    pub language: String,
    /// Human hint from the site (e.g. "English (US) original"), may be empty.
    pub note: String,
    pub is_original: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct SubtitleTrack {
    pub language: String,
    /// Display name from the site when provided (e.g. "English (auto)").
    pub name: String,
}

/// One selectable video size. `height` is what the format filter uses.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaylistEntry {
    pub url: String,
    pub title: String,
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaMetadata {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    /// Site name as reported by yt-dlp (e.g. "Youtube", "Instagram").
    pub extractor: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub webpage_url: String,
    pub is_live: bool,
    /// Distinct video sizes available, largest first (empty = audio-only source).
    pub resolutions: Vec<Resolution>,
    pub has_audio: bool,
    /// Only populated when the source offers more than one audio language.
    pub audio_tracks: Vec<AudioTrack>,
    pub subtitles: Vec<SubtitleTrack>,
    /// Non-empty when the URL is a playlist/channel instead of a single item.
    pub entries: Vec<PlaylistEntry>,
}

pub struct UniversalExtractor;

/// Temporary files: recent look-ups and the formats chosen for running downloads.
pub fn scratch_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("HyperStream");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Download links inside a look-up stay valid for a while (hours on YouTube); stay well inside that.
const LOOKUP_FRESH_FOR: std::time::Duration = std::time::Duration::from_secs(20 * 60);

fn lookup_path(url: &str) -> std::path::PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    url.trim().hash(&mut h);
    scratch_dir().join(format!("info-{:016x}.json", h.finish()))
}

/// The Hub's look-up of `url` if it's recent: starting that download skips loading the page again.
pub fn cached_info(url: &str) -> Option<std::path::PathBuf> {
    let path = lookup_path(url);
    let age = std::fs::metadata(&path).ok()?.modified().ok()?.elapsed().ok()?;
    (age < LOOKUP_FRESH_FOR).then_some(path)
}

/// A look-up from the last few minutes, read from disk (no network).
pub fn recent_lookup(url: &str) -> Option<MediaMetadata> {
    const SHOWN_FOR: std::time::Duration = std::time::Duration::from_secs(10 * 60);
    let path = lookup_path(url);
    let age = std::fs::metadata(&path).ok()?.modified().ok()?.elapsed().ok()?;
    if age > SHOWN_FOR {
        return None;
    }
    UniversalExtractor::parse_ytdlp_json(&std::fs::read_to_string(path).ok()?).ok()
}

fn remember_lookup(url: &str, json: &str) {
    let _ = std::fs::write(lookup_path(url), json);
    // Tidy up: old look-ups and leftovers from downloads interrupted by a crash.
    let Ok(entries) = std::fs::read_dir(scratch_dir()) else { return };
    let six_hours = std::time::Duration::from_secs(6 * 3600);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let old = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > six_hours);
        if old && (name.starts_with("info-") || name.starts_with("selected-")) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// A probe normally takes a few seconds; big channels and slow sites can take longer.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Runs the command to completion, killing it (and its children) if it hangs.
fn run_with_timeout(mut cmd: std::process::Command, timeout: std::time::Duration) -> Result<std::process::Output, String> {
    let child = cmd.spawn().map_err(|e| format!("Failed to start the download engine: {}", e))?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => result.map_err(|e| format!("The download engine stopped unexpectedly: {}", e)),
        Err(_) => {
            BinaryManager::kill_process_tree(pid);
            Err("The site took too long to respond. Check your connection and try again.".to_string())
        }
    }
}

impl UniversalExtractor {
    pub fn query_info(url: &str, cookies_content: Option<&str>) -> Result<MediaMetadata, String> {
        let mut cmd = BinaryManager::create_command("yt-dlp")?;
        BinaryManager::apply_utf8_env(&mut cmd);

        // --no-playlist: a video opened from a playlist ("watch?v=…&list=…") means that one video.
        // Plain playlist and channel links still list their entries.
        cmd.args(["-J", "--flat-playlist", "--no-playlist", "--playlist-items", "1:300", "--no-warnings", "--encoding", "utf-8"]);

        let temp_cookie_path = match cookies_content {
            Some(c) if !c.trim().is_empty() => BinaryManager::write_temp_cookie_file(c),
            _ => None,
        };
        if let Some(ref cf) = temp_cookie_path {
            cmd.arg("--cookies");
            cmd.arg(cf);
        }

        cmd.arg("--");
        cmd.arg(url);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = run_with_timeout(cmd, PROBE_TIMEOUT);

        if let Some(path) = temp_cookie_path {
            let _ = std::fs::remove_file(path);
        }
        let output = output?;

        if !output.status.success() {
            let err_text = String::from_utf8_lossy(&output.stderr);
            return Err(classify_download_error(&err_text));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let meta = Self::parse_ytdlp_json(&json_str)?;
        if meta.entries.is_empty() && !meta.is_live {
            remember_lookup(url, &json_str);
        }
        Ok(meta)
    }

    pub fn parse_ytdlp_json(json_str: &str) -> Result<MediaMetadata, String> {
        let val: serde_json::Value = serde_json::from_str(json_str.trim())
            .map_err(|e| format!("Could not read media information: {}", e))?;

        let s = |key: &str| val.get(key).and_then(|v| v.as_str()).map(|s| s.to_string());

        let id = s("id").unwrap_or_else(|| "unknown".to_string());
        let title = s("title").unwrap_or_else(|| "Untitled".to_string());
        let webpage_url = s("webpage_url").or_else(|| s("original_url")).unwrap_or_default();
        let uploader = s("uploader").or_else(|| s("channel")).or_else(|| s("playlist_uploader"));
        let extractor = s("extractor_key");
        let thumbnail = s("thumbnail").or_else(|| {
            val.get("thumbnails")
                .and_then(|v| v.as_array())
                .and_then(|a| a.last())
                .and_then(|t| t.get("url"))
                .and_then(|u| u.as_str())
                .map(|u| u.to_string())
        });

        // Playlist / channel: return entries so the UI can queue them individually.
        if val.get("_type").and_then(|v| v.as_str()) == Some("playlist") {
            let entries = val
                .get("entries")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|e| {
                            // Channel home pages list their tabs (Videos, Shorts…) as nested playlists.
                            let nested = e.get("_type").and_then(|t| t.as_str()) == Some("playlist")
                                || e.get("ie_key").and_then(|k| k.as_str()).map_or(false, |k| k.ends_with("Tab") || k.contains("Playlist"));
                            if nested {
                                return None;
                            }
                            let url = e.get("url").or_else(|| e.get("webpage_url"))?.as_str()?.to_string();
                            let title = e.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled").to_string();
                            let duration = e.get("duration").and_then(|d| d.as_f64());
                            Some(PlaylistEntry { url, title, duration })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if entries.is_empty() {
                let has_sections = val.get("entries").and_then(|v| v.as_array()).map_or(false, |a| !a.is_empty());
                return Err(if has_sections {
                    "This page is made of sections. Open its Videos tab or a playlist and paste that link.".to_string()
                } else {
                    "This page doesn't contain any downloadable videos.".to_string()
                });
            }

            return Ok(MediaMetadata {
                id,
                title,
                uploader,
                extractor,
                duration: None,
                thumbnail,
                webpage_url,
                is_live: false,
                resolutions: Vec::new(),
                has_audio: true,
                audio_tracks: Vec::new(),
                subtitles: Vec::new(),
                entries,
            });
        }

        let duration = val.get("duration").and_then(|v| v.as_f64());
        let is_live = val.get("is_live").and_then(|v| v.as_bool()).unwrap_or(false);

        let mut resolutions: Vec<Resolution> = Vec::new();
        let mut has_audio = false;
        // language -> (note, is_original)
        let mut languages: BTreeMap<String, (String, bool)> = BTreeMap::new();

        let formats = val.get("formats").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        for f in &formats {
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("");
            let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("");
            // Storyboards / image tracks are not real media.
            if f.get("format_note").and_then(|v| v.as_str()) == Some("storyboard") {
                continue;
            }
            let height = f.get("height").and_then(|v| v.as_u64()).map(|n| n as u32);
            let is_video = vcodec != "none" && (height.unwrap_or(0) > 0 || !vcodec.is_empty());
            let is_audio = acodec != "none" && !acodec.is_empty();

            if is_video {
                if let Some(h) = height.filter(|h| *h > 0) {
                    let w = f.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    match resolutions.iter_mut().find(|r| r.height == h) {
                        Some(r) if r.width == 0 => r.width = w,
                        Some(_) => {}
                        None => resolutions.push(Resolution { width: w, height: h }),
                    }
                }
            }
            if is_audio || (acodec.is_empty() && vcodec.is_empty()) {
                has_audio = true;
            }
            if is_audio {
                if let Some(lang) = f.get("language").and_then(|v| v.as_str()).filter(|l| !l.is_empty() && *l != "und") {
                    let note = f.get("format_note").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let original = note.to_lowercase().contains("original")
                        || f.get("language_preference").and_then(|v| v.as_i64()).unwrap_or(0) >= 10;
                    let entry = languages.entry(lang.to_string()).or_insert((String::new(), false));
                    if entry.0.is_empty() {
                        entry.0 = clean_audio_note(&note);
                    }
                    entry.1 |= original;
                }
            }
        }

        // Sources with a single progressive file may not list formats at all.
        if formats.is_empty() {
            if let Some(h) = val.get("height").and_then(|v| v.as_u64()) {
                let w = val.get("width").and_then(|v| v.as_u64()).unwrap_or(0);
                resolutions.push(Resolution { width: w as u32, height: h as u32 });
            }
            has_audio = val.get("acodec").and_then(|v| v.as_str()) != Some("none");
        }
        resolutions.sort_unstable_by(|a, b| b.height.cmp(&a.height));

        let audio_tracks: Vec<AudioTrack> = if languages.len() > 1 {
            let mut tracks: Vec<AudioTrack> = languages
                .into_iter()
                .map(|(language, (note, is_original))| AudioTrack { language, note, is_original })
                .collect();
            tracks.sort_by(|a, b| b.is_original.cmp(&a.is_original).then(a.language.cmp(&b.language)));
            tracks
        } else {
            Vec::new()
        };

        let mut subtitles = Vec::new();
        if let Some(subs_obj) = val.get("subtitles").and_then(|v| v.as_object()) {
            for (lang, tracks) in subs_obj {
                if lang == "live_chat" || lang.is_empty() {
                    continue;
                }
                let name = tracks
                    .as_array()
                    .and_then(|a| a.iter().find_map(|t| t.get("name").and_then(|n| n.as_str())))
                    .unwrap_or("")
                    .to_string();
                subtitles.push(SubtitleTrack { language: lang.clone(), name });
            }
        }
        subtitles.sort_by(|a, b| a.language.cmp(&b.language));

        Ok(MediaMetadata {
            id,
            title,
            uploader,
            extractor,
            duration,
            thumbnail,
            webpage_url,
            is_live,
            resolutions,
            has_audio,
            audio_tracks,
            subtitles,
            entries: Vec::new(),
        })
    }
}

/// "English (US) original (default), medium" -> "English (US) original"
fn clean_audio_note(note: &str) -> String {
    let first = note.split(',').next().unwrap_or("").trim();
    first.replace("(default)", "").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_video() {
        let sample_json = r#"{
            "id": "dQw4w9WgXcQ",
            "title": "Sample",
            "uploader": "Someone",
            "extractor_key": "Youtube",
            "duration": 212.0,
            "thumbnail": "https://i.ytimg.com/vi/x/maxresdefault.jpg",
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "is_live": false,
            "formats": [
                {"format_id": "sb0", "format_note": "storyboard", "vcodec": "none", "acodec": "none", "height": 90},
                {"format_id": "137", "width": 1920, "height": 1080, "vcodec": "avc1.640028", "acodec": "none"},
                {"format_id": "136", "height": 720, "vcodec": "avc1.4d401f", "acodec": "none"},
                {"format_id": "22", "width": 1280, "height": 720, "vcodec": "avc1", "acodec": "mp4a.40.2"},
                {"format_id": "140", "vcodec": "none", "acodec": "mp4a.40.2"}
            ],
            "subtitles": {
                "en": [{ "ext": "vtt", "name": "English" }, { "ext": "srv3", "name": "English" }],
                "live_chat": [{ "ext": "json" }]
            }
        }"#;

        let meta = UniversalExtractor::parse_ytdlp_json(sample_json).unwrap();
        assert_eq!(
            meta.resolutions,
            vec![Resolution { width: 1920, height: 1080 }, Resolution { width: 1280, height: 720 }]
        );
        assert!(meta.has_audio);
        assert!(meta.audio_tracks.is_empty(), "single language must not show a picker");
        assert_eq!(meta.subtitles, vec![SubtitleTrack { language: "en".into(), name: "English".into() }]);
        assert_eq!(meta.uploader.as_deref(), Some("Someone"));
        assert!(meta.entries.is_empty());
    }

    #[test]
    fn detects_multi_audio_languages() {
        let sample_json = r#"{
            "id": "x", "title": "Dubbed",
            "formats": [
                {"format_id": "v", "height": 1080, "vcodec": "vp9", "acodec": "none"},
                {"format_id": "a1", "vcodec": "none", "acodec": "opus", "language": "ja", "format_note": "Japanese original (default), medium"},
                {"format_id": "a2", "vcodec": "none", "acodec": "opus", "language": "en", "format_note": "English, medium"},
                {"format_id": "a3", "vcodec": "none", "acodec": "mp4a", "language": "en", "format_note": "English, low"}
            ]
        }"#;
        let meta = UniversalExtractor::parse_ytdlp_json(sample_json).unwrap();
        assert_eq!(meta.audio_tracks.len(), 2);
        assert_eq!(meta.audio_tracks[0].language, "ja");
        assert!(meta.audio_tracks[0].is_original);
        assert_eq!(meta.audio_tracks[0].note, "Japanese original");
    }

    #[test]
    fn parses_playlist_entries() {
        let sample_json = r#"{
            "_type": "playlist", "id": "PL1", "title": "My list",
            "entries": [
                {"url": "https://www.youtube.com/watch?v=a", "title": "A", "duration": 10},
                {"url": "https://www.youtube.com/watch?v=b", "title": "B"}
            ]
        }"#;
        let meta = UniversalExtractor::parse_ytdlp_json(sample_json).unwrap();
        assert_eq!(meta.entries.len(), 2);
        assert_eq!(meta.entries[1].title, "B");
    }

    #[test]
    fn channel_tabs_are_not_queued_as_videos() {
        let sample_json = r#"{
            "_type": "playlist", "id": "UC1", "title": "Channel",
            "entries": [
                {"_type": "url", "ie_key": "YoutubeTab", "url": "https://www.youtube.com/@c/videos", "title": "Channel - Videos"},
                {"_type": "url", "ie_key": "YoutubeTab", "url": "https://www.youtube.com/@c/shorts", "title": "Channel - Shorts"}
            ]
        }"#;
        let err = UniversalExtractor::parse_ytdlp_json(sample_json).unwrap_err();
        assert!(err.contains("Videos tab"), "{err}");
    }
}
