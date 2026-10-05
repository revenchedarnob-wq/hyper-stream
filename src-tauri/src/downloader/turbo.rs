//! Multi-connection downloader for direct media and file links.
//!
//! Many servers cap the speed of each connection, so one file is fetched over several
//! connections at once. A connection that runs out of work takes half of the biggest
//! unfinished range (no idle connections near the end), and connections are added in
//! steps for as long as each step still raises the total speed.
//!
//! Lost connections are waited out: the data stays on disk and the download continues once
//! the network is back. Anything this engine can't handle (no range support, odd answers)
//! comes back as `TurboError::Fallback` so the caller can use the regular downloader.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE};

use crate::downloader::bandwidth;

/// Bytes collected per connection before they are written to disk.
const WRITE_BUFFER: usize = 512 * 1024;
/// A range is only split when both halves get at least this much.
const MIN_SPLIT: u64 = 1024 * 1024;
/// No answer or no data for this long: the connection is dead (an outage, a sleeping PC).
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(if cfg!(test) { 2 } else { 20 });
/// Consecutive failures of one range before stopping for now.
pub(crate) const MAX_FAILURES: u32 = 6;
/// With the network up but no new data for this long, stop for now (progress is kept).
pub(crate) const STALL_LIMIT: Duration = Duration::from_secs(30);
/// Without a connection, keep trying this long before stopping for now (progress is kept).
pub(crate) const OFFLINE_LIMIT: Duration = Duration::from_secs(if cfg!(test) { 6 } else { 10 * 60 });
/// How often connections try again while the network is down.
pub(crate) const OFFLINE_RETRY: Duration = Duration::from_secs(if cfg!(test) { 1 } else { 2 });
/// Other connections got data this recently: the network is up, so a failed connection
/// means the server wants fewer of them.
const FLOWING_WINDOW: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone)]
pub struct Stream {
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// Size reported by the site, if any. The first request confirms it either way.
    pub size: Option<u64>,
    pub dest: PathBuf,
    /// Largest range a single request may ask for. YouTube serves larger requests at a crawl.
    pub max_request: Option<u64>,
    /// Streamed video: the file is put together from these pieces (see `segments`).
    pub pieces: Option<crate::downloader::segments::Pieces>,
}

#[derive(Debug, PartialEq)]
pub enum TurboError {
    /// Paused or cancelled; partial data and resume state are kept.
    Aborted,
    /// Temporary trouble (no connection, server errors). Partial data and resume state are
    /// kept, so trying again later continues where this stopped.
    Interrupted(String),
    /// The server no longer accepts the link (it expired). Fresh links continue the download.
    Expired(String),
    /// This engine can't do it; use the regular downloader.
    Fallback(String),
}

/// Live counters for progress reporting.
#[derive(Debug, Default)]
pub struct Meter {
    pub done: AtomicU64,
    pub total: AtomicU64,
    pub connections: AtomicUsize,
    /// The server refused or rate-limited connections.
    pub pushback: AtomicBool,
    /// Connections in use once the speed stopped improving (0: never settled).
    pub settled: AtomicUsize,
    /// The network is down; connections are waiting for it.
    pub waiting: AtomicBool,
    /// Other downloads from the same site (or too many downloads) held this one back, so
    /// its connection count says nothing about the site.
    pub shared: AtomicBool,
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub start: usize,
    pub max: usize,
}

impl Limits {
    pub fn for_this_pc(low_memory: bool) -> Self {
        // Servers and firewalls start refusing (or banning) clients that open dozens of
        // connections; 16 is already twice what other download managers use by default.
        if low_memory { Limits { start: 4, max: 8 } } else { Limits { start: 8, max: 16 } }
    }
}

/// What worked on a site before, so the next download starts there instead of ramping up
/// again, and never goes above what the server accepted.
#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
struct SiteRecord {
    /// Connections that gave the best speed.
    good: usize,
    /// Most connections the server tolerated, when it pushed back.
    cap: Option<usize>,
    /// Unix seconds.
    at: u64,
}

const SITE_RECORD_DAYS: u64 = 14;

/// "rr3---sn-abc.googlevideo.com" -> "googlevideo.com"; "http://10.0.0.5:8080/x" -> "10.0.0.5:8080"
pub(crate) fn site_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let raw_host = parsed.host_str()?;
    if raw_host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok() {
        return Some(format!("{}:{}", raw_host, parsed.port_or_known_default()?));
    }
    let host = parsed.host_str()?.to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    let keep = if labels.len() >= 3 && labels[labels.len() - 1].len() == 2 && labels[labels.len() - 2].len() <= 3 { 3 } else { 2 };
    Some(labels[labels.len().saturating_sub(keep)..].join("."))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn read_records(file: &Path) -> std::collections::HashMap<String, SiteRecord> {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// `base`, adjusted by what this site did last time (`file` holds the records).
pub fn limits_for(base: Limits, url: &str, file: &Path) -> Limits {
    let Some(site) = site_of(url) else { return base };
    let Some(record) = read_records(file).get(&site).copied() else { return base };
    if now_secs().saturating_sub(record.at) > SITE_RECORD_DAYS * 86_400 {
        return base;
    }
    let max = record.cap.map_or(base.max, |cap| cap.clamp(1, base.max));
    let start = if record.good > 0 { record.good.min(max) } else { base.start.min(max) };
    Limits { start: start.max(1), max }
}

/// Saves what this download learned about the site.
pub fn remember_site(url: &str, meter: &Meter, file: &Path) {
    let Some(site) = site_of(url) else { return };
    let pushback = meter.pushback.load(Ordering::Relaxed);
    let settled = meter.settled.load(Ordering::Relaxed);
    if (!pushback && settled == 0) || meter.shared.load(Ordering::Relaxed) {
        return; // too short to learn anything, or held back by other downloads
    }
    let mut records = read_records(file);
    let previous = records.get(&site).copied().unwrap_or_default();
    let in_use = meter.connections.load(Ordering::Relaxed).max(1);
    let record = SiteRecord {
        good: if settled > 0 { settled } else { previous.good.min(in_use) },
        cap: if pushback { Some(in_use) } else { previous.cap },
        at: now_secs(),
    };
    records.insert(site, record);
    // Keep the file small: drop records nobody has used in a while.
    records.retain(|_, r| now_secs().saturating_sub(r.at) <= SITE_RECORD_DAYS * 86_400);
    if let Ok(json) = serde_json::to_vec(&records) {
        let _ = std::fs::write(file, json);
    }
}

/// Downloads running right now and their sites, so parallel downloads share connections:
/// downloads from one site split that site's limit (sites ban visitors who open too many),
/// and all of them together stay under twice the limit.
static RUNNING: Mutex<Vec<(u64, Option<String>)>> = Mutex::new(Vec::new());
static NEXT_JOB: AtomicU64 = AtomicU64::new(1);

pub(crate) struct Registration(u64);

impl Registration {
    pub(crate) fn new(site: Option<String>) -> Self {
        let id = NEXT_JOB.fetch_add(1, Ordering::Relaxed);
        RUNNING.lock().unwrap().push((id, site));
        Registration(id)
    }

    /// Connections this download may use while the others keep theirs.
    pub(crate) fn fair_share(&self, max: usize) -> usize {
        let running = RUNNING.lock().unwrap();
        let site = running.iter().find(|(id, _)| *id == self.0).and_then(|(_, s)| s.clone());
        let same_site = running.iter().filter(|(_, s)| site.is_some() && *s == site).count();
        // Tests run side by side in one process: there, only downloads from one site share.
        let all = if cfg!(test) { same_site } else { running.len() };
        fair_share(max, same_site, all)
    }
}

/// Connections for one of `all` downloads, `same_site` of them from its site.
fn fair_share(max: usize, same_site: usize, all: usize) -> usize {
    (max / same_site.max(1)).min(max * 2 / all.max(1)).clamp(1, max.max(1))
}

impl Drop for Registration {
    fn drop(&mut self) {
        RUNNING.lock().unwrap().retain(|(id, _)| *id != self.0);
    }
}

fn is_locked(e: &std::io::Error) -> bool {
    // 32/33: another program (often antivirus scanning the new file) has it open.
    e.kind() == std::io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(32 | 33))
}

