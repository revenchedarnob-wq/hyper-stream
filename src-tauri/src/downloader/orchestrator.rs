use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::ACTIVE_TRANSFERS;
use crate::downloader::binary_manager::BinaryManager;
use crate::downloader::queue::{
    get_queue_file_path, is_transient_error, load_queue_from_path, sanitize_for_persistence,
    save_queue_to_path, PersistedQueueEntry, QueueChangedPayload, QueueConfig, QueueEntry,
};

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

        orchestrator.restore_persisted_queue();

        if tokio::runtime::Handle::try_current().is_ok() {
            orchestrator.start_scheduler();
            orchestrator.start_persistence_worker();
        }

        orchestrator
    }

    pub fn attach_app(&self, app: AppHandle) {
        *self.app_handle.write().unwrap() = Some(app);
        if tokio::runtime::Handle::try_current().is_ok() {
            self.start_scheduler();
            self.start_persistence_worker();
        }
        self.emit_queue_state();
    }

    fn restore_persisted_queue(&self) {
        let queue_file = get_queue_file_path();
        if let Ok(entries) = load_queue_from_path(&queue_file) {
            let mut tasks = self.tasks.write().unwrap();
            let mut pending = self.pending.lock().unwrap();
            let mut all_entries = self.all_entries.write().unwrap();

            for item in entries {
                let is_paused = item.state == DownloadState::Paused;
                let state = if is_paused {
                    DownloadState::Paused
                } else {
                    DownloadState::Queued
                };

                let stage = if item.had_cookies && item.options.cookies.is_none() {
                    "Needs sign-in cookies".to_string()
                } else if is_paused {
                    "Paused by user".to_string()
                } else {
                    "Restored to queue".to_string()
                };

                let progress = DownloadProgress {
                    task_id: item.task_id.clone(),
                    title: item.options.title.clone(),
                    state,
                    progress_percent: 0.0,
                    speed_bytes_per_sec: 0,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    eta_seconds: None,
                    stage,
                    output_path: None,
                    error_message: None,
                };

                tasks.insert(item.task_id.clone(), progress);

                let priority = if item.had_cookies && item.options.cookies.is_none() {
                    i32::MIN
                } else {
                    item.priority
                };

                let entry = QueueEntry {
                    task_id: item.task_id.clone(),
                    options: item.options,
                    priority,
                    enqueued_at: item.enqueued_at,
                    attempts: item.attempts,
                    target_dir: item.target_dir,
                    had_cookies: item.had_cookies,
                };

                all_entries.insert(item.task_id.clone(), entry.clone());

                if !is_paused {
                    pending.push(entry);
                }
            }

            pending.sort_by(|a, b| {
                b.priority.cmp(&a.priority)
                    .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
            });
        }
    }

    fn start_persistence_worker(&self) {
        if self.persistence_started.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        let save_notify = self.save_notify.clone();
        let pending_ref = self.pending.clone();
        let tasks_ref = self.tasks.clone();
        let all_entries_ref = self.all_entries.clone();

        tokio::spawn(async move {
            loop {
                save_notify.notified().await;

                // 500ms debounce loop: keep waiting if new saves arrive
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(500)) => {
                            break;
                        }
                        _ = save_notify.notified() => {}
                    }
                }

                let mut entries_to_save: Vec<PersistedQueueEntry> = Vec::new();
                {
                    let p = pending_ref.lock().unwrap();
                    let t = tasks_ref.read().unwrap();
                    let all = all_entries_ref.read().unwrap();

                    // Pending items
                    for entry in p.iter() {
                        let state = t.get(&entry.task_id)
                            .map(|task| task.state.clone())
                            .unwrap_or(DownloadState::Queued);
                        entries_to_save.push(sanitize_for_persistence(entry, state));
                    }

                    // Paused items
                    for (task_id, task) in t.iter() {
                        if task.state == DownloadState::Paused && !p.iter().any(|e| &e.task_id == task_id) {
                            if let Some(entry) = all.get(task_id) {
                                entries_to_save.push(sanitize_for_persistence(entry, DownloadState::Paused));
                            }
                        }
                    }
                }

                let path = get_queue_file_path();
                let _ = save_queue_to_path(&path, &entries_to_save);
            }
        });
    }

    fn start_scheduler(&self) {
        if self.scheduler_started.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        let notify = self.notify.clone();
        let pending_ref = self.pending.clone();
        let tasks_ref = self.tasks.clone();
        let config_ref = self.config.clone();
        let abort_handles = self.abort_handles.clone();
        let app_handle_ref = self.app_handle.clone();
        let save_notify = self.save_notify.clone();

        tokio::spawn(async move {
            loop {
                let max_concurrent = {
                    let cfg = config_ref.read().unwrap();
                    cfg.max_concurrent.clamp(1, 8)
                };

                let running_count = {
                    let tasks = tasks_ref.read().unwrap();
                    tasks.values()
                        .filter(|t| t.state == DownloadState::Downloading || t.state == DownloadState::Remuxing)
                        .count()
                };

                let can_spawn = if running_count < max_concurrent {
                    max_concurrent - running_count
                } else {
                    0
                };

                let mut to_spawn = Vec::new();
                if can_spawn > 0 {
                    let mut pending = pending_ref.lock().unwrap();
                    pending.sort_by(|a, b| {
                        b.priority.cmp(&a.priority)
                            .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
                    });

                    let num_take = can_spawn.min(pending.len());
                    for _ in 0..num_take {
                        to_spawn.push(pending.remove(0));
                    }
                }

                Self::emit_queue_change_event(&app_handle_ref, &pending_ref, &tasks_ref, max_concurrent);

                for entry in to_spawn {
                    let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
                    {
                        let mut handles = abort_handles.write().unwrap();
                        handles.insert(entry.task_id.clone(), abort_tx);
                    }

                    {
                        let mut tasks = tasks_ref.write().unwrap();
                        if let Some(t) = tasks.get_mut(&entry.task_id) {
                            t.state = DownloadState::Downloading;
                            t.stage = "Connecting to media stream...".to_string();
                        }
                    }

                    if let Some(app) = app_handle_ref.read().unwrap().as_ref() {
                        if let Some(t) = tasks_ref.read().unwrap().get(&entry.task_id) {
                            let _ = app.emit("download-progress", t);
                        }
                    }

                    let task_id_clone = entry.task_id.clone();
                    let options_clone = entry.options.clone();
                    let target_dir_clone = entry.target_dir.clone();
                    let tasks_ref_clone = tasks_ref.clone();
                    let app_handle_ref_clone = app_handle_ref.clone();
                    let notify_clone = notify.clone();
                    let save_notify_clone = save_notify.clone();
                    let config_ref_clone = config_ref.clone();
                    let pending_ref_clone = pending_ref.clone();
                    let attempts = entry.attempts;

                    tokio::spawn(async move {
                        ACTIVE_TRANSFERS.fetch_add(1, Ordering::SeqCst);

                        let dummy_app = app_handle_ref_clone.read().unwrap().clone();
                        let res = if let Some(ref app) = dummy_app {
                            Self::run_download_task(
                                &task_id_clone,
                                &options_clone,
                                &target_dir_clone,
                                &tasks_ref_clone,
                                app,
                                &mut abort_rx,
                            ).await
                        } else {
                            Err("AppHandle not attached".to_string())
                        };

                        ACTIVE_TRANSFERS.fetch_sub(1, Ordering::SeqCst);

                        let is_paused = {
                            let tasks = tasks_ref_clone.read().unwrap();
                            tasks.get(&task_id_clone)
                                .map(|t| t.state == DownloadState::Paused)
                                .unwrap_or(false)
                        };

                        let is_cancelled = {
                            let tasks = tasks_ref_clone.read().unwrap();
                            tasks.get(&task_id_clone)
                                .map(|t| t.state == DownloadState::Cancelled)
                                .unwrap_or(false)
                        };

                        if is_paused || is_cancelled {
                            save_notify_clone.notify_one();
                            notify_clone.notify_one();
                            return;
                        }

                        match res {
                            Ok(final_path) => {
                                {
                                    let mut tasks = tasks_ref_clone.write().unwrap();
                                    if let Some(t) = tasks.get_mut(&task_id_clone) {
                                        t.state = DownloadState::Completed;
                                        t.progress_percent = 100.0;
                                        t.stage = "Download completed successfully".to_string();
                                        t.output_path = Some(final_path);
                                    }
                                }
                                if let Some(app) = app_handle_ref_clone.read().unwrap().as_ref() {
                                    if let Some(t) = tasks_ref_clone.read().unwrap().get(&task_id_clone) {
                                        let _ = app.emit("download-complete", t);
                                    }
                                }
                                save_notify_clone.notify_one();
                                notify_clone.notify_one();
                            }
                            Err(e) => {
                                let (max_retries, retry_backoff_ms) = {
                                    let cfg = config_ref_clone.read().unwrap();
                                    (cfg.max_retries, cfg.retry_backoff_ms)
                                };

                                let transient = is_transient_error(&e);

                                if transient && attempts < max_retries {
                                    let next_attempts = attempts + 1;
                                    let backoff = retry_backoff_ms * (1 << (next_attempts - 1));
                                    let backoff_secs = (backoff as f64) / 1000.0;

                                    {
                                        let mut tasks = tasks_ref_clone.write().unwrap();
                                        if let Some(t) = tasks.get_mut(&task_id_clone) {
                                            t.state = DownloadState::Queued;
                                            t.stage = format!(
                                                "Transient error: {}. Retrying in {:.1}s (attempt {} of {})...",
                                                e, backoff_secs, next_attempts, max_retries
                                            );
                                            t.error_message = Some(e.clone());
                                        }
                                    }

                                    if let Some(app) = app_handle_ref_clone.read().unwrap().as_ref() {
                                        if let Some(t) = tasks_ref_clone.read().unwrap().get(&task_id_clone) {
                                            let _ = app.emit("download-progress", t);
                                        }
                                    }

                                    let pending_inner = pending_ref_clone.clone();
                                    let notify_inner = notify_clone.clone();
                                    let save_inner = save_notify_clone.clone();
                                    let task_id_inner = task_id_clone.clone();
                                    let options_inner = options_clone.clone();
                                    let target_dir_inner = target_dir_clone.clone();

                                    tokio::spawn(async move {
                                        tokio::time::sleep(Duration::from_millis(backoff)).await;
                                        {
                                            let mut p = pending_inner.lock().unwrap();
                                            p.push(QueueEntry {
                                                task_id: task_id_inner,
                                                options: options_inner,
                                                priority: 0,
                                                enqueued_at: now_ms(),
                                                attempts: next_attempts,
                                                target_dir: target_dir_inner,
                                                had_cookies: false,
                                            });
                                            p.sort_by(|a, b| {
                                                b.priority.cmp(&a.priority)
                                                    .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
                                            });
                                        }
                                        save_inner.notify_one();
                                        notify_inner.notify_one();
                                    });
                                } else {
                                    {
                                        let mut tasks = tasks_ref_clone.write().unwrap();
                                        if let Some(t) = tasks.get_mut(&task_id_clone) {
                                            t.state = DownloadState::Failed;
                                            t.stage = format!("Download failed: {}", e);
                                            t.error_message = Some(e.clone());
                                        }
                                    }
                                    if let Some(app) = app_handle_ref_clone.read().unwrap().as_ref() {
                                        if let Some(t) = tasks_ref_clone.read().unwrap().get(&task_id_clone) {
                                            let _ = app.emit("download-error", t);
                                        }
                                    }
                                    save_notify_clone.notify_one();
                                    notify_clone.notify_one();
                                }
                            }
                        }
                    });
                }

                notify.notified().await;
            }
        });
    }

    fn emit_queue_change_event(
        app_handle_ref: &Arc<RwLock<Option<AppHandle>>>,
        pending_ref: &Arc<Mutex<Vec<QueueEntry>>>,
        tasks_ref: &Arc<RwLock<HashMap<String, DownloadProgress>>>,
        max_concurrent: usize,
    ) {
        if let Some(app) = app_handle_ref.read().unwrap().as_ref() {
            let order = {
                let p = pending_ref.lock().unwrap();
                p.iter().map(|e| e.task_id.clone()).collect::<Vec<String>>()
            };

            let running = {
                let tasks = tasks_ref.read().unwrap();
                tasks.values()
                    .filter(|t| t.state == DownloadState::Downloading || t.state == DownloadState::Remuxing)
                    .count()
            };

            let payload = QueueChangedPayload {
                order,
                running,
                max_concurrent,
            };

            let _ = app.emit("download-queue-changed", &payload);
        }
    }

    pub fn emit_queue_state(&self) {
        let max_conc = self.config.read().unwrap().max_concurrent.clamp(1, 8);
        Self::emit_queue_change_event(&self.app_handle, &self.pending, &self.tasks, max_conc);
    }

    pub fn get_tasks(&self) -> Vec<DownloadProgress> {
        let tasks = self.tasks.read().unwrap();
        tasks.values().cloned().collect()
    }

    pub fn get_task(&self, task_id: &str) -> Option<DownloadProgress> {
        let tasks = self.tasks.read().unwrap();
        tasks.get(task_id).cloned()
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

    pub fn pause_task(&self, task_id: &str) -> Result<(), String> {
        // 1. If in pending, remove it
        {
            let mut pending = self.pending.lock().unwrap();
            pending.retain(|e| e.task_id != task_id);
        }

        // 2. If running, abort it
        {
            let mut handles = self.abort_handles.write().unwrap();
            if let Some(tx) = handles.remove(task_id) {
                let _ = tx.send(());
            }
        }

        // 3. Mark as Paused in tasks
        {
            let mut tasks = self.tasks.write().unwrap();
            if let Some(t) = tasks.get_mut(task_id) {
                t.state = DownloadState::Paused;
                t.stage = "Paused by user".to_string();
                t.speed_bytes_per_sec = 0;
            }
        }

        if let Some(app) = self.app_handle.read().unwrap().as_ref() {
            if let Some(t) = self.tasks.read().unwrap().get(task_id) {
                let _ = app.emit("download-progress", t);
            }
        }

        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();
        Ok(())
    }

    pub fn resume_task(&self, task_id: &str) -> Result<(), String> {
        let entry = {
            let all = self.all_entries.read().unwrap();
            all.get(task_id).cloned()
        };

        let entry = match entry {
            Some(e) => e,
            None => {
                let tasks = self.tasks.read().unwrap();
                let t = tasks.get(task_id).ok_or_else(|| format!("Task {} not found", task_id))?;
                QueueEntry {
                    task_id: task_id.to_string(),
                    options: DownloadOptions {
                        url: "".to_string(),
                        title: t.title.clone(),
                        format_id: None,
                        output_dir: None,
                        audio_formats: vec![],
                        subtitles: vec![],
                        cookies: None,
                    },
                    priority: 0,
                    enqueued_at: now_ms(),
                    attempts: 0,
                    target_dir: PathBuf::from("downloads"),
                    had_cookies: false,
                }
            }
        };

        {
            let mut tasks = self.tasks.write().unwrap();
            if let Some(t) = tasks.get_mut(task_id) {
                t.state = DownloadState::Queued;
                t.stage = "Resuming download...".to_string();
            }
        }

        {
            let mut pending = self.pending.lock().unwrap();
            if !pending.iter().any(|e| e.task_id == task_id) {
                pending.push(entry);
                pending.sort_by(|a, b| {
                    b.priority.cmp(&a.priority)
                        .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
                });
            }
        }

        if let Some(app) = self.app_handle.read().unwrap().as_ref() {
            if let Some(t) = self.tasks.read().unwrap().get(task_id) {
                let _ = app.emit("download-progress", t);
            }
        }

        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();
        Ok(())
    }

    pub fn reorder_task(&self, task_id: &str, priority: i32) -> Result<(), String> {
        {
            let mut pending = self.pending.lock().unwrap();
            if let Some(entry) = pending.iter_mut().find(|e| e.task_id == task_id) {
                entry.priority = priority;
            } else {
                return Err(format!("Task {} not in pending queue", task_id));
            }
            pending.sort_by(|a, b| {
                b.priority.cmp(&a.priority)
                    .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
            });
        }

        {
            let mut all = self.all_entries.write().unwrap();
            if let Some(entry) = all.get_mut(task_id) {
                entry.priority = priority;
            }
        }

        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();
        Ok(())
    }

    pub fn pause_all(&self) -> Result<(), String> {
        let task_ids: Vec<String> = {
            let tasks = self.tasks.read().unwrap();
            tasks.iter()
                .filter(|(_, t)| matches!(t.state, DownloadState::Queued | DownloadState::Downloading | DownloadState::Remuxing))
                .map(|(id, _)| id.clone())
                .collect()
        };

        for id in task_ids {
            let _ = self.pause_task(&id);
        }
        Ok(())
    }

    pub fn resume_all(&self) -> Result<(), String> {
        let task_ids: Vec<String> = {
            let tasks = self.tasks.read().unwrap();
            tasks.iter()
                .filter(|(_, t)| t.state == DownloadState::Paused)
                .map(|(id, _)| id.clone())
                .collect()
        };

        for id in task_ids {
            let _ = self.resume_task(&id);
        }
        Ok(())
    }

    pub fn clear_finished(&self) -> usize {
        let count = {
            let mut tasks = self.tasks.write().unwrap();
            let finished_ids: Vec<String> = tasks.iter()
                .filter(|(_, t)| matches!(t.state, DownloadState::Completed | DownloadState::Failed | DownloadState::Cancelled))
                .map(|(id, _)| id.clone())
                .collect();

            let c = finished_ids.len();
            for id in &finished_ids {
                tasks.remove(id);
            }
            c
        };

        {
            let mut all = self.all_entries.write().unwrap();
            let tasks = self.tasks.read().unwrap();
            all.retain(|id, _| tasks.contains_key(id));
        }

        self.save_notify.notify_one();
        self.emit_queue_state();
        count
    }

    pub fn cancel_task(&self, task_id: &str) -> Result<(), String> {
        // 1. Remove from pending so it never spawns
        {
            let mut pending = self.pending.lock().unwrap();
            pending.retain(|e| e.task_id != task_id);
        }

        // 2. Abort if currently running
        {
            let mut handles = self.abort_handles.write().unwrap();
            if let Some(tx) = handles.remove(task_id) {
                let _ = tx.send(());
            }
        }

        // 3. Mark state as Cancelled
        {
            let mut tasks = self.tasks.write().unwrap();
            if let Some(t) = tasks.get_mut(task_id) {
                t.state = DownloadState::Cancelled;
                t.stage = "Cancelled by user".to_string();
                t.speed_bytes_per_sec = 0;
            }
        }

        if let Some(app) = self.app_handle.read().unwrap().as_ref() {
            if let Some(t) = self.tasks.read().unwrap().get(task_id) {
                let _ = app.emit("download-progress", t);
            }
        }

        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();
        Ok(())
    }

    pub async fn start_download(
        &self,
        app: AppHandle,
        options: DownloadOptions,
        priority: Option<i32>,
    ) -> Result<String, String> {
        if self.app_handle.read().unwrap().is_none() {
            self.attach_app(app.clone());
        }

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
            stage: "Queued in download pipeline...".to_string(),
            output_path: None,
            error_message: None,
        };

        {
            let mut tasks = self.tasks.write().unwrap();
            tasks.insert(task_id.clone(), initial_progress.clone());
        }

        let entry = QueueEntry {
            task_id: task_id.clone(),
            options: options.clone(),
            priority: priority.unwrap_or(0),
            enqueued_at: now_ms(),
            attempts: 0,
            target_dir,
            had_cookies: options.cookies.is_some(),
        };

        {
            let mut all = self.all_entries.write().unwrap();
            all.insert(task_id.clone(), entry.clone());
        }

        {
            let mut pending = self.pending.lock().unwrap();
            pending.push(entry);
            pending.sort_by(|a, b| {
                b.priority.cmp(&a.priority)
                    .then_with(|| a.enqueued_at.cmp(&b.enqueued_at))
            });
        }

        let _ = app.emit("download-progress", &initial_progress);

        self.save_notify.notify_one();
        self.notify.notify_one();
        self.emit_queue_state();

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

        // Resume an interrupted transfer instead of restarting at 0%.
        cmd.arg("--continue");
        // Network resilience: retry transient failures with linear backoff.
        cmd.arg("--retries");
        cmd.arg("10");
        cmd.arg("--fragment-retries");
        cmd.arg("10");
        cmd.arg("--retry-sleep");
        cmd.arg("linear=1::5");
        cmd.arg("--socket-timeout");
        cmd.arg("30");

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
                    cmd.arg(cf.to_string_lossy().to_string());
                    temp_cookie = Some(cf);
                }
            }
        }

        cmd.arg(&options.url);

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

        let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "Failed to capture stderr".to_string())?;

        let stderr_log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let stderr_log_clone = stderr_log.clone();

        let err_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Ok(mut lock) = stderr_log_clone.lock() {
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

        let status = child.wait().map_err(|e| format!("Failed to wait for process exit: {}", e))?;
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
            return Err(crate::downloader::classify_download_error(&error_details));
        }

        let final_file = detected_output_file.unwrap_or_else(|| {
            target_dir.join(format!("{}.mkv", safe_title)).to_string_lossy().to_string()
        });

        Self::verify_output_integrity(task_id, &final_file, tasks_ref, app)?;

        Ok(final_file)
    }

    fn verify_output_integrity(
        task_id: &str,
        final_file: &str,
        tasks_ref: &Arc<RwLock<HashMap<String, DownloadProgress>>>,
        app: &AppHandle,
    ) -> Result<(), String> {
        {
            let mut tasks = tasks_ref.write().unwrap();
            if let Some(t) = tasks.get_mut(task_id) {
                t.stage = "Verifying file integrity...".to_string();
                let _ = app.emit("download-progress", &t.clone());
            }
        }

        let path = Path::new(final_file);

        let metadata = std::fs::metadata(path)
            .map_err(|_| "Output file was not produced on disk.".to_string())?;
        if metadata.len() == 0 {
            return Err("Output file is empty (0 bytes) — the download did not complete.".to_string());
        }

        let is_iso = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "m4v" | "m4a" | "mov"))
            .unwrap_or(false);

        if is_iso && !crate::downloader::FastAtomInspector::verify_file(path) {
            return Err("Output file failed container validation — it may be corrupted.".to_string());
        }

        Ok(())
    }
}

