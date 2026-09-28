# Spec: Download Queue Engine

## Goal
Replace "spawn every download immediately" in `DownloadOrchestrator` with a bounded,
ordered queue: concurrency limit, pause/resume, reorder, retry, and persistence across restarts.

## Scope
- In: `src-tauri/src/downloader/orchestrator.rs`, new `src-tauri/src/downloader/queue.rs`,
  `src-tauri/src/lib.rs` (commands), `src/lib/tauri-bridge.ts`, `src/components/stream-hub/*`.
- Out: `src-tauri/src/downloader/quarantine/` and anything behind the `experimental-drm` feature.
  Do not import from or touch it. Build/test with default features only.

## Current behavior (problem)
- `start_download` inserts a `Queued` task, then `tokio::spawn`s it right away, so the queue has no limit.
- `DownloadState::Paused` exists but nothing uses it.
- If you cancel a task that hasn't started, it may still spawn later. Nothing orders or persists tasks.

## Design
### Data
```rust
pub struct QueueEntry {
    pub task_id: String,
    pub options: DownloadOptions,
    pub priority: i32,        // higher first; default 0
    pub enqueued_at: u64,     // unix ms, FIFO tiebreak
    pub attempts: u32,
}
pub struct QueueConfig {
    pub max_concurrent: usize, // default 3, range 1..=8
    pub max_retries: u32,      // default 2
    pub retry_backoff_ms: u64, // default 5000, doubles per attempt
}
```
`DownloadOrchestrator` gains `pending: Mutex<Vec<QueueEntry>>` (sorted by `(-priority, enqueued_at)`),
`config: RwLock<QueueConfig>`, and a `tokio::sync::Notify` scheduler wake-up.

### Scheduler
- One long-lived tokio task started in `DownloadOrchestrator::new()` (or on first enqueue).
- Loop: while `running < max_concurrent` and `pending` is non-empty, pop the head and run it with the
  existing `run_download_task`. Then `notify.notified().await`.
- Notify on: enqueue, task finish (any state), config change, resume, reorder.
- Keep the `ACTIVE_TRANSFERS` inc/dec exactly as today (only for running tasks).

### State transitions
```
Queued -> Downloading -> Remuxing -> Completed
Queued -> Cancelled                 (removed from pending, never spawned)
Downloading/Remuxing -> Paused      (kill child, keep partial files, push back to pending front)
Paused -> Queued                    (resume)
Downloading -> Failed -> Queued     (auto-retry if attempts < max_retries, after backoff)
any active -> Cancelled             (existing abort path)
```
- Pause relies on yt-dlp's `--continue` (partial `.part` files) so resume continues the download. Make sure
  that flag is set in `run_download_task`.
- Retry only failures classified as transient (network/timeout/HTTP 5xx/429). Use `error_classifier.rs` if
  it's ready; otherwise match stderr for those patterns. Don't retry 4xx, "unsupported URL", or missing formats.

### Persistence
- Save `pending` + `Paused` entries to `%APPDATA%/HyperStream/queue.json` on every change
  (debounce 500 ms). Load on startup; entries that were `Downloading` when the app closed come back as `Queued`.
- Strip `options.cookies` before writing to disk. Tasks restored without cookies go to the back of the
  queue with `stage = "Needs sign-in cookies"` if the original had them (store a `had_cookies: bool` flag).

### Tauri commands (register in `generate_handler!`)
| Command | Args | Returns |
|---|---|---|
| `start_universal_download` (existing) | `options`, `priority?: i32` | `task_id` (now enqueues) |
| `pause_download` | `task_id` | `()` |
| `resume_download` | `task_id` | `()` |
| `reorder_download` | `task_id`, `priority: i32` | `()` |
| `get_queue_config` / `set_queue_config` | `QueueConfig` | `QueueConfig` |
| `pause_all` / `resume_all` | — | `()` |
| `clear_finished` | — | `usize` removed |

`cancel_download` must also remove the task from `pending`.

### Events
Keep `download-progress|complete|error`. Add `download-queue-changed` with payload
`{ order: string[], running: number, max_concurrent: number }` on every queue mutation.

### Frontend
- `tauri-bridge.ts`: typed wrappers for the new commands and `listen('download-queue-changed')`.
- StreamHub `ActivePipeline` / `BatchTransferCard`: show queue position, pause/resume buttons,
  move up/down (maps to priority), concurrency selector (1–8), "Clear finished".

## Acceptance
1. Enqueue 6 with `max_concurrent=2`: exactly 2 are `Downloading`, and the rest stay `Queued` in FIFO order.
2. Cancel a queued task: it never spawns a process.
3. Pause mid-download, then resume: the download continues from the partial file instead of starting over from 0%.
4. Kill network on a running task: it retries twice with backoff, then goes to `Failed`.
5. Restart the app with 3 pending: all 3 are restored, and `queue.json` has no cookie data.
6. Raising `max_concurrent` 2→4 starts 2 more tasks right away.
7. `cargo test` (default features) passes. Add unit tests for ordering, the retry classifier, and
   persistence round-trip. `npm test` and `npm run lint` pass.
