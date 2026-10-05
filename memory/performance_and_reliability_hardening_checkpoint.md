# Performance & Reliability Hardening Architecture Checkpoint

**Date:** 2026-10-05  
**Active Branch:** `main`  
**Origin Remote:** `https://github.com/revenchedarnob-wq/hyper-stream.git`  

---

## 1. System Engineering Implementations (5-Phase Execution)

### Phase 1: Universal Windows File-Lock Armor (`crate::utils::fs`)
- **Root Cause Eliminated:** Windows Defender, Search Indexer, and Explorer thumbnail cache acquiring synchronous handles without `FILE_SHARE_DELETE`, triggering OS Error 32 (`ERROR_SHARING_VIOLATION`), OS Error 33 (`ERROR_LOCK_VIOLATION`), and OS Error 5 (`ERROR_ACCESS_DENIED`).
- **Implementation (`src-tauri/src/utils/fs.rs`):**
  - `resilient_rename` & `resilient_rename_async`: Exponential backoff with pseudo-random jitter (12 attempts over $\sim 3\text{ seconds}$). Automatically handles destination conflicts on Windows.
  - `resilient_remove` & `resilient_remove_async`: Retries file deletion through sharing violations and treats `NotFound` as clean `Ok(())`.
  - Integrated across all file persistence and extraction boundaries:
    - `src-tauri/src/downloader/binary_manager.rs` (yt-dlp binary staging and unpack)
    - `src-tauri/src/downloader/queue.rs` (transactional queue file finalize)
    - `src-tauri/src/downloader/library.rs` (library database save & thumbnail cleanup)
    - `src-tauri/src/downloader/orchestrator.rs` (partial cleanup & remux finalize)
    - `src-tauri/src/downloader/ytdlp_worker.rs` (plugin installation)

### Phase 2: WebView2 Deep Suspension (`put_is_suspended`)
- **Root Cause Eliminated:** Hidden browser view retaining Chromium timers, script loops, and full DOM working set ($\sim 150\text{ MB}$ RAM) while user interacts with Stream Hub or Media Library.
- **Implementation (`src-tauri/src/browser/native.rs` & `src-tauri/src/browser/mod.rs`):**
  - When browser visibility is `false`:
    - Calls `ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW)`.
    - Calls `ICoreWebView2_3::TrySuspend()`.
    - Invokes `EmptyWorkingSet(GetCurrentProcess())` to flush physical working sets to the page file.
  - When browser visibility is `true`:
    - Calls `ICoreWebView2_3::Resume()`.
    - Calls `ICoreWebView2_19::SetMemoryUsageTargetLevel(NORMAL)`.
    - Resumes within $<15\text{ ms}$ without page reload or state loss.

### Phase 3: Batched 10 Hz IPC Dispatch Heartbeat
- **Root Cause Eliminated:** 5 active transfers producing up to $25\text{ events/sec}$ across Tauri FFI, causing high serialization CPU usage and React reconciliation jank.
- **Implementation (`src-tauri/src/downloader/orchestrator.rs` & `src/components/stream-hub/StreamHub.tsx`):**
  - Background `start_progress_heartbeat()` spawns a synchronized 10 Hz ticker (`tokio::time::interval(100ms)`).
  - Emits a single consolidated payload: `download-batch-progress`.
  - Frontend performs delta checking in `batchUpsert` with a single state dispatch, cutting IPC CPU by $\sim 70\%$.

### Phase 4: Dynamic Work-Stealing Multi-Segment Turbo Engine
- **Root Cause Eliminated:** Static range slicing causing tail-latency stalls when one CDN connection is throttled or high-latency.
- **Implementation (`src-tauri/src/downloader/turbo.rs`):**
  - Dynamic `straggler_score()` computes byte throughput and stall duration per connection.
  - Idle connections dynamically steal remaining bytes from the slowest straggler (splitting ranges $>16\text{ MB}$ on 64 KiB boundaries).
  - Verified with comprehensive multithreaded test: `work_stealing_splits_slow_straggler_range`.

### Phase 5: Sleep/Wake Power State Socket Recovery
- **Root Cause Eliminated:** Windows Modern Standby / Sleep severing TCP sockets, leaving downloads trapped in 90-second TCP timeout retransmit stalls on wake.
- **Implementation (`src-tauri/src/utils/power.rs` & `src-tauri/src/lib.rs`):**
  - Subclasses main Win32 `HWND` via `SetWindowSubclass` to intercept `WM_POWERBROADCAST`.
  - On `PBT_APMSUSPEND` (0x0004): emits `system-power-suspend` to flush dirty buffers and pause sockets cleanly.
  - On `PBT_APMRESUMEAUTOMATIC` (0x0012) / `PBT_APMRESUMESUSPEND` (0x0007): emits `system-power-resume` to immediately trigger reconnects with fresh Range headers.

---

## 2. Empirical Verification Matrix

| Test Suite | Scope | Result | Execution Time |
| :--- | :--- | :--- | :--- |
| **Rust Unit Tests** | 96 tests (including `utils::fs`, `utils::power`, `turbo::work_stealing`) | **91 passed, 0 failed** (5 bench ignored) | 12.34s |
| **Frontend Unit Tests** | 18 test files across components, utils, and zero-idle engine | **124 passed, 0 failed** | 3.35s |
| **TypeScript Strict Checking** | Whole repository (`tsconfig.app.json`) | **0 errors** | 4.9s |
| **Release Build** | MSVC optimized `HyperStream.exe` (`--no-bundle`) | **Built successfully** | 4m 12s |
| **Performance Smoke Audit** | Live execution against `HyperStream.exe` | **All budgets met** | 2.1s |

---

## 3. Empirical Hardware Performance Benchmark (`scripts/perf-smoke.mjs`)

| Metric | Target Budget | Measured Value | Status |
| :--- | :--- | :--- | :--- |
| **Binary Size (`HyperStream.exe`)** | $\le 12.0\text{ MB}$ | **11.1 MB** (11,624,448 B) | **PASS** |
| **Main JS Bundle** | $\le 340\text{ KB}$ | **283 KB** | **PASS** |
| **Startup CSS** | $\le 110\text{ KB}$ | **94 KB** | **PASS** |
| **Cold First Paint** | $\le 900\text{ ms}$ | **248 ms** | **PASS** |
| **Screens Blank while Unfocused** | 0 | **0** | **PASS** |
| **GPU Layers at Idle** | $\le 2$ | **2** | **PASS** |
| **GPU Layer Area / Window** | $\le 1.1\times$ | **$1.0\times$** | **PASS** |
| **Idle CPU Load (% of single core)** | $\le 1.5\%$ | **0.47%** | **PASS** |
| **Running Animations at Idle** | 0 | **0** | **PASS** |
