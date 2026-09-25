use std::process::Stdio;
use crate::downloader::binary_manager::BinaryManager;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaFormat {
    pub format_id: String,
    pub extension: String,
    pub resolution: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub tbr: Option<f64>,
    pub is_video: bool,
    pub is_audio: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubtitleTrack {
    pub language: String,
    pub url: Option<String>,
    pub ext: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaMetadata {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub webpage_url: String,
    pub formats: Vec<MediaFormat>,
    pub subtitles: Vec<SubtitleTrack>,
    pub is_live: bool,
}

pub struct UniversalExtractor;

impl UniversalExtractor {
    pub fn query_info(url: &str, cookies_content: Option<&str>) -> Result<MediaMetadata, String> {
        let mut cmd = BinaryManager::create_command("yt-dlp")?;

        cmd.arg("--dump-json");
        cmd.arg("--no-playlist");
        cmd.arg("--skip-download");

        if let Some(ffmpeg_path) = BinaryManager::find_binary("ffmpeg") {
            cmd.arg("--ffmpeg-location");
            cmd.arg(ffmpeg_path);
        }

        let mut temp_cookie_path = None;
        if let Some(cookies) = cookies_content {
            if !cookies.trim().is_empty() {
                let bin_dir = BinaryManager::get_bin_dir();
                let nonce = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let cookie_file = bin_dir.join(format!("cookies-{}.txt", nonce));
                if std::fs::write(&cookie_file, cookies).is_ok() {
                    cmd.arg("--cookies");
                    cmd.arg(&cookie_file);
                    temp_cookie_path = Some(cookie_file);
                }
            }
        }

        cmd.arg(url);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd.output().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

        if let Some(path) = temp_cookie_path {
            let _ = std::fs::remove_file(path);
        }

        if !output.status.success() {
            let err_text = String::from_utf8_lossy(&output.stderr);
            return Err(format!("yt-dlp failed: {}", err_text.trim()));
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        Self::parse_ytdlp_json(&json_str)
    }

    pub fn parse_ytdlp_json(json_str: &str) -> Result<MediaMetadata, String> {
        let val: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse metadata JSON: {}", e))?;

        let id = val.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        let title = val.get("title").and_then(|v| v.as_str()).unwrap_or("Media Stream").to_string();
        let duration = val.get("duration").and_then(|v| v.as_f64());
        let thumbnail = val.get("thumbnail").and_then(|v| v.as_str()).map(|s| s.to_string());
        let webpage_url = val.get("webpage_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_live = val.get("is_live").and_then(|v| v.as_bool()).unwrap_or(false);

        let mut formats = Vec::new();
        if let Some(arr) = val.get("formats").and_then(|v| v.as_array()) {
            for f in arr {
                let format_id = f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if format_id.is_empty() {
                    continue;
                }
                let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("mp4").to_string();
                let resolution = f.get("resolution").and_then(|v| v.as_str()).map(|s| s.to_string());
                let width = f.get("width").and_then(|v| v.as_u64()).map(|n| n as u32);
                let height = f.get("height").and_then(|v| v.as_u64()).map(|n| n as u32);
                let fps = f.get("fps").and_then(|v| v.as_f64());
                let vcodec = f.get("vcodec").and_then(|v| v.as_str()).map(|s| s.to_string());
                let acodec = f.get("acodec").and_then(|v| v.as_str()).map(|s| s.to_string());
                let filesize = f.get("filesize").and_then(|v| v.as_u64())
                    .or_else(|| f.get("filesize_approx").and_then(|v| v.as_u64()));
                let tbr = f.get("tbr").and_then(|v| v.as_f64());

                let has_video = vcodec.as_deref().map(|c| c != "none").unwrap_or(false);
                let has_audio = acodec.as_deref().map(|c| c != "none").unwrap_or(false);

                formats.push(MediaFormat {
                    format_id,
                    extension: ext,
                    resolution,
                    width,
                    height,
                    fps,
                    vcodec,
                    acodec,
                    filesize,
                    tbr,
                    is_video: has_video,
                    is_audio: has_audio,
                });
            }
        }

        let mut subtitles = Vec::new();
        if let Some(subs_obj) = val.get("subtitles").and_then(|v| v.as_object()) {
            for (lang, tracks) in subs_obj {
                if let Some(track_arr) = tracks.as_array() {
                    for t in track_arr {
                        let ext = t.get("ext").and_then(|v| v.as_str()).unwrap_or("vtt").to_string();
                        let url = t.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                        subtitles.push(SubtitleTrack {
                            language: lang.clone(),
                            url,
                            ext,
                        });
                    }
                }
            }
        }

        Ok(MediaMetadata {
            id,
            title,
            duration,
            thumbnail,
            webpage_url,
            formats,
            subtitles,
            is_live,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ytdlp_json() {
        let sample_json = r#"{
            "id": "dQw4w9WgXcQ",
            "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
            "duration": 212.0,
            "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "is_live": false,
            "formats": [
                {
                    "format_id": "137",
                    "ext": "mp4",
                    "resolution": "1920x1080",
                    "width": 1920,
                    "height": 1080,
                    "fps": 30.0,
                    "vcodec": "avc1.640028",
                    "acodec": "none",
                    "filesize": 45000000,
                    "tbr": 2800.5
                },
                {
                    "format_id": "140",
                    "ext": "m4a",
                    "resolution": "audio only",
                    "width": null,
                    "height": null,
                    "fps": null,
                    "vcodec": "none",
                    "acodec": "mp4a.40.2",
                    "filesize": 3500000,
                    "tbr": 128.0
                }
            ],
            "subtitles": {
                "en": [
                    { "ext": "vtt", "url": "https://www.youtube.com/api/timedtext?..." }
                ]
            }
        }"#;

        let meta = UniversalExtractor::parse_ytdlp_json(sample_json).unwrap();
        assert_eq!(meta.id, "dQw4w9WgXcQ");
        assert_eq!(meta.duration, Some(212.0));
        assert_eq!(meta.formats.len(), 2);
        assert!(meta.formats[0].is_video);
        assert!(!meta.formats[0].is_audio);
        assert!(!meta.formats[1].is_video);
        assert!(meta.formats[1].is_audio);
        assert_eq!(meta.subtitles.len(), 1);
        assert_eq!(meta.subtitles[0].language, "en");
    }
}
