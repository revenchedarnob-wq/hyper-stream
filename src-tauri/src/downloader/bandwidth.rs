//! One speed limit shared by every download.
//!
//! Connections draw from a single budget before reading more data, so the limit holds however
//! many downloads and connections are running. "Auto" leaves room for other apps: while
//! something else on this PC uses the internet (a video, a call, a game update), downloads
//! slow to what's left of the line, minus a margin that keeps it responsive. When nothing
//! else needs it, downloads run at full speed.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum SpeedLimit {
    Off,
    Auto,
    Fixed { bytes_per_sec: u64 },
}

const MODE_OFF: u8 = 0;
const MODE_AUTO: u8 = 1;
const MODE_FIXED: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(MODE_OFF);
/// Bytes per second allowed right now (0: no limit).
static RATE: AtomicU64 = AtomicU64::new(0);
/// Everything the download connections received, for telling our traffic from other apps'.
static RECEIVED: AtomicU64 = AtomicU64::new(0);
/// When the budget is next free: each read books its share of time after the previous one.
static NEXT_FREE: Mutex<Option<Instant>> = Mutex::new(None);
static AUTO_RUNNING: AtomicBool = AtomicBool::new(false);

/// Bursts up to this long are let through, so a limit doesn't turn into stutter.
const BURST: Duration = Duration::from_millis(250);

pub fn set(limit: SpeedLimit) {
    match limit {
        SpeedLimit::Off => {
            MODE.store(MODE_OFF, Ordering::Relaxed);
            RATE.store(0, Ordering::Relaxed);
        }
        SpeedLimit::Fixed { bytes_per_sec } => {
            MODE.store(MODE_FIXED, Ordering::Relaxed);
            RATE.store(bytes_per_sec.max(16 * 1024), Ordering::Relaxed);
        }
        SpeedLimit::Auto => {
            MODE.store(MODE_AUTO, Ordering::Relaxed);
            RATE.store(0, Ordering::Relaxed);
            if !AUTO_RUNNING.swap(true, Ordering::AcqRel) {
                std::thread::Builder::new().name("speed-auto".into()).spawn(auto_loop).ok();
            }
        }
    }
}

/// A fixed limit for the regular downloader (yt-dlp), split between the downloads running.
pub fn fixed_limit_per_download(running: usize) -> Option<u64> {
    (MODE.load(Ordering::Relaxed) == MODE_FIXED).then(|| RATE.load(Ordering::Relaxed) / running.max(1) as u64)
}

/// Called with every piece of data received; waits as long as the limit asks for.
pub async fn take(bytes: usize) {
    RECEIVED.fetch_add(bytes as u64, Ordering::Relaxed);
    if let Some(wait) = booking(bytes, RATE.load(Ordering::Relaxed), Instant::now()) {
        tokio::time::sleep(wait).await;
    }
}

fn booking(bytes: usize, rate: u64, now: Instant) -> Option<Duration> {
    if rate == 0 {
        return None;
    }
    let mut next = NEXT_FREE.lock().unwrap();
    // Unused budget carries over, but only up to one burst.
    let earliest = now.checked_sub(BURST).unwrap_or(now);
    let start = next.map_or(earliest, |t| t.max(earliest));
    let free_at = start + Duration::from_secs_f64(bytes as f64 / rate as f64);
    *next = Some(free_at);
    let wait = free_at.saturating_duration_since(now);
    (!wait.is_zero()).then_some(wait)
}

/// Bytes received so far by the network adapter that leads to the internet.
#[cfg(windows)]
fn adapter_received() -> Option<u64> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetBestInterfaceEx, GetIfEntry2, MIB_IF_ROW2};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR, SOCKADDR_IN};
    unsafe {
        // Only a route lookup: nothing is sent to this address.
        let mut dest: SOCKADDR_IN = std::mem::zeroed();
        dest.sin_family = AF_INET;
        dest.sin_addr.S_un.S_addr = u32::from_ne_bytes([1, 1, 1, 1]);
        let mut index = 0u32;
        if GetBestInterfaceEx(&dest as *const SOCKADDR_IN as *const SOCKADDR, &mut index) != 0 {
            return None;
        }
        let mut row: MIB_IF_ROW2 = std::mem::zeroed();
        row.InterfaceIndex = index;
        (GetIfEntry2(&mut row) == 0).then_some(row.InOctets)
    }
}

