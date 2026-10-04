use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use crate::ACTIVE_TRANSFERS;
use crate::downloader::binary_manager::BinaryManager;
use crate::downloader::cookies::browser_cookies_async;
use crate::downloader::{bandwidth, extractor, turbo};
use crate::downloader::library::{self, LibraryItem, MediaKind};
use crate::downloader::queue::{
    get_queue_file_path, is_transient_error, load_queue_from_path, sanitize_for_persistence,
    save_queue_to_path, PersistedQueueEntry, QueueChangedPayload, QueueConfig, QueueEntry,
};

/// Returned by the runner when the user paused or cancelled; never shown as an error.
const ABORTED: &str = "__aborted__";

/// The fast engine stopped for now with its data kept; the queue tries again later and the
/// download continues from there.
fn interrupted_message(reason: &str) -> String {
    if reason.contains("server") {
        "The server is busy right now. Retrying continues from where it stopped.".to_string()
    } else {
        "Lost the connection. Retrying continues from where it stopped.".to_string()
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    #[default]
    Queued,
    Downloading,
    Paused,
    /// Post-processing: merging audio/video, embedding subtitles.
    Remuxing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
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
    pub source_url: String,
    /// Remote preview image from the probe, for the transfer card.
    pub thumbnail: Option<String>,
    /// "1080p", "Audio" — known once the format is chosen.
    pub quality_label: Option<String>,
    /// "MP4", "MKV", "M4A" — known once the format is chosen.
    pub container: Option<String>,
    pub audio_only: bool,
    pub created_at: u64,
    /// Planned output path, used to clean up partial files on cancel. Internal only.
    #[serde(skip)]
    planned_path: Option<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct DownloadOptions {
    pub url: String,
    pub title: String,
    /// Cap the video height (e.g. 1080). None = best available.
    pub max_height: Option<u32>,
    pub audio_only: bool,
    /// yt-dlp language codes to include. Empty = the source's default audio.
    pub audio_languages: Vec<String>,
    /// Subtitle language codes to embed.
    pub subtitles: Vec<String>,
    pub output_dir: Option<String>,
    /// Prefer H.264/AAC in MP4 for older players, even if a better codec exists.
    pub prefer_compatible: bool,
    /// Explicit cookies (Netscape format). Normally empty: browser cookies are read at run time.
    pub cookies: Option<String>,
    // Probe hints carried into the library.
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub extractor: Option<String>,
    /// A file handed over by the browser extension: fetched as-is under the site's file name.
    pub direct: Option<DirectFile>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct DirectFile {
    pub filename: String,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
}

/// "https://x.test/files/setup%20v2.exe?t=1" -> "setup v2.exe"
pub fn file_name_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let last = path.rsplit('/').next().unwrap_or("");
    let decoded = percent_decode(last);
    if decoded.trim().is_empty() { "download".to_string() } else { decoded }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// A name Windows accepts: no reserved characters or device names, no trailing dots or spaces.
fn safe_file_name(name: &str) -> String {
    const RESERVED: &[&str] = &["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    let mut cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    if cleaned.is_empty() || RESERVED.contains(&stem.as_str()) {
        cleaned = format!("download {}", cleaned);
    }
    // Keep well under MAX_PATH together with the folder.
    if cleaned.chars().count() > 150 {
        let ext = Path::new(&cleaned).extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
        let keep: String = cleaned.chars().take(150 - ext.chars().count().min(20)).collect();
        cleaned = format!("{}{}", keep.trim_end(), ext);
    }
    cleaned
}

/// `dir/name`, or `dir/name (2).ext` and so on when that's taken.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    let taken = |p: &Path| p.exists() || turbo::part_path(p).exists();
    if !taken(&first) {
        return first;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
    (2..1000).map(|n| dir.join(format!("{} ({}){}", stem, n, ext))).find(|p| !taken(p)).unwrap_or(first)
}

/// What a successful run produced.
#[derive(Debug, Clone, Default)]
struct DownloadOutcome {
    file_path: String,
    width: Option<u32>,
    height: Option<u32>,
}

pub fn default_download_dir() -> PathBuf {
    match std::env::var("USERPROFILE") {
        Ok(profile) => PathBuf::from(profile).join("Videos").join("HyperStream"),
        Err(_) => PathBuf::from("downloads"),
    }
}

type TaskMap = Arc<RwLock<HashMap<String, DownloadProgress>>>;

pub struct DownloadOrchestrator {
    tasks: TaskMap,
    all_entries: Arc<RwLock<HashMap<String, QueueEntry>>>,
    abort_handles: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
    pending: Arc<Mutex<Vec<QueueEntry>>>,
    config: Arc<RwLock<QueueConfig>>,
    notify: Arc<tokio::sync::Notify>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    save_notify: Arc<tokio::sync::Notify>,
    scheduler_started: Arc<AtomicBool>,
    persistence_started: Arc<AtomicBool>,
}

fn sort_pending(pending: &mut [QueueEntry]) {
    pending.sort_by(|a, b| b.priority.cmp(&a.priority).then_with(|| a.enqueued_at.cmp(&b.enqueued_at)));
}

/// When the user is elsewhere: a Windows notification plus one flash of the taskbar button.
fn announce_finished(app: &AppHandle, title: &str) {
    use tauri::Manager;
    use tauri_plugin_notification::NotificationExt;
    let Some(main) = app.get_webview_window("main") else { return };
    if main.is_focused().unwrap_or(false) {
        return;
    }
    let _ = main.request_user_attention(Some(tauri::UserAttentionType::Informational));
    let body = if title.trim().is_empty() { "Saved to your library." } else { title };
    let _ = app.notification().builder().title("Download finished").body(body).show();
}

fn emit_task(app_handle: &Arc<RwLock<Option<AppHandle>>>, tasks: &TaskMap, task_id: &str, event: &str) {
    if let Some(app) = app_handle.read().unwrap().as_ref() {
        if let Some(t) = tasks.read().unwrap().get(task_id) {
            let _ = app.emit(event, t);
        }
    }
}

fn progress_from_options(task_id: &str, options: &DownloadOptions, state: DownloadState, stage: &str, created_at: u64) -> DownloadProgress {
    DownloadProgress {
        task_id: task_id.to_string(),
        title: options.title.clone(),
        state,
        stage: stage.to_string(),
        source_url: options.url.clone(),
        thumbnail: options.thumbnail.clone(),
        audio_only: options.audio_only,
        quality_label: if options.audio_only {
            Some("Audio".to_string())
        } else {
            options.max_height.map(|h| format!("{}p", h))
        },
        created_at,
        ..Default::default()
    }
}

impl DownloadOrchestrator {
    pub fn new() -> Self {
        let orchestrator = Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            all_entries: Arc::new(RwLock::new(HashMap::new())),
            abort_handles: Arc::new(RwLock::new(HashMap::new())),
            pending: Arc::new(Mutex::new(Vec::new())),
            config: Arc::new(RwLock::new(QueueConfig::default())),
            notify: Arc::new(tokio::sync::Notify::new()),
            app_handle: Arc::new(RwLock::new(None)),
            save_notify: Arc::new(tokio::sync::Notify::new()),
            scheduler_started: Arc::new(AtomicBool::new(false)),
            persistence_started: Arc::new(AtomicBool::new(false)),
        };
        orchestrator.restore_persisted_queue(&get_queue_file_path());
        orchestrator
    }

    pub fn attach_app(&self, app: AppHandle) {
        *self.app_handle.write().unwrap() = Some(app);
        // Called from Tauri's setup hook (no tokio context), so workers spawn on Tauri's runtime.
        self.start_scheduler();
        self.start_persistence_worker();
        self.emit_queue_state();
    }

    fn restore_persisted_queue(&self, queue_file: &Path) {
        let Ok(entries) = load_queue_from_path(queue_file) else { return };
        let mut tasks = self.tasks.write().unwrap();
        let mut pending = self.pending.lock().unwrap();
        let mut all_entries = self.all_entries.write().unwrap();

        for item in entries {
            let paused = item.state == DownloadState::Paused;
            let (state, stage) = if paused {
                (DownloadState::Paused, "Paused")
            } else {
                (DownloadState::Queued, "Waiting to start")
            };
            tasks.insert(
                item.task_id.clone(),
                progress_from_options(&item.task_id, &item.options, state, stage, item.enqueued_at),
            );

            let entry = QueueEntry {
                task_id: item.task_id.clone(),
                options: item.options,
                priority: item.priority,
                enqueued_at: item.enqueued_at,
                attempts: item.attempts,
                target_dir: item.target_dir,
                had_cookies: item.had_cookies,
            };
            all_entries.insert(item.task_id.clone(), entry.clone());
            if !paused {
                pending.push(entry);
            }
        }
        sort_pending(&mut pending);
    }

    fn start_persistence_worker(&self) {
        if self.persistence_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let save_notify = self.save_notify.clone();
        let pending_ref = self.pending.clone();
        let tasks_ref = self.tasks.clone();
        let all_entries_ref = self.all_entries.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                save_notify.notified().await;
                // Debounce bursts of changes into one write.
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(500)) => break,
                        _ = save_notify.notified() => {}
                    }
                }

                let entries_to_save: Vec<PersistedQueueEntry> = {
                    let t = tasks_ref.read().unwrap();
                    let all = all_entries_ref.read().unwrap();
                    let _p = pending_ref.lock().unwrap();
                    // Everything not finished survives a restart (running tasks resume as queued).
                    let mut unfinished: Vec<&QueueEntry> = all
                        .values()
                        .filter(|e| {
                            t.get(&e.task_id).map_or(false, |task| {
                                !matches!(task.state, DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled)
                            })
                        })
                        .collect();
                    unfinished.sort_by_key(|e| e.enqueued_at);
                    unfinished
                        .into_iter()
                        .map(|e| {
                            let state = t.get(&e.task_id).map(|x| x.state.clone()).unwrap_or_default();
                            sanitize_for_persistence(e, state)
                        })
                        .collect()
                };

                let _ = save_queue_to_path(&get_queue_file_path(), &entries_to_save);
            }
        });
    }

    fn start_scheduler(&self) {
        if self.scheduler_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let notify = self.notify.clone();
        let pending_ref = self.pending.clone();
        let tasks_ref = self.tasks.clone();
        let config_ref = self.config.clone();
        let abort_handles = self.abort_handles.clone();
        let app_handle_ref = self.app_handle.clone();
        let save_notify = self.save_notify.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                let max_concurrent = config_ref.read().unwrap().max_concurrent.clamp(1, 8);
                let running = tasks_ref
                    .read()
                    .unwrap()
                    .values()
                    .filter(|t| matches!(t.state, DownloadState::Downloading | DownloadState::Remuxing))
                    .count();

                let mut to_spawn = Vec::new();
                if running < max_concurrent {
                    let mut pending = pending_ref.lock().unwrap();
                    let tasks = tasks_ref.read().unwrap();
                    // Never start something that was paused/cancelled/removed meanwhile.
                    pending.retain(|e| tasks.get(&e.task_id).map_or(false, |t| t.state == DownloadState::Queued));
                    sort_pending(&mut pending);
                    let take = (max_concurrent - running).min(pending.len());
                    to_spawn.extend(pending.drain(..take));
                }

                Self::emit_queue_change_event(&app_handle_ref, &pending_ref, &tasks_ref, max_concurrent);

                for entry in to_spawn {
                    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();
                    abort_handles.write().unwrap().insert(entry.task_id.clone(), abort_tx);

                    if let Some(t) = tasks_ref.write().unwrap().get_mut(&entry.task_id) {
                        t.state = DownloadState::Downloading;
                        t.stage = "Connecting...".to_string();
                        t.error_message = None;
                    }
                    emit_task(&app_handle_ref, &tasks_ref, &entry.task_id, "download-progress");

                    let ctx = RunContext {
                        tasks: tasks_ref.clone(),
                        app_handle: app_handle_ref.clone(),
                        notify: notify.clone(),
                        save_notify: save_notify.clone(),
                        config: config_ref.clone(),
                        pending: pending_ref.clone(),
                        abort_handles: abort_handles.clone(),
                    };
                    tokio::spawn(ctx.run(entry, abort_rx));
                }

                notify.notified().await;
            }
        });
    }

    fn emit_queue_change_event(
        app_handle_ref: &Arc<RwLock<Option<AppHandle>>>,
        pending_ref: &Arc<Mutex<Vec<QueueEntry>>>,
        tasks_ref: &TaskMap,
        max_concurrent: usize,
    ) {
        if let Some(app) = app_handle_ref.read().unwrap().as_ref() {
            let order = pending_ref.lock().unwrap().iter().map(|e| e.task_id.clone()).collect();
            let running = tasks_ref
                .read()
                .unwrap()
                .values()
                .filter(|t| matches!(t.state, DownloadState::Downloading | DownloadState::Remuxing))
                .count();
            let _ = app.emit("download-queue-changed", &QueueChangedPayload { order, running, max_concurrent });
        }
    }

    pub fn emit_queue_state(&self) {
        let max_conc = self.config.read().unwrap().max_concurrent.clamp(1, 8);
        Self::emit_queue_change_event(&self.app_handle, &self.pending, &self.tasks, max_conc);
    }

    fn changed(&self) {
        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();
    }

    /// All tasks, oldest first (stable order for the UI).
    pub fn get_tasks(&self) -> Vec<DownloadProgress> {
        let mut list: Vec<DownloadProgress> = self.tasks.read().unwrap().values().cloned().collect();
        list.sort_by_key(|t| t.created_at);
        list
    }

    pub fn get_task(&self, task_id: &str) -> Option<DownloadProgress> {
        self.tasks.read().unwrap().get(task_id).cloned()
    }

    pub fn get_config(&self) -> QueueConfig {
        *self.config.read().unwrap()
    }

    pub fn set_config(&self, config: QueueConfig) -> Result<QueueConfig, String> {
        let sanitized = config.sanitized();
        *self.config.write().unwrap() = sanitized;
        self.notify.notify_one();
        self.emit_queue_state();
        Ok(sanitized)
    }

    fn abort_running(&self, task_id: &str) {
        if let Some(tx) = self.abort_handles.write().unwrap().remove(task_id) {
            let _ = tx.send(());
        }
    }

    fn set_state(&self, task_id: &str, state: DownloadState, stage: &str) -> Result<(), String> {
        {
            let mut tasks = self.tasks.write().unwrap();
            let t = tasks.get_mut(task_id).ok_or("That download no longer exists.")?;
            t.state = state;
            t.stage = stage.to_string();
            t.speed_bytes_per_sec = 0;
            t.eta_seconds = None;
        }
        emit_task(&self.app_handle, &self.tasks, task_id, "download-progress");
        Ok(())
    }

    pub fn pause_task(&self, task_id: &str) -> Result<(), String> {
        let state = self.get_task(task_id).map(|t| t.state).ok_or("That download no longer exists.")?;
        if !matches!(state, DownloadState::Queued | DownloadState::Downloading | DownloadState::Remuxing) {
            return Ok(());
        }
        self.pending.lock().unwrap().retain(|e| e.task_id != task_id);
        self.set_state(task_id, DownloadState::Paused, "Paused")?;
        self.abort_running(task_id);
        self.changed();
        Ok(())
    }

    pub fn resume_task(&self, task_id: &str) -> Result<(), String> {
        let entry = self
            .all_entries
            .read()
            .unwrap()
            .get(task_id)
            .cloned()
            .ok_or("That download can't be resumed because its original request was lost.")?;
        if self.get_task(task_id).map(|t| t.state) != Some(DownloadState::Paused) {
            return Ok(());
        }
        self.set_state(task_id, DownloadState::Queued, "Waiting to start")?;
        {
            let mut pending = self.pending.lock().unwrap();
            if !pending.iter().any(|e| e.task_id == task_id) {
                pending.push(entry);
                sort_pending(&mut pending);
            }
        }
        self.changed();
        Ok(())
    }

    /// Re-queues a failed or cancelled download from scratch (partial data is reused if present).
    pub fn retry_task(&self, task_id: &str) -> Result<(), String> {
        let mut entry = self
            .all_entries
            .read()
            .unwrap()
            .get(task_id)
            .cloned()
            .ok_or("That download can't be retried because its original request was lost.")?;
        let state = self.get_task(task_id).map(|t| t.state).ok_or("That download no longer exists.")?;
        if !matches!(state, DownloadState::Failed | DownloadState::Cancelled) {
            return Ok(());
        }
        entry.attempts = 0;
        entry.enqueued_at = now_ms();
        {
            let mut tasks = self.tasks.write().unwrap();
            if let Some(t) = tasks.get_mut(task_id) {
                t.state = DownloadState::Queued;
                t.stage = "Waiting to start".to_string();
                t.error_message = None;
                t.progress_percent = 0.0;
                t.downloaded_bytes = 0;
                t.speed_bytes_per_sec = 0;
                t.eta_seconds = None;
            }
        }
        self.all_entries.write().unwrap().insert(task_id.to_string(), entry.clone());
        {
            let mut pending = self.pending.lock().unwrap();
            pending.retain(|e| e.task_id != task_id);
            pending.push(entry);
            sort_pending(&mut pending);
        }
        emit_task(&self.app_handle, &self.tasks, task_id, "download-progress");
        self.changed();
        Ok(())
    }

    pub fn reorder_task(&self, task_id: &str, priority: i32) -> Result<(), String> {
        {
            let mut pending = self.pending.lock().unwrap();
            let entry = pending
                .iter_mut()
                .find(|e| e.task_id == task_id)
                .ok_or("Only waiting downloads can be reordered.")?;
            entry.priority = priority;
            sort_pending(&mut pending);
        }
        if let Some(entry) = self.all_entries.write().unwrap().get_mut(task_id) {
            entry.priority = priority;
        }
        self.changed();
        Ok(())
    }

    /// Swaps a waiting download with its neighbour and renumbers the queue so the order sticks.
    pub fn move_task(&self, task_id: &str, up: bool) -> Result<(), String> {
        let priorities: Vec<(String, i32)> = {
            let mut pending = self.pending.lock().unwrap();
            sort_pending(&mut pending);
            let idx = pending
                .iter()
                .position(|e| e.task_id == task_id)
                .ok_or("Only waiting downloads can be reordered.")?;
            let target = if up { idx.checked_sub(1) } else { Some(idx + 1).filter(|t| *t < pending.len()) };
            let Some(target) = target else { return Ok(()) };
            pending.swap(idx, target);
            let n = pending.len() as i32;
            for (i, e) in pending.iter_mut().enumerate() {
                e.priority = n - i as i32;
            }
            pending.iter().map(|e| (e.task_id.clone(), e.priority)).collect()
        };
        {
            let mut all = self.all_entries.write().unwrap();
            for (id, priority) in priorities {
                if let Some(e) = all.get_mut(&id) {
                    e.priority = priority;
                }
            }
        }
        self.changed();
        Ok(())
    }

    pub fn pause_all(&self) -> Result<(), String> {
        let ids: Vec<String> = self
            .tasks
            .read()
            .unwrap()
            .iter()
            .filter(|(_, t)| matches!(t.state, DownloadState::Queued | DownloadState::Downloading | DownloadState::Remuxing))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let _ = self.pause_task(&id);
        }
        Ok(())
    }

    pub fn resume_all(&self) -> Result<(), String> {
        let ids: Vec<String> = self
            .tasks
            .read()
            .unwrap()
            .iter()
            .filter(|(_, t)| t.state == DownloadState::Paused)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let _ = self.resume_task(&id);
        }
        Ok(())
    }

    pub fn clear_finished(&self) -> usize {
        let finished: Vec<String> = self
            .tasks
            .read()
            .unwrap()
            .iter()
            .filter(|(_, t)| matches!(t.state, DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled))
            .map(|(id, _)| id.clone())
            .collect();
        {
            let mut tasks = self.tasks.write().unwrap();
            let mut all = self.all_entries.write().unwrap();
            for id in &finished {
                tasks.remove(id);
                all.remove(id);
            }
        }
        self.changed();
        finished.len()
    }

    pub fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        let task = self.get_task(task_id).ok_or("That download no longer exists.")?;
        self.pending.lock().unwrap().retain(|e| e.task_id != task_id);
        let was_running = matches!(task.state, DownloadState::Downloading | DownloadState::Remuxing);
        self.set_state(task_id, DownloadState::Cancelled, "Cancelled")?;
        self.abort_running(task_id);
        // A running task cleans up after its process exits; otherwise clean up now.
        if !was_running {
            if let Some(planned) = task.planned_path {
                remove_partial_files(Path::new(&planned));
            }
        }
        self.changed();
        Ok(())
    }

    /// Cancels if needed and removes the task from the list entirely.
    pub fn remove_task(&self, task_id: &str) -> Result<(), String> {
        let active = self
            .get_task(task_id)
            .map(|t| !matches!(t.state, DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled))
            .unwrap_or(false);
        if active {
            self.cancel_task(task_id)?;
        }
        // Keep the Cancelled entry until the runner has cleaned up; the runner drops it after.
        if !active {
            self.tasks.write().unwrap().remove(task_id);
            self.all_entries.write().unwrap().remove(task_id);
        } else if let Some(t) = self.tasks.write().unwrap().get_mut(task_id) {
            t.stage = "Removing".to_string();
        }
        self.changed();
        Ok(())
    }

    pub async fn start_download(
        &self,
        app: AppHandle,
        options: DownloadOptions,
        priority: Option<i32>,
    ) -> Result<String, String> {
        if options.url.trim().is_empty() {
            return Err("Paste a link first.".to_string());
        }
        let options = DownloadOptions {
            title: if options.title.trim().is_empty() { options.url.clone() } else { options.title },
            ..options
        };
        if self.app_handle.read().unwrap().is_none() {
            self.attach_app(app.clone());
        }

        let task_id = format!("dl-{}", uuid_simple());
        let target_dir = options
            .output_dir
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_download_dir);
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Couldn't create the download folder {}: {}", target_dir.display(), e))?;

        let created_at = now_ms();
        let progress = progress_from_options(&task_id, &options, DownloadState::Queued, "Waiting to start", created_at);
        self.tasks.write().unwrap().insert(task_id.clone(), progress.clone());

        let entry = QueueEntry {
            task_id: task_id.clone(),
            options: DownloadOptions { cookies: None, ..options },
            priority: priority.unwrap_or(0),
            enqueued_at: created_at,
            attempts: 0,
            target_dir,
            had_cookies: false,
        };
        self.all_entries.write().unwrap().insert(task_id.clone(), entry.clone());
        {
            let mut pending = self.pending.lock().unwrap();
            pending.push(entry);
            sort_pending(&mut pending);
        }

        let _ = app.emit("download-progress", &progress);
        self.changed();
        Ok(task_id)
    }
}

