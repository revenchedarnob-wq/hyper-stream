//! Multi-connection downloader for direct media and file links.
//!
//! Many servers cap the speed of each connection, so one file is fetched over several
//! connections at once. A connection that runs out of work takes half of the biggest
//! unfinished range (no idle connections near the end), and connections are added in
//! steps for as long as each step still raises the total speed.
//!
//! Anything this engine can't handle (no range support, expired links, repeated errors)
//! comes back as `TurboError::Fallback` so the caller can use the regular downloader.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE};

/// Bytes collected per connection before they are written to disk.
const WRITE_BUFFER: usize = 512 * 1024;
/// A range is only split when both halves get at least this much.
const MIN_SPLIT: u64 = 1024 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// Consecutive failures of one range before giving up on this engine.
const MAX_FAILURES: u32 = 6;
/// With no new data for this long, hand the download to the regular downloader.
const STALL_LIMIT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct Stream {
    pub url: String,
    pub headers: Vec<(String, String)>,
    /// Size reported by the site, if any. The first request confirms it either way.
    pub size: Option<u64>,
    pub dest: PathBuf,
    /// Largest range a single request may ask for. YouTube serves larger requests at a crawl.
    pub max_request: Option<u64>,
}

#[derive(Debug, PartialEq)]
pub enum TurboError {
    /// Paused or cancelled; partial data and resume state are kept.
    Aborted,
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

/// "rr3---sn-abc.googlevideo.com" -> "googlevideo.com"
fn site_of(url: &str) -> Option<String> {
    let host = reqwest::Url::parse(url).ok()?.host_str()?.to_ascii_lowercase();
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
    if !pushback && settled == 0 {
        return; // too short to learn anything
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

/// Where the data goes while downloading, and its resume record.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".hspart");
    PathBuf::from(s)
}

fn state_path(dest: &Path) -> PathBuf {
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

struct Job {
    client: reqwest::Client,
    streams: Vec<OpenStream>,
    ranges: Mutex<Vec<Arc<Range>>>,
    meter: Arc<Meter>,
    cancel: Arc<AtomicBool>,
    fatal: Mutex<Option<String>>,
    active: AtomicUsize,
    /// Connections wanted right now; lowered when the server pushes back.
    target: AtomicUsize,
}

enum Attempt {
    /// Some bytes arrived (the range may or may not be finished).
    Progress,
    /// Nothing arrived; worth retrying.
    Retry(String),
    /// The server is overloaded or rate limiting.
    Busy,
    /// Retrying won't help.
    Fatal(String),
}

fn client() -> Result<reqwest::Client, String> {
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

fn header_map(pairs: &[(String, String)]) -> HeaderMap {
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

fn is_expired_status(status: u16) -> bool {
    matches!(status, 401 | 403 | 404 | 410)
}

#[cfg(windows)]
fn write_at(file: &std::fs::File, mut offset: u64, mut data: &[u8]) -> std::io::Result<()> {
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
fn write_at(file: &std::fs::File, offset: u64, data: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(data, offset)
}

/// Asks for the first byte: confirms range support, the real size and the final URL.
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

async fn probe(client: &reqwest::Client, stream: &Stream, headers: &HeaderMap) -> Result<Probed, TurboError> {
    let mut last = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * attempt)).await;
        }
        let response = match client.get(&stream.url).headers(headers.clone()).header(RANGE, "bytes=0-0").send().await {
            Ok(r) => r,
            Err(e) => {
                last = e.to_string();
                continue;
            }
        };
        let status = response.status().as_u16();
        if status == 206 {
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
        if status == 200 {
            return Err(TurboError::Fallback("server doesn't support ranges".into()));
        }
        if is_expired_status(status) {
            return Err(TurboError::Fallback(format!("link refused ({})", status)));
        }
        last = format!("HTTP {}", status);
    }
    Err(TurboError::Fallback(format!("probe failed: {}", last)))
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
        self.cancel.load(Ordering::Relaxed) || self.fatal.lock().unwrap().is_some()
    }

    fn fail(&self, reason: String) {
        self.fatal.lock().unwrap().get_or_insert(reason);
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

    fn over_target(&self) -> bool {
        self.active.load(Ordering::Relaxed) > self.target.load(Ordering::Relaxed).max(1)
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
        let request = self
            .client
            .get(&stream.url)
            .headers(stream.headers.clone())            .header(RANGE, format!("bytes={}-{}", pos, request_end - 1));
        // If the file changed since the first request, the server sends all of it (200)
        // instead of mixing new bytes into the old file; that ends this engine's attempt.
        let request = match &stream.validator {
            Some(v) => request.header(IF_RANGE, v.as_str()),
            None => request,
        };
        let response = match request
            .send()
            .await
        {
            Ok(r) => r,
            // Refused or unanswered connections mean the server wants fewer of them.
            Err(e) if e.is_connect() || e.is_timeout() => return Attempt::Busy,
            Err(e) => return Attempt::Retry(e.to_string()),
        };
        let status = response.status().as_u16();
        match status {
            206 => {}
            429 | 503 => return Attempt::Busy,
            s if is_expired_status(s) => return Attempt::Fatal(format!("link refused ({})", s)),
            200 => return Attempt::Fatal("server ignored the range request".into()),
            s => return Attempt::Retry(format!("HTTP {}", s)),
        }
        let started_at = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()).and_then(start_from_content_range);
        if started_at != Some(pos) {
            return Attempt::Fatal("server answered with the wrong range".into());
        }

        let mut response = response;
        let mut at = pos;
        let mut got_any = false;
        loop {
            if self.stopped() || self.over_target() {
                break;
            }
            let chunk = match tokio::time::timeout(READ_TIMEOUT, response.chunk()).await {
                Ok(Ok(Some(c))) => c,
                Ok(Ok(None)) => break,
                Ok(Err(e)) => {
                    if let Err(e) = self.flush(stream, range, at, buf).await {
                        return Attempt::Fatal(e);
                    }
                    return if got_any { Attempt::Progress } else { Attempt::Retry(e.to_string()) };
                }
                Err(_) => {
                    if let Err(e) = self.flush(stream, range, at, buf).await {
                        return Attempt::Fatal(e);
                    }
                    return if got_any { Attempt::Progress } else { Attempt::Retry("no data for 20 s".into()) };
                }
            };
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
                // Dropping the response mid-body closes the connection; fine when the range was cut short.
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
                        if self.should_retire() {
                            range.busy.store(false, Ordering::Release);
                            return;
                        }
                    }
                    Attempt::Retry(reason) => {
                        failures += 1;
                        if failures >= MAX_FAILURES {
                            self.fail(reason);
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(300 * (1 << failures.min(4)))).await;
                    }
                    Attempt::Busy => {
                        // Too many connections for this server: shed one and back off.
                        self.meter.pushback.store(true, Ordering::Relaxed);
                        let t = self.target.load(Ordering::Relaxed);
                        if t > 1 {
                            let _ = self.target.compare_exchange(t, t - 1, Ordering::AcqRel, Ordering::Relaxed);
                        }
                        failures += 1;
                        if failures >= MAX_FAILURES * 2 {
                            self.fail("server kept refusing connections".into());
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(1000 * failures.min(5) as u64)).await;
                        range.busy.store(false, Ordering::Release);
                        if self.should_retire() {
                            return;
                        }
                        continue 'claim;
                    }
                    Attempt::Fatal(reason) => {
                        self.fail(reason);
                        break;
                    }
                }
            }
            range.busy.store(false, Ordering::Release);
        }
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

fn spawn_worker(job: &Arc<Job>, set: &mut tokio::task::JoinSet<()>) {
    job.active.fetch_add(1, Ordering::AcqRel);
    set.spawn(job.clone().work());
}

/// Downloads every stream into its `dest`. Streams share one pool of connections.
pub async fn download(streams: Vec<Stream>, limits: Limits, meter: Arc<Meter>, cancel: Arc<AtomicBool>) -> Result<(), TurboError> {
    let client = client().map_err(TurboError::Fallback)?;

    let mut open = Vec::new();
    let mut ranges = Vec::new();
    let mut total = 0u64;
    let mut done = 0u64;
    for (i, s) in streams.iter().enumerate() {
        let headers = header_map(&s.headers);
        let Probed { url, size, validator } = probe(&client, s, &headers).await?;
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
        fatal: Mutex::new(None),
        active: AtomicUsize::new(0),
        target: AtomicUsize::new(limits.start.max(1)),
    });

