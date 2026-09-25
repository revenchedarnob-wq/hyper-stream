use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::{Arc, RwLock};

use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::ACTIVE_TRANSFERS;
use crate::downloader::binary_manager::BinaryManager;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Queued,
    Downloading,
    Paused,
    Remuxing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub title: String,
    pub state: DownloadState,
    pub progress_percent: f64,
    pub speed_bytes_per_sec: u64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub eta_seconds: Option<u64>,
    pub stage: String,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadOptions {
    pub url: String,
    pub title: String,
    pub format_id: Option<String>,
    pub output_dir: Option<String>,
    #[serde(default)]
    pub audio_formats: Vec<String>,
    #[serde(default)]
    pub subtitles: Vec<String>,
    pub cookies: Option<String>,
}

pub struct DownloadOrchestrator {
    tasks: Arc<RwLock<HashMap<String, DownloadProgress>>>,
    abort_handles: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

impl DownloadOrchestrator {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            abort_handles: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn get_tasks(&self) -> Vec<DownloadProgress> {
        let tasks = self.tasks.read().unwrap();
        tasks.values().cloned().collect()
    }

    pub fn get_task(&self, task_id: &str) -> Option<DownloadProgress> {
        let tasks = self.tasks.read().unwrap();
        tasks.get(task_id).cloned()
    }

    pub fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        let mut handles = self.abort_handles.write().unwrap();
        if let Some(tx) = handles.remove(task_id) {
            let _ = tx.send(());
        }

        let mut tasks = self.tasks.write().unwrap();
        if let Some(t) = tasks.get_mut(task_id) {
            t.state = DownloadState::Cancelled;
            t.stage = "Cancelled by user".to_string();
        }
        Ok(())
    }

    pub async fn start_download(
        &self,
        app: AppHandle,
        options: DownloadOptions,
    ) -> Result<String, String> {
        let task_id = format!("dl-{}", uuid_simple());

        let target_dir = if let Some(dir) = options.output_dir.as_deref() {
            PathBuf::from(dir)
        } else if let Ok(video_dir) = std::env::var("USERPROFILE") {
            PathBuf::from(video_dir).join("Videos").join("HyperStream")
        } else {
            PathBuf::from("downloads")
        };
        let _ = std::fs::create_dir_all(&target_dir);

        let initial_progress = DownloadProgress {
            task_id: task_id.clone(),
            title: options.title.clone(),
            state: DownloadState::Queued,
            progress_percent: 0.0,
            speed_bytes_per_sec: 0,
            downloaded_bytes: 0,
            total_bytes: None,
            eta_seconds: None,
            stage: "Initializing download pipeline...".to_string(),
            output_path: None,
            error_message: None,
        };

        {
            let mut tasks = self.tasks.write().unwrap();
            tasks.insert(task_id.clone(), initial_progress.clone());
        }

        let _ = app.emit("download-progress", &initial_progress);

        let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut handles = self.abort_handles.write().unwrap();
            handles.insert(task_id.clone(), abort_tx);
        }

        let tasks_ref = self.tasks.clone();
        let task_id_clone = task_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            ACTIVE_TRANSFERS.fetch_add(1, Ordering::SeqCst);

            let res = Self::run_download_task(
                &task_id_clone,
                &options,
                &target_dir,
                &tasks_ref,
                &app_clone,
                &mut abort_rx,
            ).await;

            ACTIVE_TRANSFERS.fetch_sub(1, Ordering::SeqCst);