/// Everything a running download needs, detached from the orchestrator borrow.
struct RunContext {
    tasks: TaskMap,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    notify: Arc<tokio::sync::Notify>,
    save_notify: Arc<tokio::sync::Notify>,
    config: Arc<RwLock<QueueConfig>>,
    pending: Arc<Mutex<Vec<QueueEntry>>>,
    abort_handles: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

impl RunContext {
    fn state_of(&self, task_id: &str) -> Option<DownloadState> {
        self.tasks.read().unwrap().get(task_id).map(|t| t.state.clone())
    }

    fn finish(&self) {
        self.save_notify.notify_one();
        self.notify.notify_one();
    }

    async fn run(self, entry: QueueEntry, mut abort_rx: tokio::sync::oneshot::Receiver<()>) {
        let task_id = entry.task_id.clone();
        ACTIVE_TRANSFERS.fetch_add(1, Ordering::SeqCst);

        let app = self.app_handle.read().unwrap().clone();
        let mut result = match app {
            Some(ref app) => run_download_task(&task_id, &entry, &self.tasks, app, &mut abort_rx).await,
            None => Err("The app isn't ready yet. Try again in a moment.".to_string()),
        };
        // The site may have changed: with a newer yt-dlp, try once more right away.
        if let (Err(e), Some(app)) = (&result, app.as_ref()) {
            let still_running = self.state_of(&task_id) == Some(DownloadState::Downloading);
            if still_running && crate::downloader::binary_manager::may_be_fixed_by_update(e) && {
                if let Some(t) = self.tasks.write().unwrap().get_mut(&task_id) {
                    t.stage = "Updating the download engine".to_string();
                    t.speed_bytes_per_sec = 0;
                }
                emit_task(&self.app_handle, &self.tasks, &task_id, "download-progress");
                BinaryManager::update_after_site_failure().await
            } {
                result = run_download_task(&task_id, &entry, &self.tasks, app, &mut abort_rx).await;
            }
        }

        ACTIVE_TRANSFERS.fetch_sub(1, Ordering::SeqCst);
        self.abort_handles.write().unwrap().remove(&task_id);

        match self.state_of(&task_id) {
            Some(DownloadState::Paused) => return self.finish(),
            Some(DownloadState::Cancelled) | None => {
                let planned = self.tasks.read().unwrap().get(&task_id).and_then(|t| t.planned_path.clone());
                if let Some(planned) = planned {
                    remove_partial_files(Path::new(&planned));
                }
                // remove_task() marks a running task "Removing"; drop it now that cleanup is done.
                let removing = self.tasks.read().unwrap().get(&task_id).map_or(false, |t| t.stage == "Removing");
                if removing {
                    self.tasks.write().unwrap().remove(&task_id);
                }
                return self.finish();
            }
            _ => {}
        }

        match result {
            Ok(outcome) => self.complete(&entry, outcome),
            Err(e) if e == ABORTED => {}
            Err(e) => self.fail_or_retry(entry, e),
        }
        self.finish();
    }