#[cfg(not(windows))]
fn adapter_received() -> Option<u64> {
    None
}

/// Auto mode: watch how much of the line other apps use, once a second.
#[derive(Debug, Default)]
struct AutoState {
    /// The most the line has delivered (bytes per second), forgotten slowly.
    capacity: f64,
    limiting: bool,
    quiet_since: Option<Instant>,
}

impl AutoState {
    /// The limit for the next second, from what the adapter and the downloads received in the last one.
    fn next(&mut self, total: f64, ours: f64, now: Instant) -> u64 {
        // Our count is payload only; the adapter also counts packet headers (a few percent).
        let others = (total - ours * 1.06).max(0.0);
        if !self.limiting {
            self.capacity = (self.capacity * 0.98).max(total);
        }
        let busy = others > (self.capacity * 0.08).max(100.0 * 1024.0);
        if busy {
            self.limiting = true;
            self.quiet_since = None;
        } else if self.limiting {
            // Video players fetch in bursts: wait for a few quiet seconds before speeding up.
            let since = *self.quiet_since.get_or_insert(now);
            if now.duration_since(since) >= Duration::from_secs(5) {
                self.limiting = false;
                self.quiet_since = None;
            }
        }
        if !self.limiting {
            return 0;
        }
        (self.capacity * 0.85 - others).max(self.capacity * 0.15).max(64.0 * 1024.0) as u64
    }
}

fn auto_loop() {
    let mut state = AutoState::default();
    let mut last: Option<(Instant, u64, u64)> = None;
    while MODE.load(Ordering::Relaxed) == MODE_AUTO {
        std::thread::sleep(Duration::from_secs(1));
        let ours = RECEIVED.load(Ordering::Relaxed);
        let Some(adapter) = adapter_received() else { continue };
        let now = Instant::now();
        if let Some((at, before_adapter, before_ours)) = last {
            // Nothing downloading: nothing to limit, and nothing to learn about the line.
            if ours == before_ours && !state.limiting {
                last = Some((now, adapter, ours));
                continue;
            }
            let secs = now.duration_since(at).as_secs_f64().max(0.001);
            let total = adapter.saturating_sub(before_adapter) as f64 / secs;
            let mine = ours.saturating_sub(before_ours) as f64 / secs;
            let limit = state.next(total, mine, now);
            if MODE.load(Ordering::Relaxed) == MODE_AUTO {
                RATE.store(limit, Ordering::Relaxed);
            }
        }
        last = Some((now, adapter, ours));
    }
    AUTO_RUNNING.store(false, Ordering::Release);
    // Switched back to Auto while this thread was finishing: start a new one.
    if MODE.load(Ordering::Relaxed) == MODE_AUTO && !AUTO_RUNNING.swap(true, Ordering::AcqRel) {
        std::thread::Builder::new().name("speed-auto".into()).spawn(auto_loop).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn booking_spreads_reads_over_time() {
        *NEXT_FREE.lock().unwrap() = None;
        let now = Instant::now();
        // 1 MB/s: the first 250 ms of data pass at once, then each read waits its turn.
        let rate = 1_000_000;
        assert_eq!(booking(250_000, rate, now), None);
        let wait = booking(500_000, rate, now).unwrap();
        assert!((wait.as_secs_f64() - 0.5).abs() < 0.01, "{:?}", wait);
        assert_eq!(booking(1, 0, now), None);
    }

    #[test]
    fn auto_yields_to_other_apps_and_returns_when_they_stop() {
        let mut s = AutoState::default();
        let t0 = Instant::now();
        // Full speed on a 10 MB/s line: no limit, the line's capacity is learned.
        assert_eq!(s.next(10e6, 9.4e6, t0), 0);
        // A video starts using 2 MB/s: downloads get what's left minus a margin.
        let limit = s.next(10e6, 7.5e6, t0 + Duration::from_secs(1));
        assert!((5.5e6..6.5e6).contains(&(limit as f64)), "{}", limit);
        // The video pauses between bursts: the limit stays for a few seconds.
        assert!(s.next(6e6, 5.6e6, t0 + Duration::from_secs(2)) > 0);
        assert!(s.next(6e6, 5.6e6, t0 + Duration::from_secs(6)) > 0);
        assert_eq!(s.next(6e6, 5.6e6, t0 + Duration::from_secs(8)), 0);
    }
}