            let mut tasks = tasks_ref.write().unwrap();
            if let Some(t) = tasks.get_mut(&task_id_clone) {
                match res {
                    Ok(final_path) => {
                        t.state = DownloadState::Completed;
                        t.progress_percent = 100.0;
                        t.stage = "Download completed successfully".to_string();
                        t.output_path = Some(final_path);
                        let _ = app_clone.emit("download-complete", &t.clone());
                    }
                    Err(e) => {
                        if t.state != DownloadState::Cancelled {
                            t.state = DownloadState::Failed;
                            t.stage = format!("Download failed: {}", e);
                            t.error_message = Some(e.clone());
                            let _ = app_clone.emit("download-error", &t.clone());
                        }
                    }
                }
            }
        });

        Ok(task_id)
    }

    async fn run_download_task(
        task_id: &str,
        options: &DownloadOptions,
        target_dir: &PathBuf,
        tasks_ref: &Arc<RwLock<HashMap<String, DownloadProgress>>>,
        app: &AppHandle,
        abort_rx: &mut tokio::sync::oneshot::Receiver<()>,
    ) -> Result<String, String> {
        let mut cmd = BinaryManager::create_command("yt-dlp")?;

        let safe_title = options.title
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>();
        let output_template = target_dir.join(format!("{}.%(ext)s", safe_title));

        cmd.arg("-o");
        cmd.arg(output_template.to_string_lossy().to_string());
        cmd.arg("--newline");
        cmd.arg("--no-playlist");

        if let Some(fid) = &options.format_id {
            cmd.arg("-f");
            cmd.arg(fid);
        } else {
            cmd.arg("-f");
            cmd.arg("bestvideo+bestaudio/best");
        }

        // Remux into MKV/MP4 losslessly
        cmd.arg("--merge-output-format");
        cmd.arg("mkv");

        if let Some(ffmpeg_path) = BinaryManager::find_binary("ffmpeg") {
            cmd.arg("--ffmpeg-location");
            cmd.arg(ffmpeg_path);
        }

        // Multi-socket acceleration with aria2c if available
        if BinaryManager::find_binary("aria2c").is_some() {
            cmd.arg("--downloader");
            cmd.arg("aria2c");
            cmd.arg("--downloader-args");
            cmd.arg("aria2c:-x 16 -s 16 -k 1M");
        }

        let mut temp_cookie = None;
        if let Some(ref cookies) = options.cookies {
            if !cookies.trim().is_empty() {
                let bin_dir = BinaryManager::get_bin_dir();
                let nonce = uuid_simple();
                let cf = bin_dir.join(format!("dl-cookies-{}.txt", nonce));
                if std::fs::write(&cf, cookies).is_ok() {
                    cmd.arg("--cookies");
                    cmd.arg(&cf);
                    temp_cookie = Some(cf);
                }
            }
        }

        cmd.arg(&options.url);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture child stdout".to_string())?;

        let stderr = child.stderr.take();
        let stderr_log = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let stderr_log_clone = Arc::clone(&stderr_log);

        let err_thread = std::thread::spawn(move || {
            if let Some(err_pipe) = stderr {
                let err_reader = BufReader::new(err_pipe);
                for line in err_reader.lines().flatten() {
                    let mut lock = stderr_log_clone.lock().unwrap();
                    if lock.len() > 50 {
                        lock.remove(0);
                    }
                    lock.push(line);
                }
            }
        });

        let re_progress = Regex::new(r"\[download\]\s+([0-9.]+)%\s+of\s+(?:~\s*)?([0-9.]+)([KMG]iB)(?:\s+at\s+([0-9.]+)([KMG]iB/s))?").unwrap();
        let re_dest = Regex::new(r"\[(?:Merger|download)\]\s+(?:Merging formats into|Destination:)\s+(.+)").unwrap();

        let mut detected_output_file: Option<String> = None;
        let reader = BufReader::new(stdout);

        for line_res in reader.lines() {
            // Check cancellation signal
            if abort_rx.try_recv().is_ok() {
                let _ = child.kill();
                let _ = err_thread.join();
                if let Some(cf) = temp_cookie {
                    let _ = std::fs::remove_file(cf);
                }
                return Err("Download cancelled by user".to_string());
            }

            if let Ok(line) = line_res {
                let line_str = line.trim();

                if let Some(caps) = re_dest.captures(line_str) {
                    if let Some(m) = caps.get(1) {
                        detected_output_file = Some(m.as_str().trim_matches('"').to_string());
                    }
                }

                if let Some(caps) = re_progress.captures(line_str) {
                    let percent: f64 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
                    let speed_val: f64 = caps.get(4).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
                    let speed_unit = caps.get(5).map(|m| m.as_str()).unwrap_or("MiB/s");

                    let multiplier = match speed_unit {
                        "KiB/s" => 1024,
                        "MiB/s" => 1024 * 1024,
                        "GiB/s" => 1024 * 1024 * 1024,
                        _ => 1,
                    };
                    let speed_bytes = (speed_val * multiplier as f64) as u64;

                    let mut tasks = tasks_ref.write().unwrap();
                    if let Some(t) = tasks.get_mut(task_id) {
                        t.state = DownloadState::Downloading;
                        t.progress_percent = percent;
                        t.speed_bytes_per_sec = speed_bytes;
                        t.stage = format!("Downloading: {:.1}% at {}", percent, caps.get(4).map(|m| m.as_str()).unwrap_or(""));
                        let _ = app.emit("download-progress", &t.clone());
                    }
                } else if line_str.contains("[Merger]") || line_str.contains("Merging formats") {
                    let mut tasks = tasks_ref.write().unwrap();
                    if let Some(t) = tasks.get_mut(task_id) {
                        t.state = DownloadState::Remuxing;
                        t.stage = "Remuxing video and audio tracks losslessly (-c copy)...".to_string();
                        let _ = app.emit("download-progress", &t.clone());
                    }
                }
            }
        }

        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;
        let _ = err_thread.join();

        if let Some(cf) = temp_cookie {
            let _ = std::fs::remove_file(cf);
        }

        if !status.success() {
            let error_details = {
                let lock = stderr_log.lock().unwrap();
                let filtered: Vec<String> = lock.iter()
                    .filter(|l| l.contains("ERROR:") || l.contains("error:") || l.contains("Failed to") || l.contains("Unable to"))
                    .cloned()
                    .collect();
                if !filtered.is_empty() {
                    filtered.join("; ")
                } else if let Some(last) = lock.last() {
                    last.clone()
                } else {
                    "Download process exited with non-zero status code".to_string()
                }
            };
            return Err(error_details);
        }

        let final_file = detected_output_file.unwrap_or_else(|| {
            target_dir.join(format!("{}.mkv", safe_title)).to_string_lossy().to_string()
        });

        Ok(final_file)
    }
}

fn uuid_simple() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_initial_state() {
        let orchestrator = DownloadOrchestrator::new();
        assert_eq!(orchestrator.get_tasks().len(), 0);
    }

    #[test]
    fn test_progress_regex() {
        let re_progress = Regex::new(r"\[download\]\s+([0-9.]+)%\s+of\s+(?:~\s*)?([0-9.]+)([KMG]iB)(?:\s+at\s+([0-9.]+)([KMG]iB/s))?").unwrap();
        let sample_line = "[download]  45.2% of ~  1.20GiB at   15.42MiB/s ETA 00:45";
        let caps = re_progress.captures(sample_line).unwrap();
        assert_eq!(caps.get(1).unwrap().as_str(), "45.2");
        assert_eq!(caps.get(4).unwrap().as_str(), "15.42");
        assert_eq!(caps.get(5).unwrap().as_str(), "MiB/s");
    }
}