    fn complete(&self, entry: &QueueEntry, outcome: DownloadOutcome) {
        let task_id = &entry.task_id;
        let o = &entry.options;
        let (title, container) = {
            let mut tasks = self.tasks.write().unwrap();
            let Some(t) = tasks.get_mut(task_id) else { return };
            t.state = DownloadState::Completed;
            t.progress_percent = 100.0;
            t.speed_bytes_per_sec = 0;
            t.eta_seconds = None;
            t.stage = "Done".to_string();
            t.output_path = Some(outcome.file_path.clone());
            if let Ok(meta) = std::fs::metadata(&outcome.file_path) {
                t.total_bytes = Some(meta.len());
                t.downloaded_bytes = meta.len();
            }
            (t.title.clone(), t.container.clone())
        };

        let finished_title = title.clone();
        let size_bytes = std::fs::metadata(&outcome.file_path).map(|m| m.len()).unwrap_or(0);
        let item = LibraryItem {
            id: task_id.clone(),
            title,
            file_path: outcome.file_path.clone(),
            source_url: o.url.clone(),
            thumbnail_path: library::find_thumbnail(task_id),
            uploader: o.uploader.clone(),
            extractor: o.extractor.clone(),
            duration: o.duration,
            width: outcome.width,
            height: outcome.height,
            size_bytes,
            added_at: now_ms(),
            kind: if o.audio_only { MediaKind::Audio } else { MediaKind::Video },
            container: container.unwrap_or_else(|| extension_label(&outcome.file_path)),
            audio_languages: o.audio_languages.clone(),
            subtitle_languages: if o.audio_only { Vec::new() } else { o.subtitles.clone() },
            missing: false,
        };
        if let Some(thumb) = item.thumbnail_path.clone() {
            std::thread::spawn(move || library::shrink_thumbnail(Path::new(&thumb)));
        }
        // Files caught from the browser (installers, archives) aren't media: Downloads only.
        let library_result = if library::is_openable_media(&outcome.file_path) { library::add(item) } else { Err(String::new()) };

        emit_task(&self.app_handle, &self.tasks, task_id, "download-complete");
        if let Some(app) = self.app_handle.read().unwrap().as_ref() {
            if library_result.is_ok() {
                let _ = app.emit("library-changed", ());
            }
            announce_finished(app, &finished_title);
        }
    }