    let mut set = tokio::task::JoinSet::new();
    let small = total.saturating_sub(done) < 4 * MIN_SPLIT;
    let first = if small { 1 } else { limits.start.max(1) };
    job.target.store(first, Ordering::Relaxed);
    for _ in 0..first {
        spawn_worker(&job, &mut set);
    }

    // Ramp up: double the connections while each doubling raises the speed by 20%+. Speed is
    // measured over 1.5 s, starting 0.5 s after a change so connection setup doesn't count. A step
    // that didn't help is undone: extra connections then only cost the server and this PC.
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ticks = 0u32;
    let mut ramping = !small && limits.max > first;
    let mut settle_until = std::time::Instant::now() + Duration::from_millis(500);
    let mut window: Option<(std::time::Instant, u64)> = None;
    let mut previous_level: Option<(usize, f64)> = None;
    let mut last_done = meter.done.load(Ordering::Relaxed);
    let mut last_progress = std::time::Instant::now();
    loop {
        tokio::select! {
            joined = set.join_next() => {
                if joined.is_none() {
                    break;
                }
                // A worker left early (server pushback): let others keep the remaining work going.
                let has_work = job.ranges.lock().unwrap().iter().any(|r| !r.busy.load(Ordering::Acquire) && r.remaining() > 0);
                if has_work && !job.stopped() && job.active.load(Ordering::Acquire) == 0 {
                    spawn_worker(&job, &mut set);
                }
            }
            _ = tick.tick() => {
                ticks += 1;
                meter.connections.store(job.active.load(Ordering::Relaxed), Ordering::Relaxed);
                let done_now = meter.done.load(Ordering::Relaxed);
                if done_now != last_done {
                    last_done = done_now;
                    last_progress = std::time::Instant::now();
                } else if last_progress.elapsed() > STALL_LIMIT {
                    job.fail("no data for 30 s".into());
                }
                if ticks % 4 == 0 {
                    job.save_state();
                }
                let now = std::time::Instant::now();
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
                                let next = (current * 2).min(limits.max);
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

    let fatal = job.fatal.lock().unwrap().clone();
    let streams_done = job.snapshot().iter().all(|r| r.is_empty());
    if let Some(reason) = fatal {
        job.save_state();
        return Err(TurboError::Fallback(reason));
    }
    if cancel.load(Ordering::Relaxed) || !streams_done {
        job.save_state();
        return Err(if cancel.load(Ordering::Relaxed) { TurboError::Aborted } else { TurboError::Fallback("unfinished ranges".into()) });
    }

    let job = Arc::try_unwrap(job).map_err(|_| TurboError::Fallback("engine still busy".into()))?;
    for s in job.streams {
        let OpenStream { file, dest, .. } = s;
        if let Ok(f) = Arc::try_unwrap(file) {
            let _ = f.sync_data();
            drop(f);
        }
        let part = part_path(&dest);
        let _ = std::fs::remove_file(&dest);
        std::fs::rename(&part, &dest).map_err(|e| TurboError::Fallback(format!("Couldn't finish {}: {}", dest.display(), e)))?;
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
        .map_err(|e| TurboError::Fallback(e.to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(TurboError::Fallback(format!("HTTP {}", status)));
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
            Ok(Err(e)) => return Err(TurboError::Fallback(e.to_string())),
            Err(_) => return Err(TurboError::Fallback("no data for 20 s".into())),
        };
        let finished = chunk.is_none();
        if let Some(c) = chunk {
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
        return Err(TurboError::Fallback(format!("connection ended early ({} of {} bytes)", at, total)));
    }
    if total == 0 {
        meter.total.store(at, Ordering::Relaxed);
    }
    drop(file);
    let _ = std::fs::remove_file(&stream.dest);
    std::fs::rename(&part, &stream.dest).map_err(|e| TurboError::Fallback(format!("Couldn't finish {}: {}", stream.dest.display(), e)))
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

    /// A tiny HTTP/1.1 server with range support, a per-connection speed cap,
    /// and an optional cap on how many bytes one request may ask for.
    async fn serve(data: Arc<Vec<u8>>, ranges: bool, per_conn_bps: u64, flaky: bool) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let data = data.clone();
                let counter = counter.clone();
                tokio::spawn(async move {
                    loop {
                        let mut head = Vec::new();
                        let mut byte = [0u8; 1];
                        while !head.ends_with(b"\r\n\r\n") {
                            match sock.read(&mut byte).await {
                                Ok(1) => head.push(byte[0]),
                                _ => return,
                            }
                        }
                        let n = counter.fetch_add(1, Ordering::SeqCst);
                        let text = String::from_utf8_lossy(&head).to_ascii_lowercase();
                        let range = text
                            .lines()
                            .find_map(|l| l.strip_prefix("range: bytes="))
                            .and_then(|r| r.split_once('-'))
                            .map(|(a, b)| (a.trim().parse::<u64>().unwrap(), b.trim().parse::<u64>().ok()));
                        let len = data.len() as u64;
                        let (status, start, end) = match (ranges, range) {
                            (true, Some((a, b))) => ("206 Partial Content", a, b.map_or(len, |b| (b + 1).min(len))),
                            _ => ("200 OK", 0, len),
                        };
                        let mut header = format!("HTTP/1.1 {}\r\nContent-Length: {}\r\n", status, end - start);
                        if status.starts_with("206") {
                            header.push_str(&format!("Content-Range: bytes {}-{}/{}\r\n", start, end - 1, len));
                        }
                        header.push_str("\r\n");
                        if sock.write_all(header.as_bytes()).await.is_err() {
                            return;
                        }
                        let body = &data[start as usize..end as usize];
                        // Every 7th request dies halfway through.
                        let cut = flaky && n % 7 == 3 && body.len() > 2;
                        let body = if cut { &body[..body.len() / 2] } else { body };
                        for piece in body.chunks(16 * 1024) {
                            if sock.write_all(piece).await.is_err() {
                                return;
                            }
                            if per_conn_bps > 0 {
                                tokio::time::sleep(Duration::from_secs_f64(piece.len() as f64 / per_conn_bps as f64)).await;
                            }
                        }
                        if cut {
                            return;
                        }
                    }
                });
            }
        });
        (format!("http://{}/file", addr), requests)
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
        Stream { url: url.into(), headers: vec![("User-Agent".into(), "test".into())], size: None, dest: dest.into(), max_request }
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
        let (url, requests) = serve(data.clone(), true, 0, true).await;
        let dest = temp_dest("flaky.bin");
        download(vec![stream(&url, &dest, Some(MIN_SPLIT))], Limits { start: 4, max: 8 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), *data);
        // 1 MiB request cap on 6 MiB: at least 7 requests including the probe.
        assert!(requests.load(Ordering::SeqCst) >= 7);
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
