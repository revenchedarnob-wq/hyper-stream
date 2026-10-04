use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;

/// The unpacked build: starts in ~0.5 s, where the single-file .exe unpacks itself on every run
/// (~1.5 s, more on slow disks and while antivirus scans the unpacked files).
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip";
/// yt-dlp's own FFmpeg builds (includes the patches yt-dlp relies on).
const FFMPEG_ZIP_URL: &str =
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
/// JavaScript runtime yt-dlp uses for YouTube; without it some formats (and audio tracks) go missing.
const DENO_ZIP_URL: &str = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
/// SHA-256 lists published next to each download; installs are refused when the file doesn't match.
const YTDLP_SUMS_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
/// Release pages; the latest one redirects to ".../tag/<version>".
const YTDLP_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest";
/// Nightly builds get fixes for changed sites days before a release.
const YTDLP_NIGHTLY_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest";
const YTDLP_NIGHTLY_URL: &str = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_win.zip";
const YTDLP_NIGHTLY_SUMS_URL: &str = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/SHA2-256SUMS";
/// After a failure, newer yt-dlp builds are looked for at most this often.
const UPDATE_AFTER_FAILURE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
static LAST_FAILURE_UPDATE: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
const FFMPEG_SUMS_URL: &str = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256";
const DENO_SUMS_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip.sha256sum";
/// Sites change constantly; a managed yt-dlp older than this is refreshed in the background.
const YTDLP_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BinaryStatus {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub available: bool,
    pub managed: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EngineBinariesReport {
    pub ytdlp: BinaryStatus,
    pub ffmpeg: BinaryStatus,
    /// Optional helper; downloads work without it, but YouTube may offer fewer formats.
    pub deno: BinaryStatus,
    /// yt-dlp and FFmpeg are both usable.
    pub all_ready: bool,
}

/// Progress callback for engine installs: (component, downloaded_bytes, total_bytes).
pub type InstallProgress<'a> = &'a (dyn Fn(&str, u64, Option<u64>) + Send + Sync);

pub struct BinaryManager;

/// Size and modified time of a program file; its version is re-read only when these change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct FileStamp {
    size: u64,
    modified_ns: u64,
}

type VersionCache = std::collections::HashMap<String, (FileStamp, String)>;

/// Versions of engine programs, persisted in `bin/versions.json`. Asking yt-dlp for its version
/// takes ~1.4 s (it unpacks itself), which used to delay every launch.
static VERSION_CACHE: std::sync::Mutex<Option<VersionCache>> = std::sync::Mutex::new(None);