/// Renames `from` to `to`, waiting a few seconds if another program briefly holds the file.
pub async fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut wait = Duration::from_millis(100);
    for _ in 0..12 {
        match std::fs::rename(from, to) {
            Err(e) if is_locked(&e) => {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(Duration::from_secs(1));
            }
            other => return other,
        }
    }
    std::fs::rename(from, to)
}

/// Where the data goes while downloading, and its resume record.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".hspart");
    PathBuf::from(s)
}

pub(crate) fn state_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".hspart.json");
    PathBuf::from(s)
}

/// Removes partial data for `dest` (used on cancel).
pub fn remove_partial(dest: &Path) {
    let _ = std::fs::remove_file(part_path(dest));
    let _ = std::fs::remove_file(state_path(dest));
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ResumeState {
    size: u64,
    /// Unfinished ranges as [next byte, end) pairs.
    ranges: Vec<(u64, u64)>,
    /// The server's version of the file (ETag or Last-Modified). A different one means the
    /// file changed while paused: the kept bytes no longer fit and it starts over.
    #[serde(default)]
    validator: Option<String>,
}

struct OpenStream {
    url: String,
    headers: HeaderMap,
    size: u64,
    validator: Option<String>,
    max_request: u64,
    file: Arc<std::fs::File>,
    dest: PathBuf,
}

#[derive(Debug)]
struct Range {
    stream: usize,
    /// Next byte to fetch; only moves forward once the bytes are written.
    pos: AtomicU64,
    /// Exclusive end; shrinks when another connection takes the back half.
    end: AtomicU64,
    busy: AtomicBool,
}

impl Range {
    fn new(stream: usize, pos: u64, end: u64, busy: bool) -> Arc<Range> {
        Arc::new(Range { stream, pos: AtomicU64::new(pos), end: AtomicU64::new(end), busy: AtomicBool::new(busy) })
    }
    fn remaining(&self) -> u64 {
        self.end.load(Ordering::Acquire).saturating_sub(self.pos.load(Ordering::Acquire))
    }
}

/// Why a download stopped before the end.
enum Stop {
    Fallback(String),
    Interrupted(String),
    Expired(String),
}

struct Job {
    client: reqwest::Client,
    streams: Vec<OpenStream>,
    ranges: Mutex<Vec<Arc<Range>>>,
    meter: Arc<Meter>,
    cancel: Arc<AtomicBool>,
    stop: Mutex<Option<Stop>>,
    active: AtomicUsize,
    /// Connections wanted right now; lowered when the server pushes back.
    target: AtomicUsize,
    started: Instant,
    /// Milliseconds after `started` when data last arrived (`u64::MAX`: none yet).
    last_data_ms: AtomicU64,
    /// When connections started failing for lack of a network.
    offline_since: Mutex<Option<Instant>>,
}

enum Attempt {
    /// Some bytes arrived (the range may or may not be finished).
    Progress,
    /// This connection left mid-range because fewer are wanted (already counted out).
    Retired,
    /// Nothing arrived; worth retrying.
    Retry(String),
    /// The server is overloaded or rate limiting.
    Busy,
    /// No network: wait for it, without counting it as a failure.
    Offline,
    /// The server no longer accepts the link.
    Expired(String),
    /// Retrying won't help.
    Fatal(String),
}

pub(crate) fn client() -> Result<reqwest::Client, String> {
    // HTTP/1.1 only: HTTP/2 would squeeze every connection into one, which is exactly
    // what per-connection speed caps punish.
    reqwest::Client::builder()
        .http1_only()
        .pool_max_idle_per_host(64)
        .connect_timeout(Duration::from_secs(15))
        .tcp_nodelay(true)
        .build()
        .map_err(|e| e.to_string())
}

pub(crate) fn header_map(pairs: &[(String, String)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (k, v) in pairs {
        if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
            map.insert(name, value);
        }
    }
    // Ranges must refer to the bytes as stored, never to a compressed copy.
    map.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    map
}

/// "bytes 0-0/12345" -> 12345
fn total_from_content_range(value: &str) -> Option<u64> {
    value.rsplit('/').next()?.trim().parse().ok()
}

/// "bytes 500-999/12345" -> 500
fn start_from_content_range(value: &str) -> Option<u64> {
    value.trim().strip_prefix("bytes")?.trim().split('-').next()?.trim().parse().ok()
}

pub(crate) fn is_expired_status(status: u16) -> bool {
    matches!(status, 401 | 403 | 404 | 410)
}

/// Server trouble that usually passes.
pub(crate) fn is_temporary_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 500..=599)
}

#[cfg(windows)]
pub(crate) fn write_at(file: &std::fs::File, mut offset: u64, mut data: &[u8]) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !data.is_empty() {
        let n = file.seek_write(data, offset)?;
        if n == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "disk write failed"));
        }
        data = &data[n..];
        offset += n as u64;
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn write_at(file: &std::fs::File, offset: u64, data: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(data, offset)
}

/// What the first request learned: final address, size, and the file's version.
struct Probed {
    url: String,
    size: u64,
    validator: Option<String>,
}

/// A strong ETag, or else Last-Modified: both work with If-Range.
fn validator_of(headers: &HeaderMap) -> Option<String> {
    let etag = headers.get(ETAG).and_then(|v| v.to_str().ok()).filter(|e| !e.starts_with("W/"));
    etag.or_else(|| headers.get(LAST_MODIFIED).and_then(|v| v.to_str().ok())).map(str::to_string)
}

/// Why a request got no answer.
#[derive(Debug, PartialEq)]
pub(crate) enum SendFailure {
    /// The server turned the connection away: it is reachable but wants fewer connections.
    Refused,
    /// No route, no name lookup, no answer: the network is down.
    Unreachable,
    /// Reset or closed: either of the above.
    Unclear,
}

pub(crate) fn send_failure(e: &reqwest::Error) -> SendFailure {
    if e.is_timeout() {
        return SendFailure::Unreachable;
    }
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(err) = source {
        if let Some(io) = err.downcast_ref::<std::io::Error>() {
            use std::io::ErrorKind::*;
            match io.kind() {
                ConnectionRefused => return SendFailure::Refused,
                NetworkUnreachable | HostUnreachable | NetworkDown | AddrNotAvailable | TimedOut => return SendFailure::Unreachable,
                _ => {}
            }
        }
        if err.to_string().contains("dns error") {
            return SendFailure::Unreachable;
        }
        source = err.source();
    }
    SendFailure::Unclear
}

/// Sleeps up to `d`, waking early when the download is paused.
pub(crate) async fn nap(cancel: &AtomicBool, d: Duration) {
    let until = Instant::now() + d;
    while !cancel.load(Ordering::Relaxed) {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        tokio::time::sleep(left.min(Duration::from_millis(250))).await;
    }
}

/// Asks for the first byte: confirms range support, the real size and the final URL.
/// Without a network it waits for one (`meter.waiting`), up to `OFFLINE_LIMIT`.
async fn probe(client: &reqwest::Client, stream: &Stream, headers: &HeaderMap, meter: &Meter, cancel: &AtomicBool) -> Result<Probed, TurboError> {
    let started = Instant::now();
    let mut errors = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(TurboError::Aborted);
        }
        let request = client.get(&stream.url).headers(headers.clone()).header(RANGE, "bytes=0-0").send();
        let failure = match tokio::time::timeout(READ_TIMEOUT, request).await {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(e)) => Err((send_failure(&e), e.to_string())),
            Err(_) => Err((SendFailure::Unreachable, "no answer".to_string())),
        };
        let response = match failure {
            Ok(r) => r,
            Err((SendFailure::Refused, reason)) => {
                errors += 1;
                if errors >= 4 {
                    return Err(TurboError::Interrupted(format!("server refused the connection: {}", reason)));
                }
                nap(cancel, Duration::from_millis(500 * errors)).await;
                continue;
            }
            Err((_, reason)) => {
                if started.elapsed() > OFFLINE_LIMIT {
                    return Err(TurboError::Interrupted(format!("couldn't reach the server: {}", reason)));
                }
                meter.waiting.store(true, Ordering::Relaxed);
                nap(cancel, OFFLINE_RETRY).await;
                continue;
            }
        };
        meter.waiting.store(false, Ordering::Relaxed);
        let status = response.status().as_u16();
        match status {
            206 => {
                let total = response
                    .headers()
                    .get(CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(total_from_content_range)
                    .filter(|&t| t > 0);
                let Some(total) = total else {
                    return Err(TurboError::Fallback("size unknown".into()));
                };
                return Ok(Probed { url: response.url().to_string(), size: total, validator: validator_of(response.headers()) });
            }
            200 => return Err(TurboError::Fallback("server doesn't support ranges".into())),
            s if is_expired_status(s) => return Err(TurboError::Expired(format!("link refused ({})", s))),
            s if is_temporary_status(s) => {
                errors += 1;
                if errors >= 4 {
                    return Err(TurboError::Interrupted(format!("server error (HTTP {})", s)));
                }
                nap(cancel, Duration::from_millis(500 * errors)).await;
            }
            s => return Err(TurboError::Fallback(format!("HTTP {}", s))),
        }
    }
}

