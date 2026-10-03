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

const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
/// yt-dlp's own FFmpeg builds (includes the patches yt-dlp relies on).
const FFMPEG_ZIP_URL: &str =
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
/// JavaScript runtime yt-dlp uses for YouTube; without it some formats (and audio tracks) go missing.
const DENO_ZIP_URL: &str = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
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
        let version = path.as_deref().and_then(|p| Self::get_version(p, version_flag));
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

    /// Streams `url` into `dest` atomically (temp file + rename), reporting progress.
    pub async fn download_to_file(
        url: &str,
        dest: &Path,
        component: &str,
        progress: InstallProgress<'_>,
    ) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(15 * 60))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

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
        let mut last_report = std::time::Instant::now();

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Download of {} was interrupted: {}", component, e))?
        {
            file.write_all(&chunk).map_err(|e| format!("Couldn't write {}: {}", component, e))?;
            downloaded += chunk.len() as u64;
            if last_report.elapsed() >= Duration::from_millis(250) {
                progress(component, downloaded, total);
                last_report = std::time::Instant::now();
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        progress(component, downloaded, total);

        if dest.exists() {
            let _ = std::fs::remove_file(dest);
        }
        std::fs::rename(&tmp, dest).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            // Windows won't replace an .exe that is running (e.g. during a download).
            format!("Couldn't install {}. If downloads are running, try again when they finish. ({})", component, e)
        })
    }

    pub async fn download_yt_dlp(progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        let target = Self::get_bin_dir().join("yt-dlp.exe");
        Self::download_to_file(YTDLP_URL, &target, "yt-dlp", progress).await?;
        Ok(target)
    }

    pub async fn download_ffmpeg(progress: InstallProgress<'_>) -> Result<PathBuf, String> {
        let bin_dir = Self::get_bin_dir();
        let zip_path = bin_dir.join("ffmpeg-package.zip");
        Self::download_to_file(FFMPEG_ZIP_URL, &zip_path, "FFmpeg", progress).await?;

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
        Self::download_to_file(DENO_ZIP_URL, &zip_path, "Deno", progress).await?;
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

    /// True when the app manages yt-dlp itself and the copy is older than a week.
    pub fn managed_ytdlp_is_stale() -> bool {
        let path = Self::get_bin_dir().join("yt-dlp.exe");
        std::fs::metadata(&path)
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
