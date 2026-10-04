//! yt-dlp kept running between uses.
//!
//! Starting yt-dlp costs about half a second (several on slow PCs with hard drives), and a
//! download used to start it two or three times. A small plugin next to HyperStream's own
//! yt-dlp turns one copy into a worker that runs command lines sent to it, one at a time,
//! with the same results as separate runs. Idle workers exit after a minute and a half.
//!
//! Anything unusual (no managed yt-dlp, the plugin not loading, a worker dying) returns
//! `None`, and callers start yt-dlp the usual way.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use crate::downloader::BinaryManager;

const PLUGIN: &str = include_str!("ytdlp_worker_plugin.py");
const PLUGIN_PATH: [&str; 4] = ["yt-dlp-plugins", "hyperstream", "yt_dlp_plugins", "extractor"];
const PLUGIN_FILE: &str = "hyperstream_worker.py";
/// Slow disks can take a while to load yt-dlp the first time.
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE_FOR: Duration = Duration::from_secs(90);
/// A fresh worker now and then keeps memory from creeping up.
const MAX_USES: u32 = 100;

/// One piece of a command's output.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Out(String),
    Err(String),
    /// The command finished with this exit code.
    Exit(i32),
}

enum Message {
    Ready,
    Event(Event),
    /// The worker's output closed: it exited or was stopped.
    Closed,
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    messages: mpsc::UnboundedReceiver<Message>,
    uses: u32,
}

impl Worker {
    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Ends an idle worker (nothing of its own is running).
    fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// Ends a worker in the middle of a command, with whatever the command started (FFmpeg).
    fn stop_tree(mut self) {
        BinaryManager::kill_process_tree(self.pid());
        let _ = self.child.wait();
    }
}

static IDLE: Mutex<Vec<(Worker, Instant)>> = Mutex::new(Vec::new());
static REAPER: AtomicBool = AtomicBool::new(false);
/// Workers that failed to start; after two, this session runs yt-dlp the usual way.
static FAILED_STARTS: AtomicU32 = AtomicU32::new(0);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
/// Set while yt-dlp is being replaced: no new workers start from the old copy.
static PAUSED: AtomicBool = AtomicBool::new(false);

fn disabled() -> bool {
    PAUSED.load(Ordering::Relaxed)
        || FAILED_STARTS.load(Ordering::Relaxed) >= 2
        || std::env::var("HYPERSTREAM_YTDLP_WORKER").is_ok_and(|v| v == "0")
}

/// Writes the plugin next to `exe` (HyperStream's own yt-dlp) unless it's already there.
fn ensure_plugin(exe: &Path) -> std::io::Result<()> {
    let mut dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    for part in PLUGIN_PATH {
        dir.push(part);
    }
    let file = dir.join(PLUGIN_FILE);
    if std::fs::read(&file).is_ok_and(|current| current == PLUGIN.as_bytes()) {
        return Ok(());
    }
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!("{}.tmp", PLUGIN_FILE));
    std::fs::write(&tmp, PLUGIN)?;
    std::fs::rename(&tmp, &file)
}

/// HyperStream's own yt-dlp, the only copy a plugin can be added to.
fn managed_exe() -> Option<PathBuf> {
    let exe = BinaryManager::ytdlp_dir().join("yt-dlp.exe");
    (exe.is_file() && BinaryManager::find_binary("yt-dlp").as_deref() == Some(exe.as_path())).then_some(exe)
}