fn load_resume(dest: &Path, size: u64, validator: Option<&str>) -> Option<Vec<(u64, u64)>> {
    let part = part_path(dest);
    if std::fs::metadata(&part).ok()?.len() != size {
        return None;
    }
    let state: ResumeState = serde_json::from_slice(&std::fs::read(state_path(dest)).ok()?).ok()?;
    if state.size != size || state.ranges.iter().any(|&(a, b)| a > b || b > size) {
        return None;
    }
    if state.validator.is_some() && state.validator.as_deref() != validator {
        log::info!("turbo: {} changed on the server, starting over", dest.display());
        return None;
    }
    Some(state.ranges)
}

impl Job {
    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::Relaxed) || self.stop.lock().unwrap().is_some()
    }

    fn stop_with(&self, reason: Stop) {
        self.stop.lock().unwrap().get_or_insert(reason);
    }

    fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    /// Another connection got data moments ago, so the network itself is fine.
    fn flowing(&self) -> bool {
        let last = self.last_data_ms.load(Ordering::Relaxed);
        last != u64::MAX && self.elapsed_ms().saturating_sub(last) < FLOWING_WINDOW.as_millis() as u64
    }

    fn went_offline(&self) {
        self.offline_since.lock().unwrap().get_or_insert_with(Instant::now);
        self.meter.waiting.store(true, Ordering::Relaxed);
    }

    /// A failed request: no network at all, or (while others still get data) this one only.
    fn network_failure(&self, busy: bool, reason: String) -> Attempt {
        match (self.flowing(), busy) {
            (false, _) => Attempt::Offline,
            (true, true) => Attempt::Busy,
            (true, false) => Attempt::Retry(reason),
        }
    }

    /// An unclaimed range, or the back half of the largest busy one.
    fn claim(&self) -> Option<Arc<Range>> {
        let mut ranges = self.ranges.lock().unwrap();
        if let Some(r) = ranges.iter().find(|r| !r.busy.load(Ordering::Acquire) && r.remaining() > 0) {
            r.busy.store(true, Ordering::Release);
            return Some(r.clone());
        }
        let victim = ranges.iter().filter(|r| r.busy.load(Ordering::Acquire)).max_by_key(|r| r.remaining())?.clone();
        let (pos, end) = (victim.pos.load(Ordering::Acquire), victim.end.load(Ordering::Acquire));
        if end.saturating_sub(pos) < 2 * MIN_SPLIT {
            return None;
        }
        // Split on a 64 KiB boundary. If the owner is already past `mid` when it notices,
        // the overlap is simply fetched twice: the bytes are identical.
        let mid = (pos + (end - pos) / 2 + 0xFFFF) & !0xFFFF;
        if mid <= pos || mid >= end {
            return None;
        }
        victim.end.store(mid, Ordering::Release);
        let taken = Range::new(victim.stream, mid, end, true);
        ranges.push(taken.clone());
        Some(taken)
    }

    /// Leaves when there is no work left, or when there are more connections than wanted.
    fn should_retire(&self) -> bool {
        let target = self.target.load(Ordering::Relaxed).max(1);
        let mut active = self.active.load(Ordering::Relaxed);
        while active > target {
            match self.active.compare_exchange(active, active - 1, Ordering::AcqRel, Ordering::Relaxed) {
                Ok(_) => return true,
                Err(now) => active = now,
            }
        }
        false
    }

    fn has_free_work(&self) -> bool {
        self.ranges.lock().unwrap().iter().any(|r| !r.busy.load(Ordering::Acquire) && r.remaining() > 0)
    }

    fn snapshot(&self) -> Vec<Vec<(u64, u64)>> {
        let mut per_stream = vec![Vec::new(); self.streams.len()];
        for r in self.ranges.lock().unwrap().iter() {
            let (pos, end) = (r.pos.load(Ordering::Acquire), r.end.load(Ordering::Acquire));
            if pos < end {
                per_stream[r.stream].push((pos, end));
            }
        }
        per_stream
    }

    fn save_state(&self) {
        for (i, ranges) in self.snapshot().into_iter().enumerate() {
            let s = &self.streams[i];
            let path = state_path(&s.dest);
            let Ok(json) = serde_json::to_vec(&ResumeState { size: s.size, ranges, validator: s.validator.clone() }) else { continue };
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }

    async fn flush(&self, stream: &OpenStream, range: &Range, at: u64, buf: &mut Vec<u8>) -> Result<(), String> {
        if buf.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(buf);
        let file = stream.file.clone();
        let (data, result) = tokio::task::spawn_blocking(move || {
            let r = write_at(&file, at, &data);
            (data, r)
        })
        .await
        .map_err(|e| e.to_string())?;
        result.map_err(|e| format!("Couldn't write to disk: {}", e))?;
        let len = data.len() as u64;
        range.pos.fetch_max(at + len, Ordering::AcqRel);
        self.meter.done.fetch_add(len, Ordering::Relaxed);
        if self.meter.waiting.load(Ordering::Relaxed) {
            *self.offline_since.lock().unwrap() = None;
            self.meter.waiting.store(false, Ordering::Relaxed);
        }
        *buf = data;
        buf.clear();
        Ok(())
    }

    async fn attempt(&self, range: &Range, buf: &mut Vec<u8>) -> Attempt {
        let stream = &self.streams[range.stream];
        let pos = range.pos.load(Ordering::Acquire);
        let end = range.end.load(Ordering::Acquire);
        if pos >= end {
            return Attempt::Progress;
        }
        let request_end = end.min(pos.saturating_add(stream.max_request));
        let request = self.client.get(&stream.url).headers(stream.headers.clone()).header(RANGE, format!("bytes={}-{}", pos, request_end - 1));
        // If the file changed since the first request, the server sends all of it (200)
        // instead of mixing new bytes into the old file; that ends this engine's attempt.
        let request = match &stream.validator {
            Some(v) => request.header(IF_RANGE, v.as_str()),
            None => request,
        };
        let response = match tokio::time::timeout(READ_TIMEOUT, request.send()).await {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                return match send_failure(&e) {
                    SendFailure::Refused => Attempt::Busy,
                    SendFailure::Unreachable => Attempt::Offline,
                    // Reset or closed while other connections get data: the server wants fewer.
                    SendFailure::Unclear => self.network_failure(true, e.to_string()),
                };
            }
            Err(_) => return self.network_failure(true, "no answer".into()),
        };
        let status = response.status().as_u16();
        match status {
            206 => {}
            429 | 503 => return Attempt::Busy,
            s if is_expired_status(s) => return Attempt::Expired(format!("link refused ({})", s)),
            200 => return Attempt::Fatal("server ignored the range request".into()),
            s if is_temporary_status(s) => return Attempt::Retry(format!("HTTP {}", s)),
            s => return Attempt::Fatal(format!("HTTP {}", s)),
        }
        let started_at = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()).and_then(start_from_content_range);
        if started_at != Some(pos) {
            return Attempt::Fatal("server answered with the wrong range".into());
        }

        let mut response = response;
        let mut at = pos;
        let mut got_any = false;
        loop {
            if self.stopped() {
                break;
            }
            // Fewer connections wanted: exactly the extra ones leave, keeping what they got.
            if self.should_retire() {
                if let Err(e) = self.flush(stream, range, at, buf).await {
                    return Attempt::Fatal(e);
                }
                return Attempt::Retired;
            }
            let chunk = match tokio::time::timeout(READ_TIMEOUT, response.chunk()).await {
                Ok(Ok(Some(c))) => c,
                Ok(Ok(None)) => break,
                failed => {
                    if let Err(e) = self.flush(stream, range, at, buf).await {
                        return Attempt::Fatal(e);
                    }
                    if got_any {
                        return Attempt::Progress;
                    }
                    let reason = match failed {
                        Ok(Err(e)) => e.to_string(),
                        _ => "no data".to_string(),
                    };
                    return self.network_failure(false, reason);
                }
            };
            self.last_data_ms.store(self.elapsed_ms(), Ordering::Relaxed);
            // Under a speed limit, reading slower makes the server send slower.
            bandwidth::take(chunk.len()).await;
            // Another connection may have taken the back of this range meanwhile.
            let limit = range.end.load(Ordering::Acquire).min(request_end);
            let room = limit.saturating_sub(at + buf.len() as u64) as usize;
            let take = room.min(chunk.len());
            buf.extend_from_slice(&chunk[..take]);
            if take > 0 {
                got_any = true;
            }
            let reached_end = at + buf.len() as u64 >= limit;
            if buf.len() >= WRITE_BUFFER || reached_end {
                let len = buf.len() as u64;
                if let Err(e) = self.flush(stream, range, at, buf).await {
                    return Attempt::Fatal(e);
                }
                at += len;
            }
            if reached_end {
                if limit == request_end {
                    // The whole answer was used: read its end so the connection can be used again
                    // (a new one costs a handshake). Dropping it mid-body would close it.
                    let _ = tokio::time::timeout(Duration::from_secs(2), response.chunk()).await;
                    drop(response);
                    // Give the connection a moment to return to the pool, or the next request
                    // races it with a new connection (which a busy server may refuse).
                    for _ in 0..4 {
                        tokio::task::yield_now().await;
                    }
                    break;
                }
                break;
            }
        }
        if let Err(e) = self.flush(stream, range, at, buf).await {
            return Attempt::Fatal(e);
        }
        if got_any { Attempt::Progress } else { Attempt::Retry("empty response".into()) }
    }

    async fn work(self: Arc<Self>) {
        let mut buf = Vec::with_capacity(WRITE_BUFFER);
        // Refused connections across ranges: a server that keeps refusing ends the attempt.
        let mut refusals = 0u32;
        let mut refused_before = false;
        'claim: while !self.stopped() {
            if self.should_retire() {
                return;
            }
            let Some(range) = self.claim() else { break };
            let mut failures = 0u32;
            while range.remaining() > 0 && !self.stopped() {
                match self.attempt(&range, &mut buf).await {
                    Attempt::Progress => {
                        failures = 0;
                        refusals = 0;
                        refused_before = false;
                        if self.should_retire() {
                            range.busy.store(false, Ordering::Release);
                            return;
                        }
                    }
                    Attempt::Retired => {
                        range.busy.store(false, Ordering::Release);
                        return;
                    }
                    Attempt::Retry(reason) => {
                        failures += 1;
                        if failures >= MAX_FAILURES {
                            self.stop_with(Stop::Interrupted(reason));
                            break;
                        }
                        nap(&self.cancel, Duration::from_millis(300 * (1 << failures.min(4)))).await;
                    }
                    Attempt::Offline => {
                        // The main loop decides when waiting has gone on too long.
                        self.went_offline();
                        nap(&self.cancel, OFFLINE_RETRY).await;
                    }
                    Attempt::Busy if !refused_before => {
                        // Servers count a closed connection for a moment after it closes: one
                        // refusal right after reconnecting isn't pushback yet. Try again shortly.
                        refused_before = true;
                        nap(&self.cancel, Duration::from_millis(500)).await;
                    }
                    Attempt::Busy => {
                        // Too many connections for this server: this refused one is the one to go,
                        // before working connections notice there are too many.
                        refused_before = false;
                        self.meter.pushback.store(true, Ordering::Relaxed);
                        let t = self.target.load(Ordering::Relaxed);
                        if t > 1 {
                            let _ = self.target.compare_exchange(t, t - 1, Ordering::AcqRel, Ordering::Relaxed);
                        }
                        range.busy.store(false, Ordering::Release);
                        if self.should_retire() {
                            return;
                        }
                        refusals += 1;
                        if refusals >= MAX_FAILURES * 2 {
                            self.stop_with(Stop::Interrupted("server kept refusing connections".into()));
                            break 'claim;
                        }
                        nap(&self.cancel, Duration::from_millis(1000 * refusals.min(5) as u64)).await;
                        continue 'claim;
                    }
                    Attempt::Expired(reason) => {
                        self.stop_with(Stop::Expired(reason));
                        break;
                    }
                    Attempt::Fatal(reason) => {
                        self.stop_with(Stop::Fallback(reason));
                        break;
                    }
                }
            }
            range.busy.store(false, Ordering::Release);
        }
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Splits the largest ranges until there are `parts` of them (none under `MIN_SPLIT`).
fn split_evenly(ranges: &mut Vec<Arc<Range>>, parts: usize) {
    while ranges.len() < parts {
        let Some(largest) = ranges.iter().max_by_key(|r| r.remaining()).cloned() else { return };
        let (pos, end) = (largest.pos.load(Ordering::Acquire), largest.end.load(Ordering::Acquire));
        let left = end - pos;
        // The largest gets an equal share for the connections still without a part.
        let share = left / (parts - ranges.len() + 1) as u64;
        if share < MIN_SPLIT || left - share < MIN_SPLIT {
            return;
        }
        let mid = (end - share) & !0xFFFF;
        if mid <= pos {
            return;
        }
        largest.end.store(mid, Ordering::Release);
        ranges.push(Range::new(largest.stream, mid, end, false));
    }
}

