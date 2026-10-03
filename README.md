# HyperStream

A Windows 11 desktop app for downloading videos and music from the web. Built with Tauri v2 (Rust), React 19, TypeScript and WebView2. Downloads run on [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/).

## Features

- **Paste a link and download.** HyperStream checks the link first and shows the title, thumbnail, length and site.
- **Real choices only.**
  - Quality lists the sizes the source actually has.
  - An **Audio** picker appears only when a video has more than one language.
  - A **Subtitles** picker appears only when subtitles exist.
- **Playlists and channels.** Download all entries in one step (up to 300).
- **Download queue.**
  - Pause, resume, retry, reorder and remove downloads, and choose how many run at once.
  - Progress, speed and time left come from yt-dlp itself.
  - The queue survives restarts.
- **Built-in browser.**
  - Sign in to sites that need an account (Instagram, private videos, members-only content). Downloads reuse that session.
  - A **Download** button appears on video pages, and right-clicking a link, video or page offers **Download with HyperStream**.
  - Real back/forward history, sign-in popups, links that open in a new tab, full-screen video, and Ctrl+L / F5 / Alt+arrow shortcuts.
  - **Shields** block ad and tracker requests, with a per-site off switch and a live count of what was blocked.
  - **Settings → Browser** manages Shields and the sites where they're off, and **Clear browsing data** signs you out of every site.
  - A page you leave in the background is put to sleep after 30 seconds (unless it's playing sound), so it stops using CPU and gives back memory. It wakes instantly when you return.
  - **Extensions** install straight from the Chrome Web Store or Edge Add-ons: open an extension's store page and click **Add to HyperStream**, or paste its link in Extensions. They turn on, off and uninstall instantly, open their settings pages, and update themselves daily.
- **Media library.**
  - Every finished download is listed with its thumbnail, quality, size and languages.
  - Play it, show it in Explorer, or remove it (optionally moving the file to the Recycle Bin).
- **Batch import.** Drop a `.txt` file of links, or drag links onto the Hub.
- **Zero setup.**
  - On first run, yt-dlp and FFmpeg are downloaded into the app's data folder, plus Deno, which yt-dlp needs to see every YouTube quality.
  - yt-dlp updates itself weekly. You can also update it from Settings → Downloads.

Output goes to `Videos\HyperStream` by default; you can change this in Settings.
- Video is saved as **MP4**, or **MKV** when you add subtitles or several audio languages.
- Audio-only is saved as **M4A**.
- Subtitles are embedded in the file, not saved as separate files.

## Where things live

| What | Location |
| --- | --- |
| Downloads (default) | `%USERPROFILE%\Videos\HyperStream` |
| Queue, library, thumbnails | `%APPDATA%\HyperStream\` |
| yt-dlp / FFmpeg / Deno | `%LOCALAPPDATA%\com.hyperstream.desktop\bin\` (or on `PATH` if already installed) |
| Browser profile and extensions | `%LOCALAPPDATA%\com.hyperstream.desktop\` (`browser_profile`, `browser_extensions`, `browser_extensions.json`) |

Browser cookies are read at download time and written to a temporary file that is deleted afterwards. They are never stored by HyperStream.

## Development

Prerequisites: Windows 10/11 x64, Node.js 18+, Rust stable (MSVC), Visual Studio C++ Build Tools, WebView2 runtime (preinstalled on Windows 11).

All commands run in `app-preview/`:

```bash
npm install
npm run tauri dev        # run the desktop app
npm test                 # frontend unit tests (vitest)
npm run lint             # oxlint
npm run build            # type-check + production frontend build
cd src-tauri && cargo test   # backend tests
```

Debug builds include an end-to-end check of the built-in browser (navigation, Shields, snapshots, extension install/enable/remove against the real stores). Point `LOCALAPPDATA`/`APPDATA` at a scratch folder so it doesn't touch your profile, then run `target\debug\HyperStream.exe` with `HS_BROWSER_SELFTEST=1` and `HS_BROWSER_SELFTEST_LOG=<file>`.

### Layout

```
src-tauri/src/
  lib.rs                   Tauri commands and app setup
  shields_script.js        Shields page script (cosmetic cleanup, cookie banners)
  browser/
    mod.rs                 built-in browser view, commands, full screen
    native.rs              WebView2 access: history, context menu, shortcuts, blocking, extensions
    extensions.rs          install from Chrome Web Store / Edge Add-ons / folder, update, remove
    package.rs             .crx and .zip unpacking
    shields.rs             ad/tracker block list and per-site settings
  downloader/
    orchestrator.rs        queue, workers, yt-dlp process + progress parsing
    queue.rs               persistent priority queue
    extractor.rs           link probing (formats, audio tracks, subtitles, playlists)
    binary_manager.rs      yt-dlp / FFmpeg discovery, install and update
    library.rs             library of finished downloads
    cookies.rs             browser session → Netscape cookie file
    error_classifier.rs    yt-dlp errors → plain-language messages
src/
  components/stream-hub/   paste box, queue, recent downloads, batch import
  components/media-library/
  components/browser/      built-in browser, extensions, start page
  components/settings/
  lib/                     Tauri bridge, settings store, hooks, formatting
```

## Building an installer

```bash
npm run tauri build
```

Installers (`.exe` via NSIS and `.msi`) are written to `src-tauri/target/release/bundle/`.

Before publishing:

- **Code signing.** Unsigned installers trigger Windows SmartScreen warnings. Sign with an Authenticode certificate. See `bundle.windows.certificateThumbprint` or `signCommand` in `tauri.conf.json`.
- **FFmpeg licence.** The app downloads a GPL build of FFmpeg at first run; it is not bundled. Mention this in your licence notice (Deno is MIT).
- **Terms of use.** Users are responsible for respecting the terms of the sites they download from and applicable copyright law. HyperStream does not bypass DRM.

## Licence

MIT. yt-dlp (Unlicense), FFmpeg (GPL/LGPL) and the browser extensions are the work of their respective authors.
