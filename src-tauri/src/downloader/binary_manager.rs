use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
pub const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;

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
    pub aria2c: BinaryStatus,
    pub all_ready: bool,
}

pub struct BinaryManager;

impl BinaryManager {
    pub fn get_bin_dir() -> PathBuf {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let dir = PathBuf::from(local_app_data)
                .join("com.hyperstream.desktop")
                .join("bin");
            let _ = std::fs::create_dir_all(&dir);
            dir
        } else {
            let dir = PathBuf::from("bin");
            let _ = std::fs::create_dir_all(&dir);
            dir
        }
    }

    pub fn find_binary(binary_name: &str) -> Option<PathBuf> {
        let exe_name = if cfg!(target_os = "windows") && !binary_name.ends_with(".exe") {
            format!("{}.exe", binary_name)
        } else {
            binary_name.to_string()
        };

        // 1. Check managed bin directory first
        let managed_path = Self::get_bin_dir().join(&exe_name);
        if managed_path.is_file() {
            return Some(managed_path);
        }

        // 2. Check system PATH via where.exe on Windows or which on Unix
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("where.exe");
            cmd.arg(&exe_name);
            cmd.creation_flags(CREATE_NO_WINDOW);
            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Some(first_line) = stdout.lines().next() {
                        let path = PathBuf::from(first_line.trim());
                        if path.is_file() {
                            return Some(path);
                        }
                    }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = Command::new("which");
            cmd.arg(&exe_name);
            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Some(first_line) = stdout.lines().next() {
                        let path = PathBuf::from(first_line.trim());
                        if path.is_file() {
                            return Some(path);
                        }
                    }
                }
            }
        }

        None
    }

    pub fn get_version(path: &Path, version_flag: &str) -> Option<String> {
        let mut cmd = Command::new(path);
        cmd.arg(version_flag);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let text = if !stdout.is_empty() { stdout } else { stderr };
                if let Some(first_line) = text.lines().next() {
                    return Some(first_line.trim().to_string());
                }
            }
        }
        None
    }

    pub fn get_status() -> EngineBinariesReport {
        let bin_dir = Self::get_bin_dir();

        let ytdlp_path = Self::find_binary("yt-dlp");
        let ffmpeg_path = Self::find_binary("ffmpeg");
        let aria2c_path = Self::find_binary("aria2c");

        let ytdlp_version = ytdlp_path.as_deref().and_then(|p| Self::get_version(p, "--version"));
        let ffmpeg_version = ffmpeg_path.as_deref().and_then(|p| Self::get_version(p, "-version"));
        let aria2c_version = aria2c_path.as_deref().and_then(|p| Self::get_version(p, "--version"));

        let ytdlp_managed = ytdlp_path.as_ref().map(|p| p.starts_with(&bin_dir)).unwrap_or(false);
        let ffmpeg_managed = ffmpeg_path.as_ref().map(|p| p.starts_with(&bin_dir)).unwrap_or(false);
        let aria2c_managed = aria2c_path.as_ref().map(|p| p.starts_with(&bin_dir)).unwrap_or(false);

        let ytdlp_available = ytdlp_path.is_some();
        let ffmpeg_available = ffmpeg_path.is_some();
        let aria2c_available = aria2c_path.is_some();

        let all_ready = ytdlp_available && ffmpeg_available;

        EngineBinariesReport {
            ytdlp: BinaryStatus {
                name: "yt-dlp".to_string(),
                path: ytdlp_path.map(|p| p.to_string_lossy().to_string()),
                version: ytdlp_version,
                available: ytdlp_available,
                managed: ytdlp_managed,
            },
            ffmpeg: BinaryStatus {
                name: "ffmpeg".to_string(),
                path: ffmpeg_path.map(|p| p.to_string_lossy().to_string()),
                version: ffmpeg_version,
                available: ffmpeg_available,
                managed: ffmpeg_managed,
            },
            aria2c: BinaryStatus {
                name: "aria2c".to_string(),
                path: aria2c_path.map(|p| p.to_string_lossy().to_string()),
                version: aria2c_version,
                available: aria2c_available,
                managed: aria2c_managed,
            },
            all_ready,
        }
    }

    pub async fn download_yt_dlp() -> Result<PathBuf, String> {
        let bin_dir = Self::get_bin_dir();
        let target_file = bin_dir.join(if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" });

        let url = if cfg!(target_os = "windows") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        } else {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = client.get(url)
            .header("User-Agent", "HyperStream-Engine/1.0")
            .send()
            .await
            .map_err(|e| format!("Network error downloading yt-dlp: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        let bytes = response.bytes().await
            .map_err(|e| format!("Failed to read yt-dlp payload: {}", e))?;

        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp_file = bin_dir.join(format!("yt-dlp-temp-{}.tmp", nonce));
        std::fs::write(&temp_file, &bytes)
            .map_err(|e| format!("Failed to write yt-dlp temp file: {}", e))?;

        if target_file.exists() {
            let _ = std::fs::remove_file(&target_file);
        }

        std::fs::rename(&temp_file, &target_file)
            .map_err(|e| format!("Failed to finalize yt-dlp binary: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&target_file)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&target_file, perms)
                .map_err(|e| e.to_string())?;
        }

        Ok(target_file)
    }

    pub async fn download_aria2c() -> Result<PathBuf, String> {
        #[cfg(target_os = "windows")]
        {
            let bin_dir = Self::get_bin_dir();
            let target_file = bin_dir.join("aria2c.exe");

            let url = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

            let response = client.get(url)
                .header("User-Agent", "HyperStream-Engine/1.0")
                .send()
                .await
                .map_err(|e| format!("Network error downloading aria2: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("Download failed with status: {}", response.status()));
            }

            let bytes = response.bytes().await
                .map_err(|e| format!("Failed to read aria2 payload: {}", e))?;

            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let temp_zip = bin_dir.join(format!("aria2-temp-{}.zip", nonce));
            let temp_extract = bin_dir.join(format!("aria2-extract-{}", nonce));
            let _ = std::fs::create_dir_all(&temp_extract);

            std::fs::write(&temp_zip, &bytes)
                .map_err(|e| format!("Failed to write aria2 zip: {}", e))?;

            let ps_script = format!(
                "Expand-Archive -Path '{zip}' -DestinationPath '{dest}' -Force; \
                $found = Get-ChildItem -Path '{dest}' -Filter 'aria2c.exe' -Recurse | Select-Object -First 1; \
                if ($found) {{ Copy-Item -Path $found.FullName -Destination '{target}' -Force }}; \
                Remove-Item -Path '{zip}' -Force -ErrorAction SilentlyContinue; \
                Remove-Item -Path '{dest}' -Recurse -Force -ErrorAction SilentlyContinue",
                zip = temp_zip.to_string_lossy().replace('\\', "\\\\"),
                dest = temp_extract.to_string_lossy().replace('\\', "\\\\"),
                target = target_file.to_string_lossy().replace('\\', "\\\\")
            );

            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-Command", &ps_script]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let output = cmd.output().map_err(|e| e.to_string())?;

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }

            if target_file.is_file() {
                Ok(target_file)
            } else {
                Err("Failed to extract aria2c.exe to target directory".to_string())
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("Autonomous aria2c installation is only configured for Windows platforms".to_string())
        }
    }

    pub fn create_command(binary_name: &str) -> Result<Command, String> {
        let binary_path = Self::find_binary(binary_name)
            .ok_or_else(|| format!("Required binary '{}' was not found on system PATH or in managed directory", binary_name))?;

        let mut cmd = Command::new(binary_path);

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
    fn test_bin_dir_creation() {
        let bin_dir = BinaryManager::get_bin_dir();
        assert!(bin_dir.exists(), "Binary directory should exist");
    }

    #[test]
    fn test_status_reporting() {
        let status = BinaryManager::get_status();
        assert_eq!(status.ytdlp.name, "yt-dlp");
        assert_eq!(status.ffmpeg.name, "ffmpeg");
        assert_eq!(status.aria2c.name, "aria2c");
        // We know ffmpeg and yt-dlp exist on this system
        assert!(status.ytdlp.available, "yt-dlp should be discovered on system");
        assert!(status.ffmpeg.available, "ffmpeg should be discovered on system");
    }

    #[test]
    fn test_create_command_flags() {
        let cmd = BinaryManager::create_command("ffmpeg");
        assert!(cmd.is_ok(), "Creating command for discovered ffmpeg should succeed");
    }
}