fn uuid_simple() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", now)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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

    #[test]
    fn test_cancel_queued_task_removes_from_pending() {
        let orchestrator = DownloadOrchestrator::new();
        let task_id = "test-dl-1";

        {
            let mut tasks = orchestrator.tasks.write().unwrap();
            tasks.insert(task_id.to_string(), DownloadProgress {
                task_id: task_id.to_string(),
                title: "Queued Sample".to_string(),
                state: DownloadState::Queued,
                progress_percent: 0.0,
                speed_bytes_per_sec: 0,
                downloaded_bytes: 0,
                total_bytes: None,
                eta_seconds: None,
                stage: "Queued".to_string(),
                output_path: None,
                error_message: None,
            });
        }

        {
            let mut pending = orchestrator.pending.lock().unwrap();
            pending.push(QueueEntry {
                task_id: task_id.to_string(),
                options: DownloadOptions {
                    url: "https://example.com/video".to_string(),
                    title: "Queued Sample".to_string(),
                    format_id: None,
                    output_dir: None,
                    audio_formats: vec![],
                    subtitles: vec![],
                    cookies: None,
                },
                priority: 0,
                enqueued_at: 100,
                attempts: 0,
                target_dir: PathBuf::from("downloads"),
                had_cookies: false,
            });
        }

        assert_eq!(orchestrator.pending.lock().unwrap().len(), 1);
        orchestrator.cancel_task(task_id).expect("cancel should succeed");
        assert_eq!(orchestrator.pending.lock().unwrap().len(), 0);
        let task = orchestrator.get_task(task_id).unwrap();
        assert_eq!(task.state, DownloadState::Cancelled);
    }
}
