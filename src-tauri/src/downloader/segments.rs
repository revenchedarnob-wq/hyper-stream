//! Streamed video (HLS and DASH): a playlist of many small pieces.
//!
//! The regular downloader fetches pieces a few at a time in Python and writes each to its own
//! file before joining them. Here several connections fetch pieces at once and a writer puts
//! them straight into one file, in order. Pieces that arrive early wait in memory, within a
//! budget, so a slow piece can't fill the PC's memory.
//!
//! Anything unusual (encrypted or live playlists, advert markers, a playlist inside a
//! playlist) comes back as `TurboError::Fallback` and yt-dlp does it as before.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, RANGE};

use crate::downloader::bandwidth;
use crate::downloader::turbo::{self, Limits, Meter, SendFailure, Stream, TurboError};

/// Where a stream's pieces are listed.
#[derive(Debug, Clone, PartialEq)]
pub enum Pieces {
    /// An HLS media playlist (`.m3u8`) to read.
    Hls(String),
    /// DASH pieces already listed by the site (first one: the stream's header).
    Dash(Vec<String>),
}

#[derive(Debug, Clone, PartialEq)]
struct Piece {
    url: String,
    /// (offset, length) inside `url`.
    range: Option<(u64, u64)>,
}

/// `KEY=VALUE,KEY="quoted, value"` -> value of `key`.
fn attribute(attrs: &str, key: &str) -> Option<String> {
    let mut rest = attrs;
    while !rest.is_empty() {
        let (name, after) = rest.split_once('=')?;
        let (value, next) = if let Some(quoted) = after.strip_prefix('"') {
            let end = quoted.find('"')?;
            (&quoted[..end], quoted[end + 1..].trim_start_matches(','))
        } else {
            after.split_once(',').unwrap_or((after, ""))
        };
        if name.trim().eq_ignore_ascii_case(key) {
            return Some(value.to_string());
        }
        rest = next;
    }
    None
}

/// "1000@200" -> (Some(200), 1000)
fn byte_range(value: &str) -> Option<(Option<u64>, u64)> {
    let (len, offset) = match value.split_once('@') {
        Some((l, o)) => (l, Some(o.trim().parse().ok()?)),
        None => (value, None),
    };
    Some((offset, len.trim().parse().ok()?))
}

/// The pieces of an HLS media playlist, in order. `Err` says why this engine won't do it.
fn parse_hls(text: &str, base: &reqwest::Url) -> Result<Vec<Piece>, String> {
    if !text.trim_start().starts_with("#EXTM3U") {
        return Err("not a playlist".into());
    }
    let mut pieces = Vec::new();
    let mut header: Option<Piece> = None;
    let mut next_range: Option<(Option<u64>, u64)> = None;
    // Where the previous range in each file ended: a range without an offset continues there.
    let mut ends: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut ended = false;
    let resolve = |uri: &str| base.join(uri).map(|u| u.to_string()).map_err(|_| format!("bad address {}", uri));
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            if !attribute(attrs, "METHOD").is_some_and(|m| m.eq_ignore_ascii_case("NONE")) {
                return Err("encrypted stream".into());
            }
        } else if line.starts_with("#EXT-X-SESSION-KEY") {
            return Err("encrypted stream".into());
        } else if line.starts_with("#EXT-X-STREAM-INF") {
            return Err("a list of playlists".into());
        } else if ["#EXT-X-GAP", "#EXT-X-PART:", "#UPLYNK-SEGMENT", "#ANVATO-SEGMENT-INFO"].iter().any(|t| line.starts_with(t)) {
            return Err("unsupported playlist feature".into());
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            let uri = attribute(attrs, "URI").ok_or("header without address")?;
            let url = resolve(&uri)?;
            let range = match attribute(attrs, "BYTERANGE") {
                Some(r) => {
                    let (offset, len) = byte_range(&r).ok_or("bad byte range")?;
                    Some((offset.unwrap_or(0), len))
                }
                None => None,
            };
            let map = Piece { url, range };
            match &header {
                // Streams that switch headers midway need yt-dlp.
                Some(existing) if *existing != map => return Err("changing stream header".into()),
                Some(_) => {}
                None => {
                    if !pieces.is_empty() {
                        return Err("stream header after pieces".into());
                    }
                    pieces.push(map.clone());
                    header = Some(map);
                }
            }
        } else if let Some(value) = line.strip_prefix("#EXT-X-BYTERANGE:") {
            next_range = Some(byte_range(value).ok_or("bad byte range")?);
        } else if line.starts_with("#EXT-X-ENDLIST") {
            ended = true;
        } else if !line.starts_with('#') {
            let url = resolve(line)?;
            let range = next_range.take().map(|(offset, len)| (offset.unwrap_or_else(|| ends.get(&url).copied().unwrap_or(0)), len));
            if let Some((offset, len)) = range {
                ends.insert(url.clone(), offset + len);
            }
            pieces.push(Piece { url, range });
        }
    }
    if !ended {
        return Err("live stream".into());
    }
    if pieces.len() <= usize::from(header.is_some()) {
        return Err("empty playlist".into());
    }
    Ok(pieces)
}