impl BinaryManager {
    pub fn get_bin_dir() -> PathBuf {
        let dir = match std::env::var("LOCALAPPDATA") {
            Ok(local_app_data) => PathBuf::from(local_app_data).join("com.hyperstream.desktop").join("bin"),
            Err(_) => PathBuf::from("bin"),
        };
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    pub fn find_binary(binary_name: &str) -> Option<PathBuf> {
        let exe_name = if cfg!(target_os = "windows") && !binary_name.ends_with(".exe") {
            format!("{}.exe", binary_name)
        } else {
            binary_name.to_string()
        };

        // 1. Managed bin directory first (kept up to date by the app).
        if binary_name == "yt-dlp" {
            let unpacked = Self::ytdlp_dir().join("yt-dlp.exe");
            if unpacked.is_file() {
                return Some(unpacked);
            }
        }
        let managed_path = Self::get_bin_dir().join(&exe_name);
        if managed_path.is_file() {
            return Some(managed_path);
        }

        // 2. System PATH.
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("where.exe");
            c.creation_flags(CREATE_NO_WINDOW);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = Command::new("which");

        cmd.arg(&exe_name);
        let output = cmd.output().ok().filter(|o| o.status.success())?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let path = PathBuf::from(stdout.lines().next()?.trim());
        path.is_file().then_some(path)
    }

    fn file_stamp(path: &Path) -> Option<FileStamp> {
        let meta = std::fs::metadata(path).ok()?;
        let modified_ns = meta.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_nanos() as u64;
        Some(FileStamp { size: meta.len(), modified_ns })
    }

    /// `get_version`, remembered until the program file changes (update, reinstall, new PATH copy).
    fn cached_version(path: &Path, version_flag: &str) -> Option<String> {
        let stamp = Self::file_stamp(path)?;
        let key = path.to_string_lossy().to_lowercase();
        let file = Self::get_bin_dir().join("versions.json");
        let load = || -> VersionCache {
            std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
        };
        if let Ok(mut cache) = VERSION_CACHE.lock() {
            if let Some((known, version)) = cache.get_or_insert_with(load).get(&key) {
                if *known == stamp {
                    return Some(version.clone());
                }
            }
        }
        // Only working programs are remembered; a broken one is asked again next time.
        let version = Self::get_version(path, version_flag)?;
        if let Ok(mut cache) = VERSION_CACHE.lock() {
            let cache = cache.get_or_insert_with(load);
            cache.insert(key, (stamp, version.clone()));
            if let Ok(bytes) = serde_json::to_vec(cache) {
                let _ = std::fs::write(&file, bytes);
            }
        }
        Some(version)
    }

    pub fn get_version(path: &Path, version_flag: &str) -> Option<String> {
        let mut cmd = Command::new(path);
        cmd.arg(version_flag);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().ok().filter(|o| o.status.success())?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let text = if !stdout.is_empty() { stdout } else { stderr };
        let first = text.lines().next()?.trim().to_string();
        // "ffmpeg version N-1234-g... Copyright ..." -> "N-1234-g..."
        // "deno 2.5.1 (stable, ...)" -> "2.5.1"
        let version = first
            .strip_prefix("ffmpeg version ")
            .or_else(|| first.strip_prefix("deno "))
            .map(|rest| rest.split_whitespace().next().unwrap_or(rest).to_string())
            .unwrap_or_else(|| first.clone());
        Some(version)
    }

    fn status_for(name: &str, version_flag: &str) -> BinaryStatus {
        let bin_dir = Self::get_bin_dir();
        let path = Self::find_binary(name);
        let version = path.as_deref().and_then(|p| Self::cached_version(p, version_flag));
        BinaryStatus {
            name: name.to_string(),
            managed: path.as_ref().map(|p| p.starts_with(&bin_dir)).unwrap_or(false),
            // A binary that exists but can't report a version is broken, not available.
            available: version.is_some(),
            path: path.map(|p| p.to_string_lossy().to_string()),
            version,
        }
    }

    pub fn get_status() -> EngineBinariesReport {
        // Each check starts a program (yt-dlp takes ~1 s cold); run them side by side.
        let (ytdlp, ffmpeg, deno) = std::thread::scope(|scope| {
            let ytdlp = scope.spawn(|| Self::status_for("yt-dlp", "--version"));
            let ffmpeg = scope.spawn(|| Self::status_for("ffmpeg", "-version"));
            let deno = Self::status_for("deno", "--version");
            (ytdlp.join().unwrap(), ffmpeg.join().unwrap(), deno)
        });
        let all_ready = ytdlp.available && ffmpeg.available;
        EngineBinariesReport { ytdlp, ffmpeg, deno, all_ready }
    }

    /// Force UTF-8 on the Python side so non-ASCII titles and paths survive the pipe.
    pub fn apply_utf8_env(cmd: &mut Command) {
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("PYTHONUTF8", "1");
    }

    /// Writes a Netscape cookie file for one yt-dlp invocation. Caller deletes it.
    pub fn write_temp_cookie_file(contents: &str) -> Option<PathBuf> {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = Self::get_bin_dir().join(format!("cookies-{}.txt", nonce));
        std::fs::write(&path, contents).ok()?;
        Some(path)
    }

    /// Kill a process and all of its children (yt-dlp.exe spawns a Python child and ffmpeg).
    pub fn kill_process_tree(pid: u32) {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("taskkill");
            cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    }

    /// Expected SHA-256 for `file_name` from a published checksum list. Handles the
    /// "<hash>  <name>" lists and Deno's single-hash format.
    pub(crate) fn expected_sha256(sums: &str, file_name: &str) -> Option<String> {
        let hash_in = |line: &str| {
            line.split(|c: char| !c.is_ascii_hexdigit())
                .find(|w| w.len() == 64)
                .map(|w| w.to_ascii_lowercase())
        };
        let named = sums.lines().find(|l| {
            l.split_whitespace().any(|w| w.trim_start_matches('*') == file_name)
        });
        if let Some(line) = named {
            return hash_in(line);
        }
        let all: Vec<String> = sums.lines().filter_map(hash_in).collect();
        (all.len() == 1).then(|| all[0].clone())
    }

    async fn fetch_expected_sha256(client: &reqwest::Client, sums_url: &str, file_name: &str, component: &str) -> Result<String, String> {
        let unavailable = || format!("Couldn't check the {component} download (no checksum available). Try again later.");
        let response = client
            .get(sums_url)
            .header("User-Agent", "HyperStream/1.0")
            .send()
            .await
            .map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        let text = response.text().await.map_err(|_| unavailable())?;
        Self::expected_sha256(&text, file_name).ok_or_else(unavailable)
    }

    /// Streams `url` into `dest` atomically (temp file + rename), reporting progress. The file is
    /// only installed when its SHA-256 matches the list at `sums_url`.
    pub async fn download_to_file(
        url: &str,
        sums_url: &str,
        dest: &Path,
        component: &str,
        progress: InstallProgress<'_>,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(15 * 60))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
        let file_name = url.rsplit('/').next().unwrap_or_default();
        let expected = Self::fetch_expected_sha256(&client, sums_url, file_name, component).await?;

        let mut response = client
            .get(url)
            .header("User-Agent", "HyperStream/1.0")
            .send()
            .await
            .map_err(|e| format!("Couldn't download {}: {}", component, e))?;

        if !response.status().is_success() {
            return Err(format!("Couldn't download {} (HTTP {})", component, response.status()));
        }

        let total = response.content_length();
        let tmp = dest.with_extension("download");
        let mut file = std::fs::File::create(&tmp).map_err(|e| format!("Couldn't write {}: {}", component, e))?;
        let mut downloaded: u64 = 0;
        let mut hasher = Sha256::new();
        let mut last_report = std::time::Instant::now();

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Download of {} was interrupted: {}", component, e))?
        {
            file.write_all(&chunk).map_err(|e| format!("Couldn't write {}: {}", component, e))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            if last_report.elapsed() >= Duration::from_millis(250) {
                progress(component, downloaded, total);
                last_report = std::time::Instant::now();
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        progress(component, downloaded, total);

        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            let _ = std::fs::remove_file(&tmp);
            log::warn!("{component}: checksum mismatch (expected {expected}, got {actual})");
            return Err(format!("The {component} download was damaged or altered, so it wasn't installed. Try again."));
        }

        if dest.exists() {
            let _ = std::fs::remove_file(dest);
        }
        std::fs::rename(&tmp, dest).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            // Windows won't replace an .exe that is running (e.g. during a download).
            format!("Couldn't install {}. If downloads are running, try again when they finish. ({})", component, e)
        })
    }