    fn fail_or_retry(&self, entry: QueueEntry, error: String) {
        let task_id = entry.task_id.clone();
        let (max_retries, backoff_ms) = {
            let cfg = self.config.read().unwrap();
            (cfg.max_retries, cfg.retry_backoff_ms)
        };

        if is_transient_error(&error) && entry.attempts < max_retries {
            let next_attempt = entry.attempts + 1;
            let backoff = backoff_ms.saturating_mul(1 << (next_attempt - 1).min(6));
            if let Some(t) = self.tasks.write().unwrap().get_mut(&task_id) {
                t.state = DownloadState::Queued;
                t.speed_bytes_per_sec = 0;
                t.eta_seconds = None;
                t.stage = format!("Connection problem — retrying in {}s (attempt {} of {})", backoff / 1000, next_attempt, max_retries);
                t.error_message = Some(error);
            }
            emit_task(&self.app_handle, &self.tasks, &task_id, "download-progress");

            let tasks = self.tasks.clone();
            let pending = self.pending.clone();
            let notify = self.notify.clone();
            let save_notify = self.save_notify.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(backoff)).await;
                // The user may have paused, cancelled or removed it while we waited.
                let still_queued = tasks.read().unwrap().get(&task_id).map_or(false, |t| t.state == DownloadState::Queued);
                if !still_queued {
                    return;
                }
                {
                    let mut p = pending.lock().unwrap();
                    p.retain(|e| e.task_id != task_id);
                    p.push(QueueEntry { attempts: next_attempt, enqueued_at: now_ms(), ..entry });
                    sort_pending(&mut p);
                }
                save_notify.notify_one();
                notify.notify_one();
            });
            return;
        }

        if let Some(t) = self.tasks.write().unwrap().get_mut(&task_id) {
            t.state = DownloadState::Failed;
            t.speed_bytes_per_sec = 0;
            t.eta_seconds = None;
            t.stage = "Failed".to_string();
            t.error_message = Some(error);
        }
        emit_task(&self.app_handle, &self.tasks, &task_id, "download-error");
    }
}

/// yt-dlp format selector for the chosen quality/audio options.
pub fn format_selector(o: &DownloadOptions) -> String {
    if o.audio_only {
        // Native M4A/AAC plays everywhere and needs no re-encode; fall back to the best audio.
        return "ba[ext=m4a]/ba/b".to_string();
    }
    let cap = o.max_height.map(|h| format!("[height<={}]", h)).unwrap_or_default();
    // MP4 output prefers AAC audio: Opus-in-MP4 is silent in some players and editors.
    let mp4_output = o.audio_languages.len() <= 1 && o.subtitles.is_empty();
    let aac_first = if mp4_output { format!("bv*{cap}+ba[ext=m4a]/") } else { String::new() };
    let fallback = format!("{aac_first}bv*{cap}+ba/b{cap}/bv*+ba/b");
    let languages: Vec<String> = o
        .audio_languages
        .iter()
        .map(|l| l.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect::<String>())
        .filter(|l| !l.is_empty())
        .collect();
    if languages.is_empty() {
        return fallback;
    }
    let audio: String = languages.iter().map(|l| format!("+ba[language={}]", l)).collect();
    format!("bv*{cap}{audio}/{fallback}")
}

/// What yt-dlp reads.
enum Input<'a> {
    Url,
    /// A saved description of the video (formats, links): skips loading the page again.
    InfoJson(&'a Path),
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Download,
    /// Only choose the formats and print the result as JSON.
    Select,
}

/// Full yt-dlp argument list (without the executable). Pure, so it's unit-testable.
fn build_args(
    o: &DownloadOptions,
    target_dir: &Path,
    thumb_template: &Path,
    ffmpeg: Option<&Path>,
    cookie_file: Option<&Path>,
    mode: Mode,
    input: &Input,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    let mut push = |s: &str| args.push(OsString::from(s));

    for a in [
        "--no-playlist", "--encoding", "utf-8",
        "--no-mtime", "--windows-filenames", "--continue",
        "--retries", "10", "--fragment-retries", "10", "--retry-sleep", "linear=1::5",
        "--socket-timeout", "30", "--concurrent-fragments", "8",
        "--write-thumbnail", "--convert-thumbnails", "jpg",
        // yt-dlp moves the index of every MP4 to the front, which rewrites the whole file a
        // second time (about 40% of merging; much more on hard drives). Players don't need it
        // for files on disk, so skip it.
        "--postprocessor-args", "ffmpeg:-movflags -faststart",
    ] {
        push(a);
    }
    match mode {
        Mode::Select => push("-j"),
        Mode::Download => {
            for a in [
                "--newline", "--no-simulate", "--progress",
                "--print", "video:HSINFO %(filesize,filesize_approx|0)s %(width|0)s %(height|0)s %(ext)s",
                "--print", "video:HSNAME %(filename)s",
                "--print", "video:HSTITLE %(title)s",
                "--print", "after_move:HSFILE %(filepath)s",
                "--progress-template",
                "download:HSPROG %(progress.downloaded_bytes|0)s %(progress.total_bytes,progress.total_bytes_estimate|0)s %(progress.speed|0)s",
                "--progress-template", "postprocess:HSPOST %(progress.postprocessor)s",
            ] {
                push(a);
            }
        }
    }

    push("-f");
    push(&format_selector(o));

    if o.audio_only {
        // Keep the source codec when possible (no lossy re-encode).
        push("-x");
    } else {
        if o.prefer_compatible {
            push("-S");
            push("res,fps,vcodec:h264,acodec:m4a");
        }
        let multi_audio = o.audio_languages.len() > 1;
        if multi_audio {
            push("--audio-multistreams");
        }
        push("--merge-output-format");
        // MKV holds any codec plus multiple audio/subtitle tracks; otherwise prefer MP4.
        push(if multi_audio || !o.subtitles.is_empty() { "mkv" } else { "mp4/mkv" });
        if !o.subtitles.is_empty() {
            // --embed-subs alone writes temporary files and removes them after embedding.
            push("--sub-langs");
            push(&o.subtitles.join(","));
            push("--embed-subs");
        }
    }

    if let Some(ff) = ffmpeg {
        args.push("--ffmpeg-location".into());
        args.push(ff.as_os_str().to_owned());
    }
    if let Some(cf) = cookie_file {
        args.push("--cookies".into());
        args.push(cf.as_os_str().to_owned());
    }

    args.push("-o".into());
    args.push(target_dir.join("%(title).120B [%(id)s].%(ext)s").into_os_string());
    let mut thumb = OsString::from("thumbnail:");
    thumb.push(thumb_template.as_os_str());
    args.push("-o".into());
    args.push(thumb);

    match input {
        Input::Url => {
            args.push("--".into());
            args.push(o.url.clone().into());
        }
        Input::InfoJson(path) => {
            args.push("--load-info-json".into());
            args.push(path.as_os_str().to_owned());
        }
    }
    args
}

/// Turns per-file progress (video, then audio, ...) into one overall progress figure.
#[derive(Debug, Default)]
struct ProgressTracker {
    expected_total: u64,
    completed_bytes: u64,
    last_downloaded: u64,
    last_total: u64,
}

impl ProgressTracker {
    /// Returns (overall_downloaded, overall_total).
    fn update(&mut self, downloaded: u64, total: u64) -> (u64, u64) {
        if downloaded < self.last_downloaded {
            // A new file started (e.g. the audio stream after the video stream).
            self.completed_bytes += self.last_total.max(self.last_downloaded);
        }
        self.last_downloaded = downloaded;
        self.last_total = total;
        let overall = self.completed_bytes + downloaded;
        let overall_total = self.expected_total.max(self.completed_bytes + total).max(overall);
        (overall, overall_total)
    }
}