fn spawn_worker(job: &Arc<Job>, set: &mut tokio::task::JoinSet<()>) {
    job.active.fetch_add(1, Ordering::AcqRel);
    set.spawn(job.clone().work());
}

/// Downloads every stream into its `dest`. Streams share one pool of connections.
pub async fn download(streams: Vec<Stream>, limits: Limits, meter: Arc<Meter>, cancel: Arc<AtomicBool>) -> Result<(), TurboError> {
    let client = client().map_err(TurboError::Fallback)?;
    let share = Registration::new(streams.first().and_then(|s| site_of(&s.url)));

    let mut open = Vec::new();
    let mut ranges = Vec::new();
    let mut total = 0u64;
    let mut done = 0u64;
    for (i, s) in streams.iter().enumerate() {
        let headers = header_map(&s.headers);
        let Probed { url, size, validator } = probe(&client, s, &headers, &meter, &cancel).await?;
        if s.size.is_some_and(|expected| expected != size) {
            log::info!("turbo: site said {} bytes, server says {}", s.size.unwrap_or(0), size);
        }
        let part = part_path(&s.dest);
        let resumed = load_resume(&s.dest, size, validator.as_deref());
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(resumed.is_none())
            .open(&part)
            .map_err(|e| TurboError::Fallback(format!("Couldn't create {}: {}", part.display(), e)))?;
        if resumed.is_none() {
            file.set_len(size).map_err(|e| TurboError::Fallback(format!("Not enough disk space? {}", e)))?;
        }
        let pending = resumed.unwrap_or_else(|| vec![(0, size)]);
        let left: u64 = pending.iter().map(|&(a, b)| b - a).sum();
        done += size - left;
        total += size;
        for (a, b) in pending {
            ranges.push(Range::new(i, a, b, false));
        }
        open.push(OpenStream {
            url,
            headers,
            size,
            validator,
            max_request: s.max_request.unwrap_or(u64::MAX).max(MIN_SPLIT),
            file: Arc::new(file),
            dest: s.dest.clone(),
        });
    }
    meter.total.store(total, Ordering::Relaxed);
    meter.done.store(done, Ordering::Relaxed);

    let job = Arc::new(Job {
        client,
        streams: open,
        ranges: Mutex::new(ranges),
        meter: meter.clone(),
        cancel: cancel.clone(),
        stop: Mutex::new(None),
        active: AtomicUsize::new(0),
        target: AtomicUsize::new(limits.start.max(1)),
        started: Instant::now(),
        last_data_ms: AtomicU64::new(u64::MAX),
        offline_since: Mutex::new(None),
    });

    let mut set = tokio::task::JoinSet::new();
    let small = total.saturating_sub(done) < 4 * MIN_SPLIT;
    let mut ceiling = share.fair_share(limits.max);
    // Held back by other downloads: ramp up again once they finish.
    let mut held_back = !small && limits.start > ceiling;
    if held_back {
        meter.shared.store(true, Ordering::Relaxed);
    }
    let first = if small { 1 } else { limits.start.clamp(1, ceiling) };
    job.target.store(first, Ordering::Relaxed);
    // One part per connection from the start. Taking over half of a running request instead
    // cuts that request short, which closes its connection.
    split_evenly(&mut job.ranges.lock().unwrap(), first);
    for _ in 0..first {
        spawn_worker(&job, &mut set);
    }

    // Ramp up: double the connections while each doubling raises the speed by 20%+. Speed is
    // measured over 1.5 s, starting 0.5 s after a change so connection setup doesn't count. A step
    // that didn't help is undone: extra connections then only cost the server and this PC.
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ticks = 0u32;
    let mut ramping = !small && limits.max.min(ceiling) > first;
    let mut settle_until = Instant::now() + Duration::from_millis(500);
    let mut window: Option<(Instant, u64)> = None;
    let mut previous_level: Option<(usize, f64)> = None;
    let mut last_done = meter.done.load(Ordering::Relaxed);
    let mut last_progress = Instant::now();
    let mut last_tick = Instant::now();
    loop {
        tokio::select! {
            joined = set.join_next() => {
                if joined.is_none() {
                    break;
                }
                // A worker left early (server pushback): let others keep the remaining work going.
                if job.has_free_work() && !job.stopped() && job.active.load(Ordering::Acquire) == 0 {
                    spawn_worker(&job, &mut set);
                }
            }
            _ = tick.tick() => {
                ticks += 1;
                let now = Instant::now();
                // A long gap between ticks means the PC was asleep: give the network a fresh chance.
                if now.duration_since(last_tick) > Duration::from_secs(5) {
                    last_progress = now;
                    if let Some(since) = job.offline_since.lock().unwrap().as_mut() {
                        *since = now;
                    }
                }
                last_tick = now;
                meter.connections.store(job.active.load(Ordering::Relaxed), Ordering::Relaxed);
                let done_now = meter.done.load(Ordering::Relaxed);
                if done_now != last_done {
                    last_done = done_now;
                    last_progress = now;
                } else {
                    let offline_for = job.offline_since.lock().unwrap().map(|t| now.duration_since(t));
                    match offline_for {
                        Some(d) if d > OFFLINE_LIMIT => job.stop_with(Stop::Interrupted("no internet connection".into())),
                        None if now.duration_since(last_progress) > STALL_LIMIT => job.stop_with(Stop::Interrupted("no data for 30 s".into())),
                        _ => {}
                    }
                }
                if ticks % 4 == 0 {
                    job.save_state();
                }

                // Share connections with downloads that started or finished meanwhile.
                let fair = share.fair_share(limits.max);
                if fair != ceiling {
                    ceiling = fair;
                    let current = job.target.load(Ordering::Relaxed);
                    let remaining = total.saturating_sub(done_now);
                    if current > ceiling {
                        job.target.store(ceiling, Ordering::Relaxed);
                        held_back = true;
                        meter.shared.store(true, Ordering::Relaxed);
                    } else if held_back && !ramping && ceiling > current && remaining > 2 * current as u64 * MIN_SPLIT {
                        ramping = true;
                        previous_level = None;
                        window = None;
                        settle_until = now + Duration::from_millis(500);
                    }
                }

                // The server already said it wants fewer connections: never ask for more.
                if meter.pushback.load(Ordering::Relaxed) {
                    ramping = false;
                }
                // Speeds measured while the network is down say nothing about connections.
                if meter.waiting.load(Ordering::Relaxed) {
                    window = None;
                    settle_until = now + Duration::from_millis(500);
                }
                if ramping && now >= settle_until {
                    match window {
                        None => window = Some((now, done_now)),
                        Some((since, at)) if now.duration_since(since) >= Duration::from_millis(1500) => {
                            let rate = done_now.saturating_sub(at) as f64 / now.duration_since(since).as_secs_f64();
                            let current = job.target.load(Ordering::Relaxed);
                            let helped = previous_level.is_none_or(|(_, before)| rate > before * 1.2);
                            if !helped {
                                if let Some((level, _)) = previous_level {
                                    job.target.store(level, Ordering::Relaxed);
                                }
                                meter.settled.store(job.target.load(Ordering::Relaxed), Ordering::Relaxed);
                                ramping = false;
                            } else {
                                previous_level = Some((current, rate));
                                let wanted = (current * 2).min(limits.max);
                                let next = wanted.min(ceiling);
                                if next < wanted {
                                    held_back = true;
                                    meter.shared.store(true, Ordering::Relaxed);
                                }
                                let remaining = total.saturating_sub(done_now);
                                if next > current && remaining > next as u64 * MIN_SPLIT {
                                    job.target.store(next, Ordering::Relaxed);
                                    for _ in job.active.load(Ordering::Relaxed)..next {
                                        spawn_worker(&job, &mut set);
                                    }
                                    settle_until = now + Duration::from_millis(500);
                                } else {
                                    if next == current {
                                        // At the cap and still improving: the cap is what works.
                                        meter.settled.store(current, Ordering::Relaxed);
                                    }
                                    ramping = false;
                                }
                            }
                            window = None;
                        }
                        Some(_) => {}
                    }
                }
            }
        }
    }
    drop(share);
    meter.waiting.store(false, Ordering::Relaxed);

    let stop = job.stop.lock().unwrap().take();
    let streams_done = job.snapshot().iter().all(|r| r.is_empty());
    if let Some(stop) = stop {
        job.save_state();
        return Err(match stop {
            Stop::Fallback(reason) => TurboError::Fallback(reason),
            Stop::Interrupted(reason) => TurboError::Interrupted(reason),
            Stop::Expired(reason) => TurboError::Expired(reason),
        });
    }
    if cancel.load(Ordering::Relaxed) || !streams_done {
        job.save_state();
        return Err(if cancel.load(Ordering::Relaxed) { TurboError::Aborted } else { TurboError::Interrupted("unfinished ranges".into()) });
    }

    let job = Arc::try_unwrap(job).map_err(|_| TurboError::Fallback("engine still busy".into()))?;
    for s in job.streams {
        let OpenStream { file, dest, .. } = s;
        if let Ok(f) = Arc::try_unwrap(file) {
            let _ = f.sync_data();
            drop(f);
        }
        let part = part_path(&dest);
        replace_file(&part, &dest).await.map_err(|e| TurboError::Fallback(format!("Couldn't finish {}: {}", dest.display(), e)))?;
        let _ = std::fs::remove_file(state_path(&dest));
    }
    Ok(())
}