    /// Folder of the app-managed (unpacked) yt-dlp.
    pub(crate) fn ytdlp_dir() -> PathBuf {
        Self::get_bin_dir().join("yt-dlp")
    }

    pub async fn download_yt_dlp(progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        Self::install_yt_dlp(YTDLP_URL, YTDLP_SUMS_URL, progress).await
    }

    /// "2026.10.03" / "2026.10.03.232914" -> comparable numbers.
    fn version_key(v: &str) -> Vec<u64> {
        v.trim().split('.').map(|p| p.parse().unwrap_or(0)).collect()
    }

    /// Version of the newest release on a GitHub releases page (from its redirect).
    async fn latest_tag(releases: &str) -> Option<String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .ok()?;
        let response = client.get(releases).header("User-Agent", "HyperStream/1.0").send().await.ok()?;
        let location = response.headers().get(reqwest::header::LOCATION)?.to_str().ok()?;
        let tag = location.rsplit('/').next()?.trim().to_string();
        tag.chars().next().is_some_and(|c| c.is_ascii_digit()).then_some(tag)
    }

    fn installed_ytdlp_version() -> Option<String> {
        let path = Self::ytdlp_dir().join("yt-dlp.exe");
        path.is_file().then(|| Self::cached_version(&path, "--version")).flatten()
    }

    /// The weekly refresh: installs the latest release only when it's newer than this copy
    /// (no 18 MB download when nothing changed, and never back from a newer nightly).
    pub async fn refresh_yt_dlp() -> Result<(), String> {
        let installed = tokio::task::spawn_blocking(Self::installed_ytdlp_version).await.ok().flatten();
        let latest = Self::latest_tag(YTDLP_RELEASES).await;
        let newer = match (&installed, &latest) {
            (Some(have), Some(latest)) => Self::version_key(latest) > Self::version_key(have),
            _ => true,
        };
        if newer {
            Self::download_yt_dlp(&|_, _, _| {}).await.map(|_| ())
        } else {
            // Up to date: check again in a week.
            let _ = std::fs::write(Self::ytdlp_dir().join(".installed"), b"");
            Ok(())
        }
    }

    /// A site stopped working: sites change and yt-dlp follows within days. Installs a newer
    /// yt-dlp if there is one (the release, else the nightly build) and returns true, so the
    /// caller can try again. Checks at most every 6 hours, and only for the app's own copy.
    pub async fn update_after_site_failure() -> bool {
        {
            let Ok(mut last) = LAST_FAILURE_UPDATE.lock() else { return false };
            if last.is_some_and(|t| t.elapsed() < UPDATE_AFTER_FAILURE_EVERY) {
                return false;
            }
            *last = Some(std::time::Instant::now());
        }
        let Some(installed) = tokio::task::spawn_blocking(Self::installed_ytdlp_version).await.ok().flatten() else {
            return false;
        };
        let have = Self::version_key(&installed);
        if let Some(release) = Self::latest_tag(YTDLP_RELEASES).await {
            if Self::version_key(&release) > have {
                log::info!("Updating yt-dlp {installed} -> {release} after a failed download");
                return Self::download_yt_dlp(&|_, _, _| {}).await.is_ok();
            }
        }
        if let Some(nightly) = Self::latest_tag(YTDLP_NIGHTLY_RELEASES).await {
            if Self::version_key(&nightly) > have {
                log::info!("Updating yt-dlp {installed} -> nightly {nightly} after a failed download");
                return Self::install_yt_dlp(YTDLP_NIGHTLY_URL, YTDLP_NIGHTLY_SUMS_URL, &|_, _, _| {}).await.is_ok();
            }
        }
        false
    }

    fn swap_ytdlp_folder(bin: &Path, fresh: &Path) -> Result<(), String> {
        let current = Self::ytdlp_dir();
        let old = bin.join("yt-dlp.old");
        let _ = std::fs::remove_dir_all(&old);
        if current.exists() {
            if let Err(e) = std::fs::rename(&current, &old) {
                let _ = std::fs::remove_dir_all(fresh);
                return Err(format!("Couldn't install yt-dlp. If downloads are running, try again when they finish. ({})", e));
            }
        }
        std::fs::rename(fresh, &current).map_err(|e| format!("Couldn't install yt-dlp: {}", e))
    }

    async fn install_yt_dlp(url: &str, sums_url: &str, progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        let bin = Self::get_bin_dir();
        let zip = bin.join("yt-dlp_win.zip");
        Self::download_to_file(url, sums_url, &zip, "yt-dlp", progress).await?;

        let fresh = bin.join("yt-dlp.new");
        let _ = std::fs::remove_dir_all(&fresh);
        std::fs::create_dir_all(&fresh).map_err(|e| format!("Couldn't install yt-dlp: {}", e))?;
        let (zip_for_task, fresh_for_task) = (zip.clone(), fresh.clone());
        let unpacked = tokio::task::spawn_blocking(move || {
            // tar.exe ships with Windows 10 and later and reads zip files.
            let tar = std::env::var_os("SystemRoot")
                .map(|root| PathBuf::from(root).join("System32").join("tar.exe"))
                .filter(|p| p.is_file())
                .unwrap_or_else(|| PathBuf::from("tar.exe"));
            let mut cmd = Command::new(tar);
            cmd.arg("-xf").arg(&zip_for_task).arg("-C").arg(&fresh_for_task);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        })
        .await
        .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&zip);
        let unpacked_ok = unpacked.as_ref().is_ok_and(|o| o.status.success()) && fresh.join("yt-dlp.exe").is_file();
        if !unpacked_ok {
            let _ = std::fs::remove_dir_all(&fresh);
            let detail = match unpacked {
                Ok(o) => String::from_utf8_lossy(&o.stderr).trim().to_string(),
                Err(e) => e.to_string(),
            };
            return Err(format!("Couldn't unpack yt-dlp. {}", detail));
        }
        // Marks when this copy was installed (the files keep the release's own dates).
        let _ = std::fs::write(fresh.join(".installed"), b"");

        // Swap folders. Windows won't move a folder whose yt-dlp is running, so background
        // workers stop first (new ones start from the new copy).
        crate::downloader::ytdlp_worker::pause();
        let swapped = Self::swap_ytdlp_folder(&bin, &fresh);
        crate::downloader::ytdlp_worker::resume();
        swapped?;
        let current = Self::ytdlp_dir();
        let _ = std::fs::remove_dir_all(bin.join("yt-dlp.old"));
        // The single-file copy older versions installed is no longer used.
        let _ = std::fs::remove_file(bin.join("yt-dlp.exe"));
        Ok(current.join("yt-dlp.exe"))
    }

    pub async fn download_ffmpeg(progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        let bin_dir = Self::get_bin_dir();
        let zip_path = bin_dir.join("ffmpeg-package.zip");
        Self::download_to_file(FFMPEG_ZIP_URL, FFMPEG_SUMS_URL, &zip_path, "FFmpeg", progress).await?;

        // Extract only ffmpeg.exe and ffprobe.exe from the (large) archive.
        Self::extract_from_zip(&zip_path, &bin_dir, &["ffmpeg.exe", "ffprobe.exe"], "FFmpeg").await?;
        let ffmpeg = bin_dir.join("ffmpeg.exe");
        if !ffmpeg.is_file() {
            return Err("Couldn't unpack FFmpeg: ffmpeg.exe wasn't in the package.".to_string());
        }
        Ok(ffmpeg)
    }

    pub async fn download_deno(progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        let bin_dir = Self::get_bin_dir();
        let zip_path = bin_dir.join("deno-package.zip");
        Self::download_to_file(DENO_ZIP_URL, DENO_SUMS_URL, &zip_path, "Deno", progress).await?;
        Self::extract_from_zip(&zip_path, &bin_dir, &["deno.exe"], "Deno").await?;
        let deno = bin_dir.join("deno.exe");
        if !deno.is_file() {
            return Err("Couldn't unpack Deno: deno.exe wasn't in the package.".to_string());
        }
        Ok(deno)
    }

    /// Extracts the named files (matched by file name, in any folder) from `zip` into `dest`, then deletes the zip.
    async fn extract_from_zip(zip: &Path, dest: &Path, names: &[&str], component: &str) -> Result<(), String> {
        let zip_for_task = zip.to_path_buf();
        let dest_for_task = dest.to_path_buf();
        let names_for_task = names.join(";");
        // Paths and names go through environment variables, never into the script text.
        let script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; \
             $names = $env:HS_NAMES -split ';'; $z=[IO.Compression.ZipFile]::OpenRead($env:HS_ZIP); \
             try { foreach($e in $z.Entries) { if ($names -contains $e.Name) { \
             [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $env:HS_DEST $e.Name), $true) } } } \
             finally { $z.Dispose() }";
        let output = tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
                .env("HS_ZIP", &zip_for_task)
                .env("HS_DEST", &dest_for_task)
                .env("HS_NAMES", &names_for_task);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Couldn't unpack {}: {}", component, e));

        let _ = std::fs::remove_file(zip);
        let output = output?;
        if !output.status.success() {
            return Err(format!("Couldn't unpack {}: {}", component, String::from_utf8_lossy(&output.stderr).trim()));
        }
        Ok(())
    }

    /// Installs the optional JavaScript runtime if it's missing. Failures are logged, not fatal.
    pub async fn ensure_js_runtime(progress: InstallProgress<'_>) {
        let has_deno = tokio::task::spawn_blocking(|| Self::find_binary("deno").is_some()).await.unwrap_or(true);
        if !has_deno {
            if let Err(e) = Self::download_deno(progress).await {
                log::warn!("Deno install failed: {e}");
            }
        }
    }

    /// Install whatever is missing. Returns the final status.
    pub async fn ensure_installed(progress: InstallProgress<'_>) -> Result<EngineBinariesReport, String> {
        let status = tokio::task::spawn_blocking(Self::get_status).await.map_err(|e| e.to_string())?;
        if !status.ytdlp.available {
            Self::download_yt_dlp(progress).await?;
        }
        if !status.ffmpeg.available {
            Self::download_ffmpeg(progress).await?;
        }
        if !status.deno.available {
            Self::ensure_js_runtime(progress).await;
        }
        tokio::task::spawn_blocking(Self::get_status).await.map_err(|e| e.to_string())
    }

    /// True when the app manages yt-dlp itself and the copy is older than a week,
    /// or is the slower single-file build older versions installed.
    pub fn managed_ytdlp_is_stale() -> bool {
        let marker = Self::ytdlp_dir().join(".installed");
        if !marker.is_file() {
            return Self::get_bin_dir().join("yt-dlp.exe").is_file();
        }
        std::fs::metadata(&marker)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .map(|age| age > YTDLP_MAX_AGE)
            .unwrap_or(false)
    }

    pub fn create_command(binary_name: &str) -> Result<Command, String> {
        let binary_path = Self::find_binary(binary_name).ok_or_else(|| {
            format!(
                "The download engine ({}) isn't installed yet. Open Settings → Downloads and click Install.",
                binary_name
            )
        })?;

        let mut cmd = Command::new(binary_path);

        // yt-dlp finds its helpers (Deno for YouTube, FFmpeg) on PATH; put the app's copies first.
        let mut paths = vec![Self::get_bin_dir()];
        if let Some(existing) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        }

        Ok(cmd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_dir_is_created() {
        assert!(BinaryManager::get_bin_dir().exists());
    }

    #[test]
    fn status_reports_both_components() {
        let status = BinaryManager::get_status();
        assert_eq!(status.ytdlp.name, "yt-dlp");
        assert_eq!(status.ffmpeg.name, "ffmpeg");
        assert_eq!(status.all_ready, status.ytdlp.available && status.ffmpeg.available);
    }

    #[test]
    fn missing_binary_gives_actionable_error() {
        let err = BinaryManager::create_command("definitely-not-a-real-binary-xyz").unwrap_err();
        assert!(err.contains("Settings"));
    }

    #[test]
    fn reads_published_checksum_formats() {
        let ytdlp = "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6  yt-dlp\n\
                     66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a  yt-dlp.exe\n";
        assert_eq!(
            BinaryManager::expected_sha256(ytdlp, "yt-dlp.exe").as_deref(),
            Some("66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a")
        );
        // Deno publishes PowerShell Get-FileHash output with CRLF line ends.
        let deno = "\r\nAlgorithm : SHA256\r\n\
                    Hash      : A0C3101B4158D1DFB7D6A78A7BF0F3DE80C96BB423C152BEEC8BEB22786F2238\r\n\
                    Path      : C:\\a\\deno\\target\\release\\deno-x86_64-pc-windows-msvc.zip\r\n";
        assert_eq!(
            BinaryManager::expected_sha256(deno, "deno-x86_64-pc-windows-msvc.zip").as_deref(),
            Some("a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238")
        );
        assert_eq!(BinaryManager::expected_sha256(ytdlp, "missing.zip"), None);
    }

    #[test]
    fn extracts_only_named_files_from_nested_zip() {
        let root = std::env::temp_dir().join(format!("hs_zip_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let src = root.join("src").join("pkg").join("bin");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("tool.exe"), b"tool").unwrap();
        std::fs::write(src.join("readme.txt"), b"doc").unwrap();
        let zip = root.join("pkg.zip");
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Compress-Archive -Path $env:HS_SRC -DestinationPath $env:HS_ZIP"])
            .env("HS_SRC", root.join("src").join("pkg"))
            .env("HS_ZIP", &zip)
            .status()
            .unwrap();
        assert!(status.success());

        tauri::async_runtime::block_on(BinaryManager::extract_from_zip(&zip, &out, &["tool.exe"], "Tool")).unwrap();
        assert_eq!(std::fs::read(out.join("tool.exe")).unwrap(), b"tool");
        assert!(!out.join("readme.txt").exists());
        assert!(!zip.exists(), "the package is deleted after unpacking");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn temp_cookie_file_roundtrip() {
        let path = BinaryManager::write_temp_cookie_file("# Netscape HTTP Cookie File\n").unwrap();
        assert!(path.is_file());
        let _ = std::fs::remove_file(path);
    }
}

/// Errors a newer yt-dlp may fix (a site changed), as opposed to network, disk or sign-in trouble.
pub fn may_be_fixed_by_update(message: &str) -> bool {
    const SITE_CHANGED: [&str; 4] = [
        "No downloadable media was found",
        "This site or link is not supported",
        "Access was denied by the server",
        "Download failed:",
    ];
    SITE_CHANGED.iter().any(|m| message.starts_with(m))
}

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn versions_compare_by_number() {
        let k = BinaryManager::version_key;
        assert!(k("2026.10.03.232914") > k("2026.10.03"));
        assert!(k("2026.10.03") > k("2026.9.30"));
        assert!(k("2026.08.19") == k("2026.08.19"));
    }

    #[test]
    fn only_site_changes_trigger_an_update() {
        assert!(may_be_fixed_by_update("No downloadable media was found at this link. Make sure it points to a single video or post."));
        assert!(may_be_fixed_by_update("Download failed: nsig extraction failed"));
        assert!(!may_be_fixed_by_update("Network error: the server could not be reached. Check your internet connection."));
        assert!(!may_be_fixed_by_update("This site requires you to be signed in. Open the link in the Browser tab, sign in, then capture again."));
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Real download + checksum check against GitHub. Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn ytdlp_download_verifies_against_published_checksum() {
        let dir = std::env::temp_dir().join(format!("hs_sha_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("yt-dlp_win.zip");
        BinaryManager::download_to_file(YTDLP_URL, YTDLP_SUMS_URL, &dest, "yt-dlp", &|_, _, _| {})
            .await
            .expect("verified download");
        assert!(dest.metadata().unwrap().len() > 1_000_000);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