fn extension_label(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_uppercase())
        .unwrap_or_default()
}

/// Deletes yt-dlp leftovers for a planned output: `.part`, `.ytdl`, `.fNNN.*` fragments.
/// Never touches a completed file with the same name.
fn remove_partial_files(planned: &Path) {
    let (Some(dir), Some(stem)) = (planned.parent(), planned.file_stem().and_then(|s| s.to_str())) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let prefix = format!("{}.", stem);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) {
            continue;
        }
        let rest = &name[prefix.len()..];
        let is_fragment = rest.starts_with('f') && rest[1..].split('.').next().map_or(false, |n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
        let engine_part = name.ends_with(".hspart") || name.ends_with(".hspart.json") || name.ends_with(".hspart.json.tmp");
        if name.ends_with(".part") || name.ends_with(".ytdl") || name.contains(".part-Frag") || name.ends_with(".temp") || is_fragment || engine_part {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Resolves only when the user pauses or cancels (a dropped sender is not an abort).
struct Abort<'a> {
    rx: &'a mut tokio::sync::oneshot::Receiver<()>,
    live: bool,
}

impl Abort<'_> {
    async fn requested(&mut self) {
        if self.live {
            let aborted = (&mut *self.rx).await.is_ok();
            self.live = false;
            if aborted {
                return;
            }
        }
        std::future::pending::<()>().await
    }
}

/// The fast engine is on unless HYPERSTREAM_TURBO=0 (for comparisons and troubleshooting).
fn fast_engine_enabled() -> bool {
    std::env::var("HYPERSTREAM_TURBO").map_or(true, |v| v != "0")
}

/// Runs a short yt-dlp step to completion; kills it if the user pauses or cancels.
async fn capture(mut cmd: std::process::Command, abort: &mut Abort<'_>) -> Result<std::process::Output, String> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| format!("Couldn't start the download engine: {}", e))?;
    let pid = child.id();
    let mut waiter = tokio::task::spawn_blocking(move || child.wait_with_output());
    tokio::select! {
        biased;
        _ = abort.requested() => {
            BinaryManager::kill_process_tree(pid);
            let _ = waiter.await;
            Err(ABORTED.to_string())
        }
        out = &mut waiter => out
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("The download engine stopped unexpectedly: {}", e)),
    }
}

/// yt-dlp's error lines, turned into a message for people.
fn engine_error(stderr_lines: &[String]) -> String {
    let errors: Vec<&str> = stderr_lines
        .iter()
        .filter(|l| l.starts_with("ERROR") || l.contains("error:"))
        .map(|s| s.as_str())
        .collect();
    let details = if !errors.is_empty() {
        errors.join("; ")
    } else {
        stderr_lines.last().cloned().unwrap_or_else(|| "The download engine exited with an error.".to_string())
    };
    crate::downloader::classify_download_error(&details)
}

/// What yt-dlp chose to download. Saved to `json_path` so later steps skip loading the page.
#[derive(Debug)]
struct Selection {
    json_path: PathBuf,
    filename: String,
    title: String,
    width: u32,
    height: u32,
    ext: String,
    size: u64,
    /// Set when every chosen stream is a plain file link the fast engine can fetch.
    streams: Option<Vec<turbo::Stream>>,
}

fn parse_selection(json: &str, json_path: PathBuf) -> Option<Selection> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let text = |from: &serde_json::Value, key: &str| from.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let number = |from: &serde_json::Value, key: &str| from.get(key).and_then(|x| x.as_f64()).filter(|x| *x > 0.0).map(|x| x as u64);

    let filename = v.get("filename").or_else(|| v.get("_filename"))?.as_str()?.to_string();
    let requested: Vec<&serde_json::Value> = v
        .get("requested_formats")
        .and_then(|r| r.as_array())
        .filter(|list| !list.is_empty())
        .map(|list| list.iter().collect())
        .unwrap_or_default();
    let merged = !requested.is_empty();
    let formats = if merged { requested } else { vec![&v] };
    // yt-dlp names separate streams "<name without extension>.f<format id>.<stream extension>".
    let stem = filename.rsplit_once('.').map_or(filename.as_str(), |(a, _)| a);
    let live = v.get("is_live").and_then(|x| x.as_bool()).unwrap_or(false);

    let mut size = 0u64;
    let mut streams = Vec::new();
    let mut eligible = !live;
    for f in &formats {
        size += number(f, "filesize").or_else(|| number(f, "filesize_approx")).unwrap_or(0);
        let protocol = text(f, "protocol");
        let url = text(f, "url");
        let fragmented = f.get("fragments").is_some_and(|x| !x.is_null());
        if !matches!(protocol.as_str(), "https" | "http") || url.is_empty() || fragmented {
            eligible = false;
            continue;
        }
        let dest = if merged { format!("{}.f{}.{}", stem, text(f, "format_id"), text(f, "ext")) } else { filename.clone() };
        let mut headers: Vec<(String, String)> = f
            .get("http_headers")
            .and_then(|h| h.as_object())
            .map(|h| h.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        if let Some(cookie) = f.get("cookies").and_then(|c| c.as_str()).and_then(turbo::cookie_header) {
            headers.push(("Cookie".to_string(), cookie));
        }
        streams.push(turbo::Stream {
            url,
            headers,
            size: number(f, "filesize"),
            dest: PathBuf::from(dest),
            max_request: f.get("downloader_options").and_then(|d| number(d, "http_chunk_size")),
        });
    }

    Some(Selection {
        json_path,
        filename,
        title: text(&v, "title"),
        width: number(&v, "width").unwrap_or(0) as u32,
        height: number(&v, "height").unwrap_or(0) as u32,
        ext: text(&v, "ext"),
        size,
        streams: (eligible && !streams.is_empty()).then_some(streams),
    })
}

/// Lets yt-dlp choose the formats without downloading. Uses the Hub's recent look-up of the
/// same link when there is one, so the page isn't loaded a second time.
/// `Ok(None)`: no single video was chosen (a playlist link, say); use the regular path.
async fn select_formats(
    task_id: &str,
    attempts: Vec<Vec<OsString>>,
    abort: &mut Abort<'_>,
) -> Result<Option<Selection>, String> {
    let json_path = extractor::scratch_dir().join(format!("selected-{}.json", task_id));
    let last = attempts.len().saturating_sub(1);
    for (i, args) in attempts.into_iter().enumerate() {
        let mut cmd = BinaryManager::create_command("yt-dlp")?;
        BinaryManager::apply_utf8_env(&mut cmd);
        cmd.args(args);
        let out = capture(cmd, abort).await?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let items: Vec<&str> = stdout.lines().filter(|l| l.trim_start().starts_with('{')).collect();
        if !out.status.success() || items.is_empty() {
            if i == last {
                let stderr: Vec<String> = String::from_utf8_lossy(&out.stderr).lines().map(|l| l.trim().to_string()).collect();
                return Err(engine_error(&stderr));
            }
            continue;
        }
        if items.len() > 1 {
            return Ok(None);
        }
        if std::fs::write(&json_path, items[0]).is_err() {
            return Ok(None);
        }
        return Ok(parse_selection(items[0], json_path));
    }
    Ok(None)
}

fn show_selection(task_id: &str, options: &DownloadOptions, tasks_ref: &TaskMap, app: &AppHandle, sel: &Selection) {
    let mut tasks = tasks_ref.write().unwrap();
    let Some(t) = tasks.get_mut(task_id) else { return };
    t.planned_path = Some(sel.filename.clone());
    if !sel.title.is_empty() && sel.title != "NA" && (t.title.trim().is_empty() || t.title == options.url) {
        t.title = sel.title.clone();
    }
    if sel.size > 0 {
        t.total_bytes = Some(sel.size);
    }
    if !options.audio_only && sel.height > 0 {
        // Portrait videos: label by the short side (1080x1920 is "1080p").
        t.quality_label = Some(format!("{}p", if sel.width > 0 { sel.width.min(sel.height) } else { sel.height }));
    }
    if !options.audio_only && !sel.ext.is_empty() {
        t.container = Some(sel.ext.to_ascii_uppercase());
    }
    t.stage = "Downloading".to_string();
    let _ = app.emit("download-progress", &t.clone());
}

fn report_progress(task_id: &str, tasks_ref: &TaskMap, app: &AppHandle, done: u64, total: u64, speed: u64, stage: &str) {
    let mut tasks = tasks_ref.write().unwrap();
    let Some(t) = tasks.get_mut(task_id) else { return };
    if t.state != DownloadState::Downloading {
        return;
    }
    t.downloaded_bytes = done;
    t.total_bytes = (total > 0).then_some(total);
    t.speed_bytes_per_sec = speed;
    t.progress_percent = if total > 0 { (done as f64 / total as f64 * 100.0).min(99.5) } else { 0.0 };
    t.eta_seconds = (speed > 0 && total > done).then(|| (total - done) / speed);
    t.stage = stage.to_string();
    let _ = app.emit("download-progress", &t.clone());
}