async fn spawn() -> Option<Worker> {
    let exe = managed_exe()?;
    if let Err(e) = ensure_plugin(&exe) {
        log::warn!("yt-dlp worker: couldn't add the plugin: {}", e);
        return None;
    }
    let mut cmd = BinaryManager::create_command("yt-dlp").ok()?;
    BinaryManager::apply_utf8_env(&mut cmd);
    cmd.args(["--ignore-config", "--no-warnings", "--quiet", "hyperstream-worker:serve"]);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().ok()?;
    let (stdin, stdout, stderr) = (child.stdin.take()?, child.stdout.take()?, child.stderr.take()?);

    let (tx, mut messages) = mpsc::unbounded_channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).is_ok_and(|n| n > 0) {
            if let Some(message) = parse(&buf) {
                if tx.send(message).is_err() {
                    break;
                }
            }
            buf.clear();
        }
        let _ = tx.send(Message::Closed);
    });
    // Nothing should arrive here; drain it so a chatty failure can't block the worker.
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).is_ok_and(|n| n > 0) {
            log::debug!("yt-dlp worker: {}", line.trim_end());
            line.clear();
        }
    });

    let started = Instant::now();
    match tokio::time::timeout(READY_TIMEOUT, messages.recv()).await {
        Ok(Some(Message::Ready)) => {
            log::info!("yt-dlp worker ready in {} ms", started.elapsed().as_millis());
            FAILED_STARTS.store(0, Ordering::Relaxed);
            Some(Worker { child, stdin, messages, uses: 0 })
        }
        _ => {
            log::warn!("yt-dlp worker didn't start; running yt-dlp separately");
            FAILED_STARTS.fetch_add(1, Ordering::Relaxed);
            Worker { child, stdin, messages, uses: 0 }.stop();
            None
        }
    }
}

fn parse(line: &[u8]) -> Option<Message> {
    let v: serde_json::Value = serde_json::from_slice(line).ok()?;
    let text = |key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    if v.get("ready").is_some() {
        Some(Message::Ready)
    } else if let Some(line) = text("o") {
        Some(Message::Event(Event::Out(line)))
    } else if let Some(line) = text("e") {
        Some(Message::Event(Event::Err(line)))
    } else {
        v.get("exit").and_then(|c| c.as_i64()).map(|c| Message::Event(Event::Exit(c as i32)))
    }
}

fn take_idle() -> Option<Worker> {
    let mut idle = IDLE.lock().unwrap();
    while let Some((mut worker, _)) = idle.pop() {
        if worker.alive() {
            return Some(worker);
        }
    }
    None
}

fn give_back(mut worker: Worker) {
    let keep = if crate::browser::is_low_memory_pc() { 1 } else { 2 };
    if PAUSED.load(Ordering::Relaxed) || worker.uses >= MAX_USES || !worker.alive() {
        return worker.stop();
    }
    {
        let mut idle = IDLE.lock().unwrap();
        if idle.len() >= keep {
            drop(idle);
            return worker.stop();
        }
        idle.push((worker, Instant::now()));
    }
    if !REAPER.swap(true, Ordering::AcqRel) {
        std::thread::Builder::new().name("ytdlp-reaper".into()).spawn(reap).ok();
    }
}

/// Stops workers nobody used for a while; ends when none are left.
fn reap() {
    loop {
        std::thread::sleep(Duration::from_secs(15));
        let (expired, none_left) = {
            let mut idle = IDLE.lock().unwrap();
            let (old, fresh): (Vec<_>, Vec<_>) = idle.drain(..).partition(|(_, since)| since.elapsed() >= IDLE_FOR);
            *idle = fresh;
            let none_left = idle.is_empty();
            if none_left {
                // A worker given back from now on starts a new reaper.
                REAPER.store(false, Ordering::Release);
            }
            (old, none_left)
        };
        for (worker, _) in expired {
            worker.stop();
        }
        if none_left {
            return;
        }
    }
}

/// Stops idle workers and starts no new ones until `resume` (yt-dlp is being replaced, and
/// Windows won't replace a folder a running program uses).
pub fn pause() {
    PAUSED.store(true, Ordering::Relaxed);
    let idle: Vec<Worker> = IDLE.lock().unwrap().drain(..).map(|(w, _)| w).collect();
    for worker in idle {
        worker.stop();
    }
}

pub fn resume() {
    PAUSED.store(false, Ordering::Relaxed);
}

/// A command running in a worker.
pub struct Running {
    worker: Option<Worker>,
    pid: u32,
    finished: bool,
}