/// One plain request for servers without range support. Can't resume: starts over each time.
pub async fn download_whole(stream: Stream, meter: Arc<Meter>, cancel: Arc<AtomicBool>) -> Result<(), TurboError> {
    let client = client().map_err(TurboError::Fallback)?;
    let mut response = client
        .get(&stream.url)
        .headers(header_map(&stream.headers))
        .send()
        .await
        .map_err(|e| TurboError::Interrupted(e.to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let reason = format!("HTTP {}", status);
        return Err(if is_temporary_status(status) { TurboError::Interrupted(reason) } else { TurboError::Fallback(reason) });
    }
    let total = response.content_length().unwrap_or(0);
    meter.total.store(total, Ordering::Relaxed);
    meter.done.store(0, Ordering::Relaxed);
    meter.connections.store(1, Ordering::Relaxed);

    let part = part_path(&stream.dest);
    let _ = std::fs::remove_file(state_path(&stream.dest));
    let file = Arc::new(std::fs::File::create(&part).map_err(|e| TurboError::Fallback(format!("Couldn't create {}: {}", part.display(), e)))?);
    let mut at = 0u64;
    let mut buf: Vec<u8> = Vec::with_capacity(WRITE_BUFFER);
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err(TurboError::Aborted);
        }
        let chunk = match tokio::time::timeout(READ_TIMEOUT, response.chunk()).await {
            Ok(Ok(Some(c))) => Some(c),
            Ok(Ok(None)) => None,
            Ok(Err(e)) => return Err(TurboError::Interrupted(e.to_string())),
            Err(_) => return Err(TurboError::Interrupted("no data".into())),
        };
        let finished = chunk.is_none();
        if let Some(c) = chunk {
            bandwidth::take(c.len()).await;
            buf.extend_from_slice(&c);
        }
        if buf.len() >= WRITE_BUFFER || (finished && !buf.is_empty()) {
            let data = std::mem::take(&mut buf);
            let f = file.clone();
            let offset = at;
            let (data, result) = tokio::task::spawn_blocking(move || {
                let r = write_at(&f, offset, &data);
                (data, r)
            })
            .await
            .map_err(|e| TurboError::Fallback(e.to_string()))?;
            result.map_err(|e| TurboError::Fallback(format!("Couldn't write to disk: {}", e)))?;
            at += data.len() as u64;
            meter.done.store(at, Ordering::Relaxed);
            buf = data;
            buf.clear();
        }
        if finished {
            break;
        }
    }
    if total > 0 && at != total {
        return Err(TurboError::Interrupted(format!("connection ended early ({} of {} bytes)", at, total)));
    }
    if total == 0 {
        meter.total.store(at, Ordering::Relaxed);
    }
    drop(file);
    replace_file(&part, &stream.dest).await.map_err(|e| TurboError::Fallback(format!("Couldn't finish {}: {}", stream.dest.display(), e)))
}