/// How many connections worked on each site before (see `turbo::limits_for`).
fn site_records_file() -> PathBuf {
    BinaryManager::get_bin_dir().parent().map_or_else(|| PathBuf::from("download_sites.json"), |d| d.join("download_sites.json"))
}

/// Downloads the chosen streams with the multi-connection engine, reporting progress.
async fn fetch_fast(
    task_id: &str,
    streams: Vec<turbo::Stream>,
    tasks_ref: &TaskMap,
    app: &AppHandle,
    abort: &mut Abort<'_>,
    one_connection: bool,
) -> Result<(), turbo::TurboError> {
    let meter = Arc::new(turbo::Meter::default());
    let cancel = Arc::new(AtomicBool::new(false));
    let site_url = streams.first().map(|s| s.url.clone()).unwrap_or_default();
    let records = site_records_file();
    let limits = turbo::limits_for(turbo::Limits::for_this_pc(crate::browser::is_low_memory_pc()), &site_url, &records);
    let mut job: std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), turbo::TurboError>> + Send>> = if one_connection {
        Box::pin(turbo::download_whole(streams.into_iter().next().ok_or(turbo::TurboError::Fallback("nothing to download".into()))?, meter.clone(), cancel.clone()))
    } else {
        Box::pin(turbo::download(streams, limits, meter.clone(), cancel.clone()))
    };
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    // Speed over the last ~3 s: steady enough to read, quick enough to follow changes.
    let mut history: VecDeque<(Instant, u64)> = VecDeque::new();
    loop {
        tokio::select! {
            biased;
            _ = abort.requested() => {
                cancel.store(true, Ordering::Relaxed);
                // Let the connections write what they have, so resuming continues from here.
                let _ = (&mut job).await;
                return Err(turbo::TurboError::Aborted);
            }
            result = &mut job => {
                if !one_connection {
                    turbo::remember_site(&site_url, &meter, &records);
                }
                return result;
            }
            _ = tick.tick() => {
                let done = meter.done.load(Ordering::Relaxed);
                let total = meter.total.load(Ordering::Relaxed);
                if total == 0 {
                    continue;
                }
                let now = Instant::now();
                history.push_back((now, done));
                while history.len() > 2 && now.duration_since(history[0].0) > Duration::from_secs(3) {
                    history.pop_front();
                }
                let (since, at) = history[0];
                let secs = now.duration_since(since).as_secs_f64();
                let speed = if secs > 0.2 { (done.saturating_sub(at) as f64 / secs) as u64 } else { 0 };
                let waiting = meter.waiting.load(Ordering::Relaxed);
                let (speed, stage) = if waiting { (0, "Waiting for the connection") } else { (speed, "Downloading") };
                report_progress(task_id, tasks_ref, app, done.min(total), total, speed, stage);
            }
        }
    }
}

/// What a yt-dlp run reported.
struct EngineRun {
    final_path: Option<String>,
    dims: (Option<u32>, Option<u32>),
}

/// Runs yt-dlp with live progress. `finishing`: the streams are already on disk and
/// yt-dlp only merges and tidies up, so its download progress is ignored.
async fn run_ytdlp(
    args: Vec<OsString>,
    task_id: &str,
    options: &DownloadOptions,
    tasks_ref: &TaskMap,
    app: &AppHandle,
    abort: &mut Abort<'_>,
    finishing: bool,
) -> Result<EngineRun, String> {
    let mut cmd = BinaryManager::create_command("yt-dlp")?;
    BinaryManager::apply_utf8_env(&mut cmd);
    cmd.args(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the download engine: {}", e))?;
    let pid = child.id();
    let stdout = child.stdout.take().ok_or("Couldn't read engine output")?;
    let stderr = child.stderr.take().ok_or("Couldn't read engine output")?;

    // stdout lines -> async channel (the reader thread blocks, the task doesn't).
    let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).map(|n| n > 0).unwrap_or(false) {
            let _ = line_tx.send(String::from_utf8_lossy(&buf).trim().to_string());
            buf.clear();
        }
    });
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_tail_writer = stderr_tail.clone();
    let err_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).map(|n| n > 0).unwrap_or(false) {
            let line = String::from_utf8_lossy(&buf).trim().to_string();
            if !line.is_empty() {
                let mut tail = stderr_tail_writer.lock().unwrap();
                tail.push(line);
                if tail.len() > 60 {
                    tail.remove(0);
                }
            }
            buf.clear();
        }
    });

    let mut tracker = ProgressTracker::default();
    let mut final_path: Option<String> = None;
    let mut dims: (Option<u32>, Option<u32>) = (None, None);
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    loop {
        tokio::select! {
            biased;
            _ = abort.requested() => {
                BinaryManager::kill_process_tree(pid);
                let _ = tokio::task::spawn_blocking(move || child.wait()).await;
                let _ = err_thread.join();
                return Err(ABORTED.to_string());
            }
            line = line_rx.recv() => {
                let Some(line) = line else { break };
                let mut parts = line.split_whitespace();
                match parts.next() {
                    Some("HSINFO") => {
                        let total: u64 = parts.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u64;
                        let w: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                        let h: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                        let ext = parts.next().unwrap_or("").to_ascii_uppercase();
                        if w > 0 && h > 0 {
                            dims = (Some(w), Some(h));
                        }
                        if finishing {
                            continue;
                        }
                        tracker.expected_total = total;
                        let mut tasks = tasks_ref.write().unwrap();
                        if let Some(t) = tasks.get_mut(task_id) {
                            if total > 0 {
                                t.total_bytes = Some(total);
                            }
                            if !options.audio_only && h > 0 {
                                // Portrait videos: label by the short side (1080x1920 is "1080p").
                                t.quality_label = Some(format!("{}p", if w > 0 { w.min(h) } else { h }));
                            }
                            if !options.audio_only && !ext.is_empty() {
                                t.container = Some(ext);
                            }
                            t.stage = "Downloading".to_string();
                        }
                    }
                    Some("HSNAME") => {
                        let planned = line.trim_start_matches("HSNAME").trim().to_string();
                        if let Some(t) = tasks_ref.write().unwrap().get_mut(task_id) {
                            t.planned_path = Some(planned);
                        }
                    }
                    Some("HSPROG") => {
                        if finishing {
                            continue;
                        }
                        let downloaded = parts.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u64;
                        let total = parts.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) as u64;
                        let speed = parts.next().and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0).max(0.0) as u64;
                        let (overall, overall_total) = tracker.update(downloaded, total);
                        if last_emit.elapsed() < Duration::from_millis(250) {
                            continue;
                        }
                        last_emit = Instant::now();
                        report_progress(task_id, tasks_ref, app, overall, overall_total, speed, "Downloading");
                    }
                    Some("HSPOST") => {
                        let step = parts.next().unwrap_or("");
                        let stage = match step {
                            "Merger" => "Merging audio and video",
                            "FFmpegEmbedSubtitle" => "Embedding subtitles",
                            "FFmpegExtractAudio" => "Extracting audio",
                            "MoveFiles" | "FFmpegConcat" => "Finishing",
                            _ => continue,
                        };
                        let mut tasks = tasks_ref.write().unwrap();
                        if let Some(t) = tasks.get_mut(task_id) {
                            if t.state == DownloadState::Downloading || t.state == DownloadState::Remuxing {
                                t.state = DownloadState::Remuxing;
                                t.stage = stage.to_string();
                                t.speed_bytes_per_sec = 0;
                                t.eta_seconds = None;
                                t.progress_percent = t.progress_percent.max(99.5);
                                let _ = app.emit("download-progress", &t.clone());
                            }
                        }
                    }
                    Some("HSTITLE") => {
                        // Batch/dropped links are queued before their title is known.
                        let title = line.trim_start_matches("HSTITLE").trim().to_string();
                        if !title.is_empty() && title != "NA" {
                            let mut tasks = tasks_ref.write().unwrap();
                            if let Some(t) = tasks.get_mut(task_id) {
                                if t.title.trim().is_empty() || t.title == options.url {
                                    t.title = title;
                                }
                            }
                        }
                    }
                    Some("HSFILE") => {
                        final_path = Some(line.trim_start_matches("HSFILE").trim().to_string());
                    }
                    _ => {}
                }
            }
        }
    }

    let status = tokio::task::spawn_blocking(move || child.wait())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("The download engine stopped unexpectedly: {}", e))?;
    let _ = err_thread.join();

    if !status.success() {
        return Err(engine_error(&stderr_tail.lock().unwrap()));
    }
    Ok(EngineRun { final_path, dims })
}