/// Runs yt-dlp with `args` in a worker. `None`: no worker available, start yt-dlp yourself.
pub async fn start(args: &[OsString]) -> Option<Running> {
    if disabled() {
        return None;
    }
    // Paths that aren't valid Unicode can't travel as JSON: the usual way handles them.
    let args: Vec<&str> = args.iter().map(|a| a.to_str()).collect::<Option<_>>()?;
    let mut worker = match take_idle() {
        Some(w) => w,
        None => spawn().await?,
    };
    let request = serde_json::json!({ "id": NEXT_ID.fetch_add(1, Ordering::Relaxed), "args": args });
    let mut line = request.to_string().into_bytes();
    line.push(b'\n');
    if worker.stdin.write_all(&line).and_then(|_| worker.stdin.flush()).is_err() {
        worker.stop();
        return None;
    }
    worker.uses += 1;
    let pid = worker.pid();
    Some(Running { worker: Some(worker), pid, finished: false })
}

impl Running {
    /// The worker's process, for stopping it (with whatever it started) on cancel.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The next piece of output, ending with `Event::Exit`. `None` after that, or when the
    /// worker died before the command finished.
    pub async fn next(&mut self) -> Option<Event> {
        if self.finished {
            return None;
        }
        let worker = self.worker.as_mut()?;
        loop {
            match worker.messages.recv().await {
                Some(Message::Event(Event::Exit(code))) => {
                    self.finished = true;
                    return Some(Event::Exit(code));
                }
                Some(Message::Event(event)) => return Some(event),
                Some(Message::Ready) => continue,
                Some(Message::Closed) | None => return None,
            }
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let Some(worker) = self.worker.take() else { return };
        if self.finished {
            give_back(worker);
        } else {
            // Stopped midway (cancelled) or broken: it can't take another command.
            std::thread::spawn(move || worker.stop_tree());
        }
    }
}

/// What a finished command printed.
#[derive(Debug, Default)]
pub struct Captured {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a short command to the end in a worker (`None`: start yt-dlp yourself). A worker that
/// dies midway also gives `None`, so the command runs again the usual way.
pub async fn capture(args: &[OsString], timeout: Duration) -> Option<Result<Captured, ()>> {
    let mut running = start(args).await?;
    let pid = running.pid();
    let collect = async move {
        let mut out = Captured::default();
        while let Some(event) = running.next().await {
            match event {
                Event::Out(line) => {
                    out.stdout.push_str(&line);
                    out.stdout.push('\n');
                }
                Event::Err(line) => {
                    out.stderr.push_str(&line);
                    out.stderr.push('\n');
                }
                Event::Exit(code) => {
                    out.code = code;
                    return Some(out);
                }
            }
        }
        None
    };
    match tokio::time::timeout(timeout, collect).await {
        Ok(Some(out)) => Some(Ok(out)),
        Ok(None) => None,
        Err(_) => {
            BinaryManager::kill_process_tree(pid);
            Some(Err(()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Needs HyperStream's own yt-dlp installed: cargo test --lib ytdlp_worker -- --ignored
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn worker_runs_commands_like_the_command_line() {
        let version: Vec<OsString> = vec!["--version".into()];
        let first = capture(&version, Duration::from_secs(60)).await.expect("worker").unwrap();
        assert_eq!(first.code, 0);
        let started = Instant::now();
        let second = capture(&version, Duration::from_secs(60)).await.expect("worker").unwrap();
        println!("warm command: {} ms", started.elapsed().as_millis());
        assert_eq!(first.stdout, second.stdout);
        assert!(started.elapsed() < Duration::from_millis(300));

        let bad = capture(&["--no-such-option".into()], Duration::from_secs(60)).await.expect("worker").unwrap();
        assert_ne!(bad.code, 0);
        assert!(bad.stderr.contains("no such option"), "{}", bad.stderr);
        // Still usable after an error.
        assert_eq!(capture(&version, Duration::from_secs(60)).await.expect("worker").unwrap().code, 0);
        pause();
        resume();
    }
}