/// Identifies a list of pieces across visits (addresses change their tokens, not their paths).
fn list_id(pieces: &[Piece]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for p in pieces {
        p.url.split('?').next().hash(&mut h);
        p.range.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedProgress {
    list: String,
    /// Pieces written to the file, from the start.
    pieces: usize,
    bytes: u64,
}

fn load_progress(dest: &Path, list: &str) -> Option<(usize, u64)> {
    let saved: SavedProgress = serde_json::from_slice(&std::fs::read(turbo::state_path(dest)).ok()?).ok()?;
    let on_disk = std::fs::metadata(turbo::part_path(dest)).ok()?.len();
    (saved.list == list && on_disk >= saved.bytes).then_some((saved.pieces, saved.bytes))
}

struct Output {
    pieces: Vec<Piece>,
    headers: HeaderMap,
    file: Arc<std::fs::File>,
    dest: PathBuf,
    list: String,
    /// Next piece to write, and where it goes.
    written: AtomicUsize,
    written_bytes: AtomicU64,
    /// Pieces that arrived before their turn.
    early: Mutex<BTreeMap<usize, Vec<u8>>>,
    writer: tokio::sync::Mutex<()>,
}

struct Job {
    client: reqwest::Client,
    outputs: Vec<Output>,
    /// (output, piece) not yet taken, in order.
    queue: Mutex<VecDeque<(usize, usize)>>,
    /// Bytes waiting in `early` across outputs.
    held: AtomicU64,
    budget: u64,
    meter: Arc<Meter>,
    cancel: Arc<AtomicBool>,
    stop: Mutex<Option<TurboError>>,
    /// Finished pieces and their bytes, for estimating the total size.
    fetched_pieces: AtomicUsize,
    fetched_bytes: AtomicU64,
    /// Connections running, and how many are wanted.
    active: AtomicUsize,
    target: AtomicUsize,
}

impl Job {
    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::Relaxed) || self.stop.lock().unwrap().is_some()
    }

    /// Leaves when more connections run than are wanted (exactly the extra ones leave).
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

    fn pieces_left(&self) -> usize {
        self.queue.lock().unwrap().len()
    }

    fn stop_with(&self, e: TurboError) {
        self.stop.lock().unwrap().get_or_insert(e);
    }

    /// The next piece to fetch. Pieces far ahead of the writer wait while memory is full,
    /// except the one the writer needs next.
    async fn claim(&self) -> Option<(usize, usize)> {
        loop {
            if self.stopped() {
                return None;
            }
            {
                let mut queue = self.queue.lock().unwrap();
                let &(o, i) = queue.front()?;
                let next_to_write = self.outputs[o].written.load(Ordering::Acquire) == i;
                if next_to_write || self.held.load(Ordering::Acquire) < self.budget {
                    queue.pop_front();
                    return Some((o, i));
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Gets one piece, retrying through server errors and network drops.
    async fn fetch(&self, o: usize, i: usize) -> Result<Vec<u8>, TurboError> {
        let out = &self.outputs[o];
        let piece = &out.pieces[i];
        let mut failures = 0u32;
        let mut offline_since: Option<Instant> = None;
        loop {
            if self.stopped() {
                return Err(TurboError::Aborted);
            }
            let mut request = self.client.get(&piece.url).headers(out.headers.clone());
            if let Some((offset, len)) = piece.range {
                request = request.header(RANGE, format!("bytes={}-{}", offset, offset + len - 1));
            }
            let mut wait = None;
            match tokio::time::timeout(turbo::READ_TIMEOUT, request.send()).await {
                Ok(Ok(response)) => {
                    offline_since = None;
                    self.meter.waiting.store(false, Ordering::Relaxed);
                    let status = response.status().as_u16();
                    match status {
                        200 if piece.range.is_none() => {}
                        206 if piece.range.is_some() => {}
                        200 => return Err(TurboError::Fallback("server ignored the range request".into())),
                        s if turbo::is_expired_status(s) => return Err(TurboError::Expired(format!("link refused ({})", s))),
                        s if turbo::is_temporary_status(s) => wait = Some(format!("HTTP {}", s)),
                        s => return Err(TurboError::Fallback(format!("HTTP {}", s))),
                    }
                    if wait.is_none() {
                        match self.read_body(response).await {
                            Ok(data) => return Ok(data),
                            Err(reason) => wait = Some(reason),
                        }
                    }
                }
                Ok(Err(e)) if turbo::send_failure(&e) != SendFailure::Refused => {
                    let since = *offline_since.get_or_insert_with(Instant::now);
                    if since.elapsed() > turbo::OFFLINE_LIMIT {
                        return Err(TurboError::Interrupted("no internet connection".into()));
                    }
                    self.meter.waiting.store(true, Ordering::Relaxed);
                    turbo::nap(&self.cancel, turbo::OFFLINE_RETRY).await;
                    continue;
                }
                Ok(Err(e)) => wait = Some(e.to_string()),
                Err(_) => wait = Some("no answer".into()),
            }
            failures += 1;
            if failures >= turbo::MAX_FAILURES {
                return Err(TurboError::Interrupted(wait.unwrap_or_default()));
            }
            turbo::nap(&self.cancel, Duration::from_millis(300 * (1 << failures.min(4)))).await;
        }
    }

    async fn read_body(&self, mut response: reqwest::Response) -> Result<Vec<u8>, String> {
        let mut data = Vec::with_capacity(response.content_length().unwrap_or(0).min(64 << 20) as usize);
        loop {
            match tokio::time::timeout(turbo::READ_TIMEOUT, response.chunk()).await {
                Ok(Ok(Some(chunk))) => {
                    bandwidth::take(chunk.len()).await;
                    self.meter.done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
                    data.extend_from_slice(&chunk);
                }
                Ok(Ok(None)) => return Ok(data),
                failed => {
                    // The piece starts over: take back what was counted.
                    self.meter.done.fetch_sub(data.len() as u64, Ordering::Relaxed);
                    return Err(match failed {
                        Ok(Err(e)) => e.to_string(),
                        _ => "no data".into(),
                    });
                }
            }
            if self.stopped() {
                self.meter.done.fetch_sub(data.len() as u64, Ordering::Relaxed);
                return Err("stopped".into());
            }
        }
    }

    /// Files piece `i` and writes every piece that is now in order.
    async fn deliver(&self, o: usize, i: usize, data: Vec<u8>) -> Result<(), TurboError> {
        let out = &self.outputs[o];
        self.fetched_pieces.fetch_add(1, Ordering::Relaxed);
        self.fetched_bytes.fetch_add(data.len() as u64, Ordering::Relaxed);
        self.held.fetch_add(data.len() as u64, Ordering::AcqRel);
        out.early.lock().unwrap().insert(i, data);
        let _turn = out.writer.lock().await;
        loop {
            let next = out.written.load(Ordering::Acquire);
            let Some(data) = out.early.lock().unwrap().remove(&next) else { return Ok(()) };
            let at = out.written_bytes.load(Ordering::Acquire);
            let file = out.file.clone();
            let len = data.len() as u64;
            tokio::task::spawn_blocking(move || turbo::write_at(&file, at, &data))
                .await
                .map_err(|e| TurboError::Fallback(e.to_string()))?
                .map_err(|e| TurboError::Fallback(format!("Couldn't write to disk: {}", e)))?;
            self.held.fetch_sub(len, Ordering::AcqRel);
            out.written_bytes.store(at + len, Ordering::Release);
            out.written.store(next + 1, Ordering::Release);
        }
    }

    async fn work(self: Arc<Self>) {
        if !self.work_until_done().await {
            self.active.fetch_sub(1, Ordering::AcqRel);
        }
    }

    /// True when this connection left because fewer are wanted (already counted out).
    async fn work_until_done(&self) -> bool {
        loop {
            if self.should_retire() {
                return true;
            }
            let Some((o, i)) = self.claim().await else { return false };
            match self.fetch(o, i).await {
                Ok(data) => {
                    if let Err(e) = self.deliver(o, i, data).await {
                        self.stop_with(e);
                    }
                }
                Err(TurboError::Aborted) => return false,
                Err(e) => {
                    self.stop_with(e);
                    return false;
                }
            }
        }
    }

    fn spawn_worker(self: &Arc<Self>, set: &mut tokio::task::JoinSet<()>) {
        self.active.fetch_add(1, Ordering::AcqRel);
        set.spawn(self.clone().work());
    }

    fn save_progress(&self) {
        for out in &self.outputs {
            // Read together under the writer's lock would be exact; a piece written between the
            // two reads only means it is fetched again.
            let pieces = out.written.load(Ordering::Acquire);
            let bytes = out.written_bytes.load(Ordering::Acquire);
            let saved = SavedProgress { list: out.list.clone(), pieces, bytes };
            if let Ok(json) = serde_json::to_vec(&saved) {
                let path = turbo::state_path(&out.dest);
                let tmp = path.with_extension("json.tmp");
                if std::fs::write(&tmp, json).is_ok() {
                    let _ = std::fs::rename(&tmp, &path);
                }
            }
        }
    }

    fn all_written(&self) -> bool {
        self.outputs.iter().all(|o| o.written.load(Ordering::Acquire) == o.pieces.len())
    }
}

async fn list_pieces(client: &reqwest::Client, stream: &Stream, pieces: &Pieces, headers: &HeaderMap) -> Result<Vec<Piece>, TurboError> {
    match pieces {
        Pieces::Dash(urls) => Ok(urls.iter().map(|url| Piece { url: url.clone(), range: None }).collect()),
        Pieces::Hls(playlist) => {
            let mut last = String::new();
            for attempt in 0..3u64 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
                }
                let response = match tokio::time::timeout(turbo::READ_TIMEOUT, client.get(playlist).headers(headers.clone()).send()).await {
                    Ok(Ok(r)) => r,
                    Ok(Err(e)) => {
                        last = e.to_string();
                        continue;
                    }
                    Err(_) => {
                        last = "no answer".into();
                        continue;
                    }
                };
                let status = response.status().as_u16();
                if turbo::is_expired_status(status) {
                    return Err(TurboError::Expired(format!("link refused ({})", status)));
                }
                if status != 200 {
                    last = format!("HTTP {}", status);
                    continue;
                }
                let base = response.url().clone();
                let text = response.text().await.map_err(|e| TurboError::Interrupted(e.to_string()))?;
                return parse_hls(&text, &base).map_err(|why| {
                    log::info!("segments: {} for {}", why, stream.dest.display());
                    TurboError::Fallback(why)
                });
            }
            Err(TurboError::Interrupted(format!("couldn't read the playlist: {}", last)))
        }
    }
}

/// Downloads every stream (each with `pieces` set) into its `dest`. They share connections.
pub async fn download(streams: Vec<Stream>, limits: Limits, meter: Arc<Meter>, cancel: Arc<AtomicBool>) -> Result<(), TurboError> {
    let client = turbo::client().map_err(TurboError::Fallback)?;
    let share = turbo::Registration::new(streams.first().and_then(|s| turbo::site_of(&s.url)));

    let mut outputs = Vec::new();
    let mut queue = VecDeque::new();
    let mut resumed_bytes = 0u64;
    let mut hinted = 0u64;
    for (o, s) in streams.iter().enumerate() {
        let pieces_of = s.pieces.as_ref().ok_or_else(|| TurboError::Fallback("not a streamed format".into()))?;
        let headers = turbo::header_map(&s.headers);
        let pieces = list_pieces(&client, s, pieces_of, &headers).await?;
        let list = list_id(&pieces);
        let part = turbo::part_path(&s.dest);
        let (start, bytes) = load_progress(&s.dest, &list).unwrap_or((0, 0));
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(start == 0)
            .open(&part)
            .map_err(|e| TurboError::Fallback(format!("Couldn't create {}: {}", part.display(), e)))?;
        // Anything after the saved point was written by pieces that are fetched again.
        file.set_len(bytes).map_err(|e| TurboError::Fallback(e.to_string()))?;
        resumed_bytes += bytes;
        hinted += s.size.unwrap_or(0);
        queue.extend((start..pieces.len()).map(|i| (o, i)));
        outputs.push(Output {
            pieces,
            headers,
            file: Arc::new(file),
            dest: s.dest.clone(),
            list,
            written: AtomicUsize::new(start),
            written_bytes: AtomicU64::new(bytes),
            early: Mutex::new(BTreeMap::new()),
            writer: tokio::sync::Mutex::new(()),
        });
    }
    let total_pieces: usize = outputs.iter().map(|o| o.pieces.len()).sum();
    let start_pieces: usize = outputs.iter().map(|o| o.written.load(Ordering::Relaxed)).sum();
    meter.done.store(resumed_bytes, Ordering::Relaxed);
    meter.total.store(hinted.max(resumed_bytes), Ordering::Relaxed);

    let ceiling = share.fair_share(limits.max);
    let connections = limits.start.clamp(1, ceiling).min(queue.len().max(1));
    // Memory for pieces that arrive ahead of their turn: a few per connection.
    let budget = if crate::browser::is_low_memory_pc() { 24 << 20 } else { 64 << 20 };
    let job = Arc::new(Job {
        client,
        outputs,
        queue: Mutex::new(queue),
        held: AtomicU64::new(0),
        budget,
        meter: meter.clone(),
        cancel: cancel.clone(),
        stop: Mutex::new(None),
        fetched_pieces: AtomicUsize::new(0),
        fetched_bytes: AtomicU64::new(0),
        active: AtomicUsize::new(0),
        target: AtomicUsize::new(connections),
    });
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..connections {
        job.spawn_worker(&mut set);
    }

    // Each piece waits for the server to answer, so more connections usually help until the
    // line or the server is full. Double while that raises the speed by 20%+ (measured over
    // 2 s, after 0.5 s for new connections to start); undo a step that didn't.
    let mut ramping = limits.max.min(ceiling) > connections;
    let mut settle_until = Instant::now() + Duration::from_millis(500);
    let mut window: Option<(Instant, u64)> = None;
    let mut previous: Option<(usize, f64)> = None;

    let mut tick = tokio::time::interval(Duration::from_millis(500));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut ticks = 0u32;
    let mut last_done = meter.done.load(Ordering::Relaxed);
    let mut last_progress = Instant::now();
    loop {
        tokio::select! {
            joined = set.join_next() => {
                if joined.is_none() {
                    break;
                }
            }
            _ = tick.tick() => {
                ticks += 1;
                // The size isn't listed: estimate it from the pieces so far.
                let (pieces, bytes) = (job.fetched_pieces.load(Ordering::Relaxed), job.fetched_bytes.load(Ordering::Relaxed));
                if pieces >= 3 {
                    let left = total_pieces.saturating_sub(start_pieces + pieces) as u64;
                    let estimate = meter.done.load(Ordering::Relaxed) + bytes / pieces as u64 * left;
                    meter.total.store(estimate, Ordering::Relaxed);
                }
                let done = meter.done.load(Ordering::Relaxed);
                if done != last_done || meter.waiting.load(Ordering::Relaxed) {
                    last_done = done;
                    last_progress = Instant::now();
                } else if last_progress.elapsed() > turbo::STALL_LIMIT {
                    job.stop_with(TurboError::Interrupted("no data".into()));
                }
                if ticks % 4 == 0 {
                    job.save_progress();
                }
                meter.connections.store(job.active.load(Ordering::Relaxed), Ordering::Relaxed);
                let now = Instant::now();
                if meter.waiting.load(Ordering::Relaxed) {
                    window = None;
                    settle_until = now + Duration::from_millis(500);
                }
                if ramping && now >= settle_until {
                    match window {
                        None => window = Some((now, done)),
                        Some((since, at)) if now.duration_since(since) >= Duration::from_secs(2) => {
                            let rate = done.saturating_sub(at) as f64 / now.duration_since(since).as_secs_f64();
                            let current = job.target.load(Ordering::Relaxed);
                            if previous.is_some_and(|(_, before)| rate <= before * 1.2) {
                                if let Some((level, _)) = previous {
                                    job.target.store(level, Ordering::Relaxed);
                                }
                                ramping = false;
                            } else {
                                previous = Some((current, rate));
                                let next = (current * 2).min(limits.max).min(ceiling);
                                if next > current && job.pieces_left() > next * 2 {
                                    job.target.store(next, Ordering::Relaxed);
                                    for _ in job.active.load(Ordering::Relaxed)..next {
                                        job.spawn_worker(&mut set);
                                    }
                                    settle_until = now + Duration::from_millis(500);
                                } else {
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
    job.save_progress();

    if let Some(e) = job.stop.lock().unwrap().take() {
        return Err(e);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(TurboError::Aborted);
    }
    if !job.all_written() {
        return Err(TurboError::Interrupted("unfinished pieces".into()));
    }
    let job = Arc::try_unwrap(job).map_err(|_| TurboError::Fallback("engine still busy".into()))?;
    let written = meter.done.load(Ordering::Relaxed);
    meter.total.store(written, Ordering::Relaxed);
    for out in job.outputs {
        let Output { file, dest, .. } = out;
        if let Ok(f) = Arc::try_unwrap(file) {
            let _ = f.sync_data();
        }
        turbo::replace_file(&turbo::part_path(&dest), &dest)
            .await
            .map_err(|e| TurboError::Fallback(format!("Couldn't finish {}: {}", dest.display(), e)))?;
        let _ = std::fs::remove_file(turbo::state_path(&dest));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn base() -> reqwest::Url {
        reqwest::Url::parse("https://cdn.example.com/video/720/index.m3u8?token=abc").unwrap()
    }

    #[test]
    fn reads_playlists() {
        let text = "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4.0,\nseg-1.m4s\n#EXT-X-DISCONTINUITY\n#EXTINF:4.0,\nhttps://other.example.com/seg-2.m4s?x=1\n#EXT-X-ENDLIST\n";
        let pieces = parse_hls(text, &base()).unwrap();
        let urls: Vec<&str> = pieces.iter().map(|p| p.url.as_str()).collect();
        assert_eq!(urls, ["https://cdn.example.com/video/720/init.mp4", "https://cdn.example.com/video/720/seg-1.m4s", "https://other.example.com/seg-2.m4s?x=1"]);

        // One file, read in ranges; a range without an offset continues the previous one.
        let ranged = "#EXTM3U\n#EXT-X-MAP:URI=\"all.mp4\",BYTERANGE=\"800@0\"\n#EXT-X-BYTERANGE:1000@800\nall.mp4\n#EXT-X-BYTERANGE:500\nall.mp4\n#EXT-X-ENDLIST\n";
        let ranges: Vec<_> = parse_hls(ranged, &base()).unwrap().into_iter().map(|p| p.range).collect();
        assert_eq!(ranges, [Some((0, 800)), Some((800, 1000)), Some((1800, 500))]);

        let refused = |t: &str| parse_hls(t, &base()).unwrap_err();
        assert_eq!(refused("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST"), "encrypted stream");
        assert_eq!(refused("#EXTM3U\n#EXTINF:4,\na.ts\n"), "live stream");
        assert_eq!(refused("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n"), "a list of playlists");
        assert!(parse_hls("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST", &base()).is_ok());
        assert_eq!(attribute("METHOD=AES-128,URI=\"a,b\",IV=0x1", "iv").as_deref(), Some("0x1"));
    }

    struct Site {
        /// Wait before answering each piece, like a far-away server.
        latency: Duration,
        /// This piece is refused (an expired link).
        refuse: Option<usize>,
    }

    /// A streamed video: `/list.m3u8` names `/seg/0`, `/seg/1`, ... holding `pieces`.
    async fn serve_hls(pieces: Arc<Vec<Vec<u8>>>, site: Site) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let peak = Arc::new(AtomicUsize::new(0));
        let open = Arc::new(AtomicUsize::new(0));
        let site = Arc::new(site);
        let p = peak.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let (pieces, site, peak, open) = (pieces.clone(), site.clone(), p.clone(), open.clone());
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
                        let text = String::from_utf8_lossy(&head).to_string();
                        let path = text.split_whitespace().nth(1).unwrap_or("/").to_string();
                        let (status, body) = if path == "/list.m3u8" {
                            let mut list = String::from("#EXTM3U\n#EXT-X-TARGETDURATION:4\n");
                            for i in 0..pieces.len() {
                                list.push_str(&format!("#EXTINF:4.0,\nseg/{}\n", i));
                            }
                            list.push_str("#EXT-X-ENDLIST\n");
                            ("200 OK", list.into_bytes())
                        } else {
                            let i: usize = path.trim_start_matches("/seg/").parse().unwrap_or(usize::MAX);
                            let now = open.fetch_add(1, Ordering::SeqCst) + 1;
                            peak.fetch_max(now, Ordering::SeqCst);
                            tokio::time::sleep(site.latency).await;
                            open.fetch_sub(1, Ordering::SeqCst);
                            match pieces.get(i) {
                                Some(_) if site.refuse == Some(i) => ("403 Forbidden", Vec::new()),
                                Some(data) => ("200 OK", data.clone()),
                                None => ("404 Not Found", Vec::new()),
                            }
                        };
                        let header = format!("HTTP/1.1 {}\r\nContent-Length: {}\r\n\r\n", status, body.len());
                        if sock.write_all(header.as_bytes()).await.is_err() || sock.write_all(&body).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        (format!("http://{}/list.m3u8", addr), peak)
    }

    fn pieces(count: usize, size: usize) -> Arc<Vec<Vec<u8>>> {
        Arc::new((0..count).map(|i| (0..size).map(|j| (i * 31 + j * 7) as u8).collect()).collect())
    }

    fn hls_stream(url: &str, dest: &Path) -> Stream {
        Stream { url: url.into(), headers: vec![], size: None, dest: dest.into(), max_request: None, pieces: Some(Pieces::Hls(url.into())) }
    }

    fn temp_dest(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("hyperstream-segment-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join(name);
        let _ = std::fs::remove_file(&dest);
        turbo::remove_partial(&dest);
        dest
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn fetches_pieces_side_by_side_and_writes_them_in_order() {
        let data = pieces(40, 64 * 1024 + 3);
        let (url, peak) = serve_hls(data.clone(), Site { latency: Duration::from_millis(150), refuse: None }).await;
        let dest = temp_dest("hls.ts");
        let meter = Arc::new(Meter::default());
        let started = Instant::now();
        download(vec![hls_stream(&url, &dest)], Limits { start: 8, max: 8 }, meter.clone(), Arc::new(AtomicBool::new(false))).await.unwrap();
        let took = started.elapsed();
        assert_eq!(std::fs::read(&dest).unwrap(), data.concat());
        // One piece at a time would take 40 x 150 ms = 6 s.
        assert!(took < Duration::from_secs(2), "took {:?}", took);
        assert!(peak.load(Ordering::SeqCst) >= 6);
        assert_eq!(meter.total.load(Ordering::Relaxed), data.concat().len() as u64);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn pause_and_resume_continue_from_the_last_piece_written() {
        let data = pieces(30, 32 * 1024);
        let (url, _) = serve_hls(data.clone(), Site { latency: Duration::from_millis(100), refuse: None }).await;
        let dest = temp_dest("hls-resume.ts");
        let cancel = Arc::new(AtomicBool::new(false));
        let stopper = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(350)).await;
            stopper.store(true, Ordering::Relaxed);
        });
        let err = download(vec![hls_stream(&url, &dest)], Limits { start: 2, max: 2 }, Arc::new(Meter::default()), cancel).await.unwrap_err();
        assert_eq!(err, TurboError::Aborted);
        let saved: SavedProgress = serde_json::from_slice(&std::fs::read(turbo::state_path(&dest)).unwrap()).unwrap();
        assert!(saved.pieces > 0 && saved.pieces < 30, "written {}", saved.pieces);

        download(vec![hls_stream(&url, &dest)], Limits { start: 4, max: 4 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false))).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data.concat());
    }

    /// Against an outside server: HS_HLS_URL=http://127.0.0.1:8788/list.m3u8 cargo test --lib hls_bench -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    #[ignore]
    async fn hls_bench() {
        let url = std::env::var("HS_HLS_URL").expect("HS_HLS_URL");
        let dest = temp_dest("bench.ts");
        let meter = Arc::new(Meter::default());
        let started = Instant::now();
        download(vec![hls_stream(&url, &dest)], Limits::for_this_pc(false), meter.clone(), Arc::new(AtomicBool::new(false))).await.unwrap();
        let secs = started.elapsed().as_secs_f64();
        let size = std::fs::metadata(&dest).unwrap().len();
        println!("hls_bench {:.1} MB in {:.2} s = {:.1} MB/s", size as f64 / 1e6, secs, size as f64 / 1e6 / secs);
        let _ = std::fs::remove_file(&dest);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn refused_piece_means_fresh_links() {
        let data = pieces(10, 1024);
        let (url, _) = serve_hls(data, Site { latency: Duration::ZERO, refuse: Some(4) }).await;
        let dest = temp_dest("hls-expired.ts");
        let err = download(vec![hls_stream(&url, &dest)], Limits { start: 2, max: 2 }, Arc::new(Meter::default()), Arc::new(AtomicBool::new(false))).await.unwrap_err();
        assert!(matches!(err, TurboError::Expired(_)), "{:?}", err);
    }
}