/// Cookie header from yt-dlp's per-format `cookies` field ("a=1; Domain=.x.com; Path=/; b=2; ...").
pub fn cookie_header(field: &str) -> Option<String> {
    const ATTRS: [&str; 8] = ["domain", "path", "secure", "expires", "httponly", "max-age", "samesite", "comment"];
    let pairs: Vec<String> = field
        .split(';')
        .map(str::trim)
        .filter_map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            let k = k.trim();
            (!k.is_empty() && !ATTRS.contains(&k.to_ascii_lowercase().as_str()) && p.contains('=')).then(|| format!("{}={}", k, v.trim()))
        })
        .collect();
    (!pairs.is_empty()).then(|| pairs.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// How the test server behaves.
    #[derive(Clone)]
    struct Server {
        ranges: bool,
        /// Speed cap of each connection (bytes/s, 0: none).
        per_conn_bps: u64,
        /// Speed cap of all connections together, like a site that limits each visitor.
        total_bps: u64,
        /// Every 7th request dies halfway through.
        flaky: bool,
        /// Connections over this many get "503 busy" (0: no limit).
        max_conns: usize,
        /// The network is down from `.0` to `.1` after the server starts: nothing gets through
        /// (requests go unanswered, transfers stall), as in a real outage.
        down: Option<(Duration, Duration)>,
        etag: Option<String>,
    }

    impl Default for Server {
        fn default() -> Self {
            Server { ranges: true, per_conn_bps: 0, total_bps: 0, flaky: false, max_conns: 0, down: None, etag: None }
        }
    }

    #[derive(Default)]
    struct Stats {
        requests: AtomicUsize,
        open: AtomicUsize,
        peak: AtomicUsize,
    }

    struct Open(Arc<Stats>);
    impl Drop for Open {
        fn drop(&mut self) {
            self.0.open.fetch_sub(1, Ordering::SeqCst);
        }
    }

    /// A tiny HTTP/1.1 server with range support and the behaviors in `Server`.
    async fn serve_with(data: Arc<Vec<u8>>, opts: Server) -> (String, Arc<Stats>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let stats = Arc::new(Stats::default());
        let counter = stats.clone();
        let born = Instant::now();
        let down = opts.down;
        let is_down = move || down.is_some_and(|(from, to)| (from..to).contains(&born.elapsed()));
        // Shared by every connection when `total_bps` is set: when the line is next free.
        let line: Arc<Mutex<Instant>> = Arc::new(Mutex::new(Instant::now()));
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let (data, counter, opts, line) = (data.clone(), counter.clone(), opts.clone(), line.clone());
                let open = counter.open.fetch_add(1, Ordering::SeqCst) + 1;
                counter.peak.fetch_max(open, Ordering::SeqCst);
                let guard = Open(counter.clone());
                // Connections over the limit are turned away; the ones before them keep working.
                let rejected = opts.max_conns > 0 && open > opts.max_conns;
                tokio::spawn(async move {
                    let _guard = guard;
                    loop {
                        let mut head = Vec::new();
                        let mut byte = [0u8; 1];
                        while !head.ends_with(b"\r\n\r\n") {
                            match sock.read(&mut byte).await {
                                Ok(1) => head.push(byte[0]),
                                _ => return,
                            }
                        }
                        while is_down() {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                        }
                        let n = counter.requests.fetch_add(1, Ordering::SeqCst);
                        if rejected {
                            let _ = sock.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                            return;
                        }
                        let text = String::from_utf8_lossy(&head).to_ascii_lowercase();
                        let range = text
                            .lines()
                            .find_map(|l| l.strip_prefix("range: bytes="))
                            .and_then(|r| r.split_once('-'))
                            .map(|(a, b)| (a.trim().parse::<u64>().unwrap(), b.trim().parse::<u64>().ok()));
                        let if_range = text.lines().find_map(|l| l.strip_prefix("if-range: ")).map(|v| v.trim().to_string());
                        let current = opts.etag.as_ref().map(|e| e.to_ascii_lowercase());
                        // A stale If-Range gets the whole (changed) file, as real servers do.
                        let stale = if_range.is_some() && if_range != current;
                        let len = data.len() as u64;
                        let (status, start, end) = match (opts.ranges && !stale, range) {
                            (true, Some((a, b))) => ("206 Partial Content", a, b.map_or(len, |b| (b + 1).min(len))),
                            _ => ("200 OK", 0, len),
                        };
                        let mut header = format!("HTTP/1.1 {}\r\nContent-Length: {}\r\n", status, end - start);
                        if status.starts_with("206") {
                            header.push_str(&format!("Content-Range: bytes {}-{}/{}\r\n", start, end - 1, len));
                        }
                        if let Some(tag) = &opts.etag {
                            header.push_str(&format!("ETag: {}\r\n", tag));
                        }
                        header.push_str("\r\n");
                        if sock.write_all(header.as_bytes()).await.is_err() {
                            return;
                        }
                        let body = &data[start as usize..end as usize];
                        let cut = opts.flaky && n % 7 == 3 && body.len() > 2;
                        let body = if cut { &body[..body.len() / 2] } else { body };
                        // Paced by the clock, not by sleeping per piece: Windows timers oversleep.
                        let mut due = Instant::now();
                        for piece in body.chunks(16 * 1024) {
                            while is_down() {
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                            if opts.total_bps > 0 {
                                let free_at = {
                                    let mut next = line.lock().unwrap();
                                    // Late wake-ups catch up (up to 50 ms), as on a real line.
                                    let now = Instant::now();
                                    let start = (*next).max(now.checked_sub(Duration::from_millis(50)).unwrap_or(now));
                                    *next = start + Duration::from_secs_f64(piece.len() as f64 / opts.total_bps as f64);
                                    *next
                                };
                                tokio::time::sleep_until(free_at.into()).await;
                            }
                            if sock.write_all(piece).await.is_err() {
                                return;
                            }
                            if opts.per_conn_bps > 0 {
                                due += Duration::from_secs_f64(piece.len() as f64 / opts.per_conn_bps as f64);
                                tokio::time::sleep_until(due.into()).await;
                            }
                        }
                        if cut {
                            return;
                        }
                    }
                });
            }
        });
        (format!("http://{}/file", addr), stats)
    }

    async fn serve(data: Arc<Vec<u8>>, ranges: bool, per_conn_bps: u64, flaky: bool) -> (String, Arc<Stats>) {
        serve_with(data, Server { ranges, per_conn_bps, flaky, ..Server::default() }).await
    }

    fn sample(len: usize) -> Arc<Vec<u8>> {
        let mut x = 0x1234_5678u32;
        Arc::new((0..len).map(|_| { x ^= x << 13; x ^= x >> 17; x ^= x << 5; x as u8 }).collect())
    }

    fn temp_dest(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("hyperstream-turbo-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join(name);
        let _ = std::fs::remove_file(&dest);
        remove_partial(&dest);
        dest
    }

    fn stream(url: &str, dest: &Path, max_request: Option<u64>) -> Stream {
        Stream { url: url.into(), headers: vec![("User-Agent".into(), "test".into())], size: None, dest: dest.into(), max_request, pieces: None }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn downloads_exact_bytes_over_many_connections() {
        let data = sample(9 * 1024 * 1024 + 123);
        let (url, _) = serve(data.clone(), true, 0, false).await;
        let dest = temp_dest("exact.bin");
        let meter = Arc::new(Meter::default());
        download(vec![stream(&url, &dest, None)], Limits { start: 6, max: 6 }, meter.clone(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        assert!(!part_path(&dest).exists() && !state_path(&dest).exists());
        assert!(meter.done.load(Ordering::Relaxed) >= data.len() as u64);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn survives_dropped_connections_and_capped_requests() {
        let data = sample(6 * 1024 * 1024 + 7);
        let (url, stats) = serve(data.clone(), true, 0, true).await;
        let dest = temp_dest("flaky.bin");
        download(vec![stream(&url, &dest, Some(MIN_SPLIT))], Limits { start: 4, max: 8 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        // 1 MiB request cap on 6 MiB: at least 7 requests including the probe.
        assert!(stats.requests.load(Ordering::SeqCst) >= 7);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_streams_share_connections() {
        let (a, b) = (sample(3 * 1024 * 1024), sample(5 * 1024 * 1024 + 99));
        let (url_a, _) = serve(a.clone(), true, 0, false).await;
        let (url_b, _) = serve(b.clone(), true, 0, false).await;
        let (dest_a, dest_b) = (temp_dest("video.part.mp4"), temp_dest("audio.m4a"));
        download(
            vec![stream(&url_a, &dest_a, None), stream(&url_b, &dest_b, None)],
            Limits { start: 4, max: 4 },
            Arc::new(Meter::default()),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&dest_a).unwrap(), *a);
        assert_eq!(std::fs::read(&dest_b).unwrap(), *b);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn no_range_support_falls_back() {
        let (url, _) = serve(sample(1000), false, 0, false).await;
        let dest = temp_dest("norange.bin");
        let err = download(vec![stream(&url, &dest, None)], Limits { start: 4, max: 4 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap_err();
        assert!(matches!(err, TurboError::Fallback(_)));
        assert!(!dest.exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn pause_keeps_progress_and_resume_finishes() {
        let data = sample(4 * 1024 * 1024);
        // ~1 MiB/s per connection so the pause lands mid-download.
        let (url, _) = serve(data.clone(), true, 1024 * 1024, false).await;
        let dest = temp_dest("resume.bin");
        let cancel = Arc::new(AtomicBool::new(false));
        let meter = Arc::new(Meter::default());
        let stopper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(900)).await;
            stopper.store(true, Ordering::Relaxed);
        });
        let err = download(vec![stream(&url, &dest, None)], Limits { start: 2, max: 2 }, meter.clone(), cancel).await.unwrap_err();
        assert_eq!(err, TurboError::Aborted);
        let first = meter.done.load(Ordering::Relaxed);
        assert!(first > 0 && first < data.len() as u64, "paused after {} bytes", first);
        assert!(state_path(&dest).exists());

        let meter = Arc::new(Meter::default());
        let (url2, _) = serve(data.clone(), true, 0, false).await;
        download(vec![stream(&url2, &dest, None)], Limits { start: 2, max: 2 }, meter.clone(), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn ramps_up_when_connections_are_capped() {
        let data = sample(24 * 1024 * 1024);
        // 1 MiB/s per connection: more connections = proportionally faster.
        let (url, _) = serve(data.clone(), true, 1024 * 1024, false).await;
        let dest = temp_dest("ramp.bin");
        let meter = Arc::new(Meter::default());
        let peak = Arc::new(AtomicUsize::new(0));
        let (m, p) = (meter.clone(), peak.clone());
        let watcher = tokio::spawn(async move {
            loop {
                p.fetch_max(m.connections.load(Ordering::Relaxed), Ordering::Relaxed);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });
        let started = std::time::Instant::now();
        download(vec![stream(&url, &dest, None)], Limits { start: 2, max: 16 }, meter, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        watcher.abort();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        assert!(peak.load(Ordering::Relaxed) >= 8, "peaked at {} connections", peak.load(Ordering::Relaxed));
        // 2 fixed connections would need 12 s.
        assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn whole_file_when_ranges_are_unsupported() {
        let data = sample(3 * 1024 * 1024 + 5);
        let (url, _) = serve(data.clone(), false, 0, false).await;
        let dest = temp_dest("whole.bin");
        download_whole(stream(&url, &dest, None), Arc::new(Meter::default()), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn changed_file_is_not_resumed() {
        let data = sample(2 * 1024 * 1024);
        let (url, _) = serve(data.clone(), true, 0, false).await;
        let dest = temp_dest("changed.bin");
        // Leftovers from a different version of the file: same size, other version tag.
        std::fs::write(part_path(&dest), vec![0u8; data.len()]).unwrap();
        let stale = ResumeState { size: data.len() as u64, ranges: vec![(1024, data.len() as u64)], validator: Some("\"old\"".into()) };
        std::fs::write(state_path(&dest), serde_json::to_vec(&stale).unwrap()).unwrap();
        // The test server sends no version tag, so the old record can't be trusted.
        download(vec![stream(&url, &dest, None)], Limits { start: 2, max: 2 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
    }

    fn no_cancel() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    /// Records the most connections a meter ever showed, until dropped.
    fn watch_peak(meter: &Arc<Meter>) -> (Arc<AtomicUsize>, Arc<AtomicBool>, tokio::task::JoinHandle<()>) {
        let (m, peak, waited) = (meter.clone(), Arc::new(AtomicUsize::new(0)), Arc::new(AtomicBool::new(false)));
        let (p, w) = (peak.clone(), waited.clone());
        let handle = tokio::spawn(async move {
            loop {
                p.fetch_max(m.connections.load(Ordering::Relaxed), Ordering::Relaxed);
                if m.waiting.load(Ordering::Relaxed) {
                    w.store(true, Ordering::Relaxed);
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        });
        (peak, waited, handle)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn waits_out_a_network_drop() {
        let data = sample(8 * 1024 * 1024);
        let opts = Server { per_conn_bps: 2 * 1024 * 1024, down: Some((Duration::from_millis(800), Duration::from_millis(5800))), ..Server::default() };
        let (url, _) = serve_with(data.clone(), opts).await;
        let dest = temp_dest("drop.bin");
        let meter = Arc::new(Meter::default());
        let (_, waited, watcher) = watch_peak(&meter);
        download(vec![stream(&url, &dest, None)], Limits { start: 4, max: 4 }, meter.clone(), no_cancel()).await.unwrap();
        watcher.abort();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        assert!(waited.load(Ordering::Relaxed), "never showed it was waiting for the network");
        // The network's fault, not the server's: nothing to remember about the site.
        assert!(!meter.pushback.load(Ordering::Relaxed));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn offline_too_long_stops_for_now_and_resumes_later() {
        let data = sample(8 * 1024 * 1024);
        let opts = Server { per_conn_bps: 1024 * 1024, down: Some((Duration::from_millis(1000), Duration::MAX)), ..Server::default() };
        let (url, _) = serve_with(data.clone(), opts).await;
        let dest = temp_dest("offline.bin");
        let meter = Arc::new(Meter::default());
        let started = Instant::now();
        let err = download(vec![stream(&url, &dest, None)], Limits { start: 2, max: 2 }, meter.clone(), no_cancel()).await.unwrap_err();
        assert!(matches!(err, TurboError::Interrupted(_)), "{:?}", err);
        assert!(started.elapsed() < Duration::from_secs(20), "gave up after {:?}", started.elapsed());
        let kept = meter.done.load(Ordering::Relaxed);
        assert!(kept > 0 && part_path(&dest).exists() && state_path(&dest).exists());

        // Back online: the next attempt continues instead of starting over.
        let (url, stats) = serve(data.clone(), true, 0, false).await;
        let meter = Arc::new(Meter::default());
        download(vec![stream(&url, &dest, None)], Limits { start: 2, max: 2 }, meter.clone(), no_cancel()).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        assert!(stats.requests.load(Ordering::SeqCst) >= 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn busy_server_gets_fewer_connections() {
        let data = sample(12 * 1024 * 1024);
        let opts = Server { per_conn_bps: 2 * 1024 * 1024, max_conns: 3, ..Server::default() };
        let (url, stats) = serve_with(data.clone(), opts).await;
        let dest = temp_dest("busy.bin");
        let meter = Arc::new(Meter::default());
        download(vec![stream(&url, &dest, None)], Limits { start: 8, max: 8 }, meter.clone(), no_cancel()).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        assert!(meter.pushback.load(Ordering::Relaxed));
        assert!(stats.peak.load(Ordering::SeqCst) <= 9);
        let file = std::env::temp_dir().join(format!("hs-sites-busy-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&file);
        remember_site(&url, &meter, &file);
        assert!(limits_for(Limits { start: 8, max: 8 }, &url, &file).max <= 4);
        let _ = std::fs::remove_file(&file);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn parallel_downloads_from_one_site_share_its_connections() {
        let data = sample(16 * 1024 * 1024);
        // Same host for both, 1 MiB/s per connection so both run at the same time.
        let (url, stats) = serve(data.clone(), true, 1024 * 1024, false).await;
        let (a, b) = (temp_dest("share-a.bin"), temp_dest("share-b.bin"));
        let (ma, mb) = (Arc::new(Meter::default()), Arc::new(Meter::default()));
        let limits = Limits { start: 8, max: 8 };
        let (ra, rb) = tokio::join!(
            download(vec![stream(&url, &a, None)], limits, ma.clone(), no_cancel()),
            download(vec![stream(&url, &b, None)], limits, mb.clone(), no_cancel()),
        );
        ra.unwrap();
        rb.unwrap();
        assert_eq!(std::fs::read(&a).unwrap(), *data);
        assert_eq!(std::fs::read(&b).unwrap(), *data);
        // Eight for the site in all (plus a moment of overlap while one hands over).
        assert!(stats.peak.load(Ordering::SeqCst) <= 10, "peak {}", stats.peak.load(Ordering::SeqCst));
        assert!(ma.shared.load(Ordering::Relaxed) || mb.shared.load(Ordering::Relaxed));
    }

    #[cfg(windows)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn finishing_waits_for_a_file_another_program_holds() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = std::env::temp_dir().join("hyperstream-turbo-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let (from, to) = (dir.join("locked.part"), dir.join("locked.bin"));
        std::fs::write(&from, b"new").unwrap();
        std::fs::write(&to, b"old").unwrap();
        // Like an antivirus scan: the file is open with no sharing for a moment.
        let holder = std::fs::OpenOptions::new().read(true).share_mode(0).open(&to).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            drop(holder);
        });
        replace_file(&from, &to).await.unwrap();
        release.join().unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), b"new");
    }

    // ----- Engine benchmark: `npm run perf:engine` (cargo test --lib engine_bench -- --ignored) -----
    //
    // Each case plays a kind of server seen in the wild, prints the result and fails when the
    // engine falls below its budget. Run one at a time: they measure speed.

    async fn bench(name: &str, data: Arc<Vec<u8>>, opts: Server, limits: Limits) -> (f64, usize, Arc<Meter>) {
        let (url, _) = serve_with(data.clone(), opts).await;
        let file: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
        let dest = temp_dest(&format!("bench-{}.bin", file));
        let meter = Arc::new(Meter::default());
        let (peak, _, watcher) = watch_peak(&meter);
        let started = Instant::now();
        download(vec![stream(&url, &dest, None)], limits, meter.clone(), no_cancel()).await.unwrap();
        let secs = started.elapsed().as_secs_f64();
        watcher.abort();
        assert_eq!(std::fs::read(&dest).unwrap(), *data, "{}: wrong bytes", name);
        let _ = std::fs::remove_file(&dest);
        let mbps = data.len() as f64 / secs / 1e6;
        let peak = peak.load(Ordering::Relaxed);
        println!("engine_bench {:<24} {:>7.1} MB/s  {:>5.2} s  peak {:>2} connections", name, mbps, secs, peak);
        (mbps, peak, meter)
    }

    const MB: u64 = 1_000_000;

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn engine_bench() {
        let pc = Limits { start: 8, max: 16 };

        // Each connection capped at 2 MB/s (common for file hosts): more connections, more speed.
        let (mbps, peak, _) = bench("per-connection cap", sample(96 << 20), Server { per_conn_bps: 2 * MB, ..Server::default() }, pc).await;
        assert!(mbps >= 20.0 && peak == 16, "per-connection cap: {:.1} MB/s, {} connections", mbps, peak);

        // The site caps each visitor at 12 MB/s: extra connections don't help, so it settles low.
        let opts = Server { per_conn_bps: 3 * MB, total_bps: 12 * MB, ..Server::default() };
        let (mbps, peak, meter) = bench("per-visitor cap", sample(64 << 20), opts, pc).await;
        assert!(mbps >= 10.0, "per-visitor cap: {:.1} MB/s", mbps);
        assert!(meter.settled.load(Ordering::Relaxed) <= 8 && peak <= 16, "settled at {}", meter.settled.load(Ordering::Relaxed));

        // Every 7th request dies halfway.
        let opts = Server { per_conn_bps: 4 * MB, flaky: true, ..Server::default() };
        let (mbps, _, _) = bench("flaky", sample(48 << 20), opts, pc).await;
        assert!(mbps >= 20.0, "flaky: {:.1} MB/s", mbps);

        // The site answers "busy" past 4 connections.
        let opts = Server { per_conn_bps: 3 * MB, max_conns: 4, ..Server::default() };
        let (mbps, _, meter) = bench("connection limit", sample(48 << 20), opts, pc).await;
        assert!(mbps >= 9.0 && meter.pushback.load(Ordering::Relaxed), "connection limit: {:.1} MB/s", mbps);

        // The network drops for 3 s mid-download: about 3 s plus one retry are lost, nothing more.
        let opts = Server { per_conn_bps: 2 * MB, down: Some((Duration::from_secs(2), Duration::from_secs(5))), ..Server::default() };
        let started = Instant::now();
        bench("network drop", sample(64 << 20), opts, pc).await;
        let lost = started.elapsed().as_secs_f64() - 64.0 * 1.048_576 / 32.0;
        println!("engine_bench {:<24} {:>7.1} s lost", "network drop (lost)", lost);
        assert!(lost < 7.5, "network drop cost {:.1} s", lost);

        // A 5 MB/s speed limit holds across all connections.
        bandwidth::set(bandwidth::SpeedLimit::Fixed { bytes_per_sec: 5 * MB });
        let (mbps, _, _) = bench("speed limit 5 MB/s", sample(40 << 20), Server::default(), pc).await;
        bandwidth::set(bandwidth::SpeedLimit::Off);
        assert!((4.4..5.6).contains(&mbps), "speed limit: {:.1} MB/s", mbps);
    }

    #[test]
    fn site_records_shape_the_next_download() {
        let file = std::env::temp_dir().join(format!("hs-sites-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&file);
        let base = Limits { start: 8, max: 16 };
        let url = "https://rr3---sn-abc.googlevideo.com/videoplayback?x=1";
        assert_eq!(limits_for(base, url, &file).start, 8);

        let meter = Meter::default();
        meter.settled.store(4, Ordering::Relaxed);
        remember_site(url, &meter, &file);
        let l = limits_for(base, "https://rr5---sn-def.googlevideo.com/other", &file);
        assert_eq!((l.start, l.max), (4, 16));

        let refused = Meter::default();
        refused.pushback.store(true, Ordering::Relaxed);
        refused.connections.store(2, Ordering::Relaxed);
        remember_site(url, &refused, &file);
        let l = limits_for(base, url, &file);
        assert_eq!((l.start, l.max), (2, 2));
        assert_eq!(site_of("https://files.example.co.uk/a").as_deref(), Some("example.co.uk"));
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn fair_shares() {
        // Alone: everything. Two from one site: half each. Five from different sites: under twice the limit together.
        assert_eq!(fair_share(16, 1, 1), 16);
        assert_eq!(fair_share(16, 2, 2), 8);
        assert_eq!(fair_share(16, 1, 5), 6);
        assert_eq!(fair_share(4, 9, 9), 1);
        assert_eq!(site_of("http://127.0.0.1:8787/a").as_deref(), Some("127.0.0.1:8787"));
    }

    #[test]
    fn content_range_parsing() {
        assert_eq!(total_from_content_range("bytes 0-0/12345"), Some(12345));
        assert_eq!(start_from_content_range("bytes 500-999/12345"), Some(500));
        assert_eq!(total_from_content_range("bytes 0-0/*"), None);
    }

    #[test]
    fn cookie_header_drops_attributes() {
        assert_eq!(
            cookie_header("a=1; Domain=.x.com; Path=/; Secure; Expires=123; b=two").as_deref(),
            Some("a=1; b=two")
        );
        assert_eq!(cookie_header("Domain=.x.com; Path=/"), None);
    }
}