async fn run_download_task(
    task_id: &str,
    entry: &QueueEntry,
    tasks_ref: &TaskMap,
    app: &AppHandle,
    abort_rx: &mut tokio::sync::oneshot::Receiver<()>,
) -> Result<DownloadOutcome, String> {
    let options = &entry.options;
    let target_dir = &entry.target_dir;
    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Couldn't create the download folder {}: {}", target_dir.display(), e))?;

    let cookies = match options.cookies.clone() {
        Some(c) if !c.trim().is_empty() => Some(c),
        _ => browser_cookies_async(app, &options.url).await,
    };
    let cookie_file = cookies.as_deref().and_then(BinaryManager::write_temp_cookie_file);
    /// Deletes a temporary file when the download ends, however it ends.
    struct TempFile(Option<PathBuf>);
    impl Drop for TempFile {
        fn drop(&mut self) {
            if let Some(p) = &self.0 {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    let _cookie_guard = TempFile(cookie_file.clone());

    let mut abort = Abort { rx: abort_rx, live: true };
    if let Some(direct) = &options.direct {
        return run_direct(task_id, options, direct, target_dir, cookies.as_deref(), tasks_ref, app, &mut abort).await;
    }

    let ffmpeg = BinaryManager::find_binary("ffmpeg");
    let thumb_template = library::thumbnails_dir().join(format!("{}.%(ext)s", task_id));
    let args_for = |mode: Mode, input: &Input| {
        let mut args = build_args(options, target_dir, &thumb_template, ffmpeg.as_deref(), cookie_file.as_deref(), mode, input);
        if let Some(rate) = bandwidth::fixed_limit_per_download(ACTIVE_TRANSFERS.load(Ordering::Relaxed) as usize) {
            args.splice(0..0, [OsString::from("--limit-rate"), OsString::from(rate.to_string())]);
        }
        args
    };

    let selection = if fast_engine_enabled() {
        let mut attempts = Vec::new();
        if let Some(cached) = extractor::cached_info(&options.url) {
            attempts.push(args_for(Mode::Select, &Input::InfoJson(&cached)));
        }
        attempts.push(args_for(Mode::Select, &Input::Url));
        select_formats(task_id, attempts, &mut abort).await?
    } else {
        None
    };
    let _selection_guard = TempFile(selection.as_ref().map(|s| s.json_path.clone()));
    if let Some(sel) = &selection {
        show_selection(task_id, options, tasks_ref, app, sel);
    }

    let run = match &selection {
        None => run_ytdlp(args_for(Mode::Download, &Input::Url), task_id, options, tasks_ref, app, &mut abort, false).await?,
        Some(sel) => {
            let saved = Input::InfoJson(&sel.json_path);
            match sel.streams.clone() {
                None => run_ytdlp(args_for(Mode::Download, &saved), task_id, options, tasks_ref, app, &mut abort, false).await?,
                Some(streams) => {
                    let mut dests: Vec<PathBuf> = streams.iter().map(|s| s.dest.clone()).collect();
                    let mut result = fetch_fast(task_id, streams, tasks_ref, app, &mut abort, false).await;
                    // Links expire (YouTube's after about six hours, so a download paused overnight
                    // comes back to refused links): load the page again for fresh ones and carry on
                    // with the data already on disk. The fresh choice replaces the saved one.
                    if let Err(turbo::TurboError::Expired(reason)) = &result {
                        log::info!("Links expired ({}), loading the page again", reason);
                        let fresh = select_formats(task_id, vec![args_for(Mode::Select, &Input::Url)], &mut abort).await?;
                        result = match fresh.and_then(|f| f.streams) {
                            Some(streams) => {
                                let fresh_dests: Vec<PathBuf> = streams.iter().map(|s| s.dest.clone()).collect();
                                for old in dests.iter().filter(|d| !fresh_dests.contains(d)) {
                                    turbo::remove_partial(old);
                                }
                                dests = fresh_dests;
                                fetch_fast(task_id, streams, tasks_ref, app, &mut abort, false).await
                            }
                            None => Err(turbo::TurboError::Fallback("no fresh links".into())),
                        };
                    }
                    match result {
                        // The streams are on disk under the names yt-dlp expects; it skips
                        // downloading them and goes straight to merging.
                        Ok(()) => {
                            let finish = args_for(Mode::Download, &saved);
                            match run_ytdlp(finish.clone(), task_id, options, tasks_ref, app, &mut abort, true).await {
                                // Antivirus often scans new files for a moment; wait, then merge again.
                                Err(e) if e.contains("another program") => {
                                    tokio::time::sleep(Duration::from_secs(3)).await;
                                    run_ytdlp(finish, task_id, options, tasks_ref, app, &mut abort, true).await?
                                }
                                other => other?,
                            }
                        }
                        Err(turbo::TurboError::Aborted) => return Err(ABORTED.to_string()),
                        Err(turbo::TurboError::Interrupted(reason)) => return Err(interrupted_message(&reason)),
                        Err(turbo::TurboError::Expired(reason) | turbo::TurboError::Fallback(reason)) => {
                            log::warn!("Fast download unavailable ({}), using yt-dlp", reason);
                            for dest in &dests {
                                turbo::remove_partial(dest);
                            }
                            // A refused link may have expired: load the page again.
                            let input = if reason.starts_with("link refused") { Input::Url } else { saved };
                            run_ytdlp(args_for(Mode::Download, &input), task_id, options, tasks_ref, app, &mut abort, false).await?
                        }
                    }
                }
            }
        }
    };
    let dims = if run.dims.0.is_some() {
        run.dims
    } else {
        selection.as_ref().filter(|s| s.width > 0 && s.height > 0).map_or((None, None), |s| (Some(s.width), Some(s.height)))
    };

    // "Already downloaded" runs may skip after_move; fall back to the planned name.
    let final_file = run
        .final_path
        .or_else(|| tasks_ref.read().unwrap().get(task_id).and_then(|t| t.planned_path.clone()))
        .filter(|p| Path::new(p).is_file())
        .ok_or("The download finished but the file couldn't be found.")?;

    verify_output_integrity(&final_file)?;

    if let Some(t) = tasks_ref.write().unwrap().get_mut(task_id) {
        t.container = Some(extension_label(&final_file));
    }

    Ok(DownloadOutcome { file_path: final_file, width: dims.0, height: dims.1 })
}

/// A file link from the browser: many connections when the server allows it, one otherwise.
#[allow(clippy::too_many_arguments)]
async fn run_direct(
    task_id: &str,
    options: &DownloadOptions,
    direct: &DirectFile,
    target_dir: &Path,
    cookies: Option<&str>,
    tasks_ref: &TaskMap,
    app: &AppHandle,
    abort: &mut Abort<'_>,
) -> Result<DownloadOutcome, String> {
    // Resuming keeps the name picked the first time (its partial data is under that name).
    let planned = tasks_ref.read().unwrap().get(task_id).and_then(|t| t.planned_path.clone()).map(PathBuf::from);
    let dest = match planned {
        Some(p) if p.parent() == Some(target_dir) => p,
        _ => free_path(target_dir, &safe_file_name(&direct.filename)),
    };
    {
        let mut tasks = tasks_ref.write().unwrap();
        if let Some(t) = tasks.get_mut(task_id) {
            t.planned_path = Some(dest.to_string_lossy().to_string());
            t.container = Some(extension_label(&dest.to_string_lossy()));
            t.stage = "Downloading".to_string();
            let _ = app.emit("download-progress", &t.clone());
        }
    }

    let mut headers = Vec::new();
    if let Some(ua) = &direct.user_agent {
        headers.push(("User-Agent".to_string(), ua.clone()));
    }
    if let Some(referrer) = &direct.referrer {
        headers.push(("Referer".to_string(), referrer.clone()));
    }
    if let Some(cookie) = cookies.and_then(|c| crate::downloader::cookies::header_for_url(c, &options.url)) {
        headers.push(("Cookie".to_string(), cookie));
    }
    let stream = turbo::Stream { url: options.url.clone(), headers, size: None, dest: dest.clone(), max_request: None };

    match fetch_fast(task_id, vec![stream.clone()], tasks_ref, app, abort, false).await {
        Ok(()) => {}
        Err(turbo::TurboError::Aborted) => return Err(ABORTED.to_string()),
        Err(turbo::TurboError::Interrupted(reason)) => return Err(interrupted_message(&reason)),
        // The data is kept: the site may accept the link again later (after signing in, say).
        Err(turbo::TurboError::Expired(reason)) => return Err(crate::downloader::classify_download_error(&reason)),
        Err(turbo::TurboError::Fallback(reason)) => {
            log::info!("Single-connection download ({})", reason);
            turbo::remove_partial(&dest);
            match fetch_fast(task_id, vec![stream], tasks_ref, app, abort, true).await {
                Ok(()) => {}
                Err(turbo::TurboError::Aborted) => return Err(ABORTED.to_string()),
                Err(turbo::TurboError::Interrupted(reason)) => return Err(interrupted_message(&reason)),
                Err(turbo::TurboError::Expired(reason) | turbo::TurboError::Fallback(reason)) => {
                    return Err(crate::downloader::classify_download_error(&reason))
                }
            }
        }
    }
    let file_path = dest.to_string_lossy().to_string();
    verify_output_integrity(&file_path)?;
    Ok(DownloadOutcome { file_path, width: None, height: None })
}

fn verify_output_integrity(final_file: &str) -> Result<(), String> {
    let path = Path::new(final_file);
    let metadata = std::fs::metadata(path).map_err(|_| "The output file wasn't created.".to_string())?;
    if metadata.len() == 0 {
        return Err("The output file is empty — the download didn't complete.".to_string());
    }
    let is_iso = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "m4v" | "m4a" | "mov"))
        .unwrap_or(false);
    if is_iso && !crate::downloader::FastAtomInspector::verify_file(path) {
        return Err("The output file failed validation and may be corrupted.".to_string());
    }
    Ok(())
}

fn uuid_simple() -> String {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:04x}", now, COUNTER.fetch_add(1, Ordering::Relaxed) & 0xffff)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_orchestrator() -> DownloadOrchestrator {
        let o = DownloadOrchestrator::new();
        o.tasks.write().unwrap().clear();
        o.pending.lock().unwrap().clear();
        o.all_entries.write().unwrap().clear();
        o
    }

    fn queued(o: &DownloadOrchestrator, id: &str) {
        let options = DownloadOptions { url: "https://example.com/v".into(), title: "Sample".into(), ..Default::default() };
        o.tasks.write().unwrap().insert(id.into(), progress_from_options(id, &options, DownloadState::Queued, "Waiting", 1));
        let entry = QueueEntry {
            task_id: id.into(),
            options,
            priority: 0,
            enqueued_at: 100,
            attempts: 0,
            target_dir: PathBuf::from("downloads"),
            had_cookies: false,
        };
        o.all_entries.write().unwrap().insert(id.into(), entry.clone());
        o.pending.lock().unwrap().push(entry);
    }

    #[test]
    fn cancel_queued_task_removes_it_from_pending() {
        let o = empty_orchestrator();
        queued(&o, "t1");
        o.cancel_task("t1").unwrap();
        assert!(o.pending.lock().unwrap().is_empty());
        assert_eq!(o.get_task("t1").unwrap().state, DownloadState::Cancelled);
    }

    #[test]
    fn pause_resume_and_retry_transitions() {
        let o = empty_orchestrator();
        queued(&o, "t2");
        o.pause_task("t2").unwrap();
        assert_eq!(o.get_task("t2").unwrap().state, DownloadState::Paused);
        assert!(o.pending.lock().unwrap().is_empty());

        o.resume_task("t2").unwrap();
        assert_eq!(o.get_task("t2").unwrap().state, DownloadState::Queued);
        assert_eq!(o.pending.lock().unwrap().len(), 1);

        o.cancel_task("t2").unwrap();
        o.retry_task("t2").unwrap();
        assert_eq!(o.get_task("t2").unwrap().state, DownloadState::Queued);
        assert_eq!(o.pending.lock().unwrap().len(), 1);
    }

    #[test]
    fn move_task_swaps_neighbours_only() {
        let o = empty_orchestrator();
        for id in ["a", "b", "c"] {
            queued(&o, id);
        }
        // Same priority: order falls back to enqueue time, so make it distinct.
        for (i, e) in o.pending.lock().unwrap().iter_mut().enumerate() {
            e.enqueued_at = i as u64;
        }
        o.move_task("c", true).unwrap();
        let order: Vec<String> = o.pending.lock().unwrap().iter().map(|e| e.task_id.clone()).collect();
        assert_eq!(order, vec!["a", "c", "b"]);
        o.move_task("a", true).unwrap(); // already first: no-op
        let order: Vec<String> = o.pending.lock().unwrap().iter().map(|e| e.task_id.clone()).collect();
        assert_eq!(order, vec!["a", "c", "b"]);
    }

    #[test]
    fn remove_drops_finished_task() {
        let o = empty_orchestrator();
        queued(&o, "t3");
        o.cancel_task("t3").unwrap();
        o.remove_task("t3").unwrap();
        assert!(o.get_task("t3").is_none());
    }

    #[test]
    fn format_selector_always_includes_audio() {
        let base = DownloadOptions::default();
        assert_eq!(format_selector(&base), "bv*+ba[ext=m4a]/bv*+ba/b/bv*+ba/b");

        let capped = DownloadOptions { max_height: Some(720), ..Default::default() };
        assert_eq!(format_selector(&capped), "bv*[height<=720]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/bv*+ba/b");

        // MKV output (subtitles or several languages) keeps the best audio codec.
        let subbed = DownloadOptions { subtitles: vec!["en".into()], ..Default::default() };
        assert_eq!(format_selector(&subbed), "bv*+ba/b/bv*+ba/b");

        let dubbed = DownloadOptions { audio_languages: vec!["ja".into(), "en-US".into(), "bad]".into()], ..Default::default() };
        assert_eq!(
            format_selector(&dubbed),
            "bv*+ba[language=ja]+ba[language=en-US]+ba[language=bad]/bv*+ba/b/bv*+ba/b"
        );

        let audio = DownloadOptions { audio_only: true, ..Default::default() };
        assert_eq!(format_selector(&audio), "ba[ext=m4a]/ba/b");
    }

    #[test]
    fn args_pick_container_and_subtitles() {
        let o = DownloadOptions { url: "https://x.test/v".into(), subtitles: vec!["en".into(), "es".into()], ..Default::default() };
        let args: Vec<String> = build_args(&o, Path::new("C:/out"), Path::new("C:/t/id.%(ext)s"), None, None, Mode::Download, &Input::Url)
            .into_iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let pos = args.iter().position(|a| a == "--merge-output-format").unwrap();
        assert_eq!(args[pos + 1], "mkv");
        assert!(args.contains(&"--embed-subs".to_string()));
        assert!(args.contains(&"en,es".to_string()));
        assert!(!args.contains(&"--write-subs".to_string()), "--write-subs would leave .vtt files behind");
        assert_eq!(args.last().unwrap(), "https://x.test/v");
        assert_eq!(args[args.len() - 2], "--");

        let plain = DownloadOptions { url: "https://x.test/v".into(), ..Default::default() };
        let args: Vec<String> = build_args(&plain, Path::new("C:/out"), Path::new("C:/t/x"), None, None, Mode::Download, &Input::Url)
            .into_iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        let pos = args.iter().position(|a| a == "--merge-output-format").unwrap();
        assert_eq!(args[pos + 1], "mp4/mkv");
    }

    #[test]
    fn tracker_combines_video_and_audio_files() {
        let mut t = ProgressTracker { expected_total: 1000, ..Default::default() };
        assert_eq!(t.update(400, 800), (400, 1000));
        assert_eq!(t.update(800, 800), (800, 1000));
        // Audio stream starts: counter resets, overall keeps growing.
        assert_eq!(t.update(50, 200), (850, 1000));
        assert_eq!(t.update(200, 200), (1000, 1000));
    }

    #[test]
    fn file_names_from_links_are_safe() {
        assert_eq!(file_name_from_url("https://x.test/files/setup%20v2.exe?t=1#a"), "setup v2.exe");
        assert_eq!(file_name_from_url("https://x.test/"), "download");
        assert_eq!(safe_file_name("a<b>:c?.zip"), "a_b__c_.zip");
        assert_eq!(safe_file_name("CON.txt"), "download CON.txt");
        assert_eq!(safe_file_name("name. "), "name");
    }

    #[test]
    fn selection_names_streams_like_ytdlp() {
        let json = r#"{"filename":"C:\\out\\Clip [id].mp4","title":"Clip","ext":"mp4","width":1920,"height":1080,
            "requested_formats":[
              {"format_id":"137","ext":"mp4","protocol":"https","url":"https://v.test/1","filesize":1000,"http_headers":{"User-Agent":"UA"},"downloader_options":{"http_chunk_size":10485760}},
              {"format_id":"140","ext":"m4a","protocol":"https","url":"https://v.test/2","filesize_approx":200,"cookies":"s=1; Domain=.v.test; Path=/"}]}"#;
        let sel = parse_selection(json, PathBuf::from("sel.json")).unwrap();
        let streams = sel.streams.unwrap();
        assert_eq!(streams[0].dest, PathBuf::from("C:\\out\\Clip [id].f137.mp4"));
        assert_eq!(streams[1].dest, PathBuf::from("C:\\out\\Clip [id].f140.m4a"));
        assert_eq!(streams[0].max_request, Some(10485760));
        assert!(streams[1].headers.contains(&("Cookie".to_string(), "s=1".to_string())));
        assert_eq!(sel.size, 1200);

        let hls = r#"{"filename":"Clip.mp4","protocol":"m3u8_native","url":"https://v.test/x.m3u8"}"#;
        assert!(parse_selection(hls, PathBuf::from("s.json")).unwrap().streams.is_none());
    }

    #[test]
    fn partial_cleanup_keeps_completed_files() {
        let dir = std::env::temp_dir().join(format!("hs_partial_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        for name in ["Clip [id].mkv", "Clip [id].f137.mp4.part", "Clip [id].f251.webm", "Clip [id].mkv.ytdl", "Clip [id].f140.m4a.hspart", "Clip [id].f140.m4a.hspart.json", "Other.part"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        remove_partial_files(&dir.join("Clip [id].mkv"));
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(left, vec!["Clip [id].mkv".to_string(), "Other.part".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

