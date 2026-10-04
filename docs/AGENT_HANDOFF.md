# HyperStream — Engineering Handoff Report for Claude

**Date**: October 3, 2026  
**Author**: Antigravity (Principal Creative Technologist & System Architect)  
**Target Audience**: Claude Code / Claude Engineer  
**Workspace**: `A:\Hyper-stream\app-preview`  

---

## 1. Executive Summary

Over recent iterations, the HyperStream application underwent major visual, architectural, and reliability upgrades. The focus centered on:
1. **Purging "AI-Slop" Clutter**: Eliminating artificial marketing badges, feature ribbons, noisy input shortcuts, and neon text gradients in favor of an authentic, zen-like desktop aesthetic (Arc / Safari / Raycast language).
2. **Start Page & Speed Dial Elevation**: Streamlining the launcher into floating 54px frosted squircle app icons, making the Quick Add suggestions dock genuinely removable (with zero leftover residue), and completely eliminating legacy duplicate CSS.
3. **Complete Overhaul of the Add Bookmark Modal**: Resolving a critical translucency bug where an undefined CSS variable made the dialog transparent and let background text bleed through, portaling the dialog to `document.body` to fix container clipping, and introducing live vector icon detection and smart domain auto-fill.
4. **2K Wallpaper Engine & Unified Optical Blur**: Ingesting high-resolution 2K wallpapers, removing duplicates, enabling custom user wallpaper uploads with automatic luminance/theme detection, and establishing a unified pre-baked optical blur background canvas.
5. **Reliability & Test Hygiene**: Maintaining 100% passing tests (105/105 tests across 16 test suites) and 0 TypeScript compilation errors.

---

## 2. Detailed Breakdown of Recent Work

### A. Add Bookmark Modal Redesign (`SpeedDial.tsx`, `browser.css`)
* **Root Causes Diagnosed**:
  - **Translucency / Ghosting**: The modal background was set to `var(--surface-level-3)`, which was never defined in any stylesheet. It evaluated to `transparent`, causing the start page's giant white heading (*"Find something to download"*) and search bar to shine right through the dialog text and input fields.
  - **Backdrop Clipping**: `.content-pane` uses `backdrop-filter: blur(20px)`. Under CSS specifications, any element with a `filter` or `backdrop-filter` creates a new containing block for `position: fixed` descendants. As a result, the modal backdrop was trapped inside the content pane, leaving the sidebar and window header un-dimmed.
  - **Aesthetic**: Unstyled `<label>` and `<input>` elements with harsh purple outlines.
* **Architectural & Design Solutions Implemented**:
  - **React Portal to `document.body`**: Rendered the modal via `createPortal(modalElement, document.body)`. The backdrop overlay (`rgba(7, 9, 15, 0.68)` with `16px` blur) now covers the **entire application window** uniformly.
  - **Rich Obsidian Glass (Zero Bleed-Through)**: Styled the dialog with `background: rgba(19, 22, 34, 0.97)` (fallback `#141724`) in dark mode and `#ffffff` in light mode, reinforced with a 1.5px specular highlight top border and deep ambient drop shadow (`box-shadow: 0 24px 70px -10px rgba(0, 0, 0, 0.75)`). Zero background text bleeds through.
  - **Dynamic Brand Icon & Color Detection (`detectPreset`)**: Added real-time URL inspection. Typing domains (e.g. `twitch.tv`, `youtube.com`, `bilibili.com`, `reddit.com`, `github.com`, `netflix.com`, `crunchyroll.com`) dynamically updates the top-left badge with the matching vector icon and brand accent glow.
  - **Smart Title Auto-Fill**: Automatically infers and capitalizes the website name if the user hasn't explicitly edited the title, showing an `Auto-filled` badge.
  - **Popular Shortcuts Quick-Picker**: Added one-tap chips inside the dialog for common services to allow instant pre-filling.
  - **Polished Input Capsules**: Custom input containers featuring vector icons (`IconGlobe` for URL, `IconBookmark` for Name), subtle glass fills, and focused glowing rings.

### B. Browser Start Page & Speed Dial Refactor (`SpeedDial.tsx`, `browser.css`)
* **Purged Artificial Clutter**:
  - Deleted `.speed-dial-badge` (`HYPERSTREAM WEB & MEDIA`).
  - Deleted `.speed-dial-feature-ribbon` (`Shields Active · Direct Sniffer · Private Sandbox`).
  - Deleted noisy search omnibar badges (`↵ Enter`, `Go ↵`).
  - Replaced multi-color gradient headlines with solid, crisp `#ffffff` typography (`#0f172a` in light mode).
* **100% Removable Quick Add**:
  - Clicking the `×` button on the Quick Add suggestions bar now completely dismisses it and saves `hyperstream_speed_dial_hide_suggest: "1"` to `localStorage`.
  - Removed `.speed-dial-restore-suggest-btn`: no lingering pills or buttons remain once dismissed.
* **Floating Squircle Launcher**:
  - Replaced bulky cards-inside-cards with 54px floating squircles (16px border-radius), subtle brand-color glow on hover, and site titles centered cleanly underneath.
  - Fixed text truncation on the empty state (`Add your first site`).
  - Cleaned out over 340 lines of duplicate and conflicting legacy CSS rules from `browser.css`.

### C. Wallpaper Engine & Optical Blur System (`wallpapers.ts`, `App.tsx`, `App.css`)
* **2K Wallpaper Ingestion**: Standardized high-res 2K/4K wallpapers from `A:\Downloads\2K qualty wallpaper` into `public/wallpapers/`.
* **Deduplication**: Removed redundant duplicate wallpaper presets.
* **Custom Wallpaper Upload**: Added client-side custom wallpaper uploading with auto-luminance analysis (to switch dark/light themes dynamically) and pre-baked optical blur generation to avoid real-time GPU filter performance hits.
* **Window Hierarchy & Contrast**: Fine-tuned glass card elevation and specular rims so that content cards maintain crisp demarcation over blurred backgrounds.

### D. Brave Shields Popover UI (`ShieldsPopover.tsx`, `browser.css`)
* Upgraded the Shields popover to match the obsidian glass aesthetic.
* Wired live tracker/ad blocking counters, clean status pill toggles, and smooth popup animations without visual bugs.

### E. Download Pipeline & Queue Backend (`src-tauri/src/downloader/`)
* Verified download queue orchestrator: priority queue, bounded concurrency, pause/resume, reorder, auto-retry, and state persistence.
* Link extraction and metadata probing via yt-dlp + FFmpeg.
* Built-in browser cookie bridge and user-friendly error classification.
* **Quarantine Enforcement**: Kept `experimental-drm` strictly quarantined behind non-default Cargo feature flags.

---

## 3. Verification & Test Status

* **TypeScript Compilation**:
  ```bash
  npx tsc -p tsconfig.app.json --noEmit
  ```
  Result: **0 errors**.
* **Vitest Suite**:
  ```bash
  npm test -- --run --fileParallelism=false
  ```
  Result: **105/105 tests passing across 16 test files** (including 11/11 tests in `SpeedDial.test.tsx`).
* **Playwright Live Verification**:
  - Tested on running Tauri dev server (`http://localhost:5173/`).
  - Verified clean start page appearance, Quick Add dismissal with zero leftover pills, full-window modal blur scrim, live Twitch brand detection, and bookmark submission.

---

## 4. Key Architectural Patterns & Constraints for Claude

> [!IMPORTANT]
> **Key Rules & Invariants to Maintain:**

1. **Window Containing Block Rule for Fixed Modals**:
   - Any ancestor with `backdrop-filter`, `transform`, `filter`, or `perspective` will trap `position: fixed` children.
   - For any modal or dialog that must cover the entire desktop window (like `Add Bookmark` or full overlays), **always use React `createPortal(element, document.body)`**.
2. **Anti-Slop / Aesthetic Principles**:
   - The user strictly dislikes artificial AI-generated flourishes (marketing badges, feature ribbons, fake stats, pink/purple multi-color text gradients).
   - Preserve clean, calm minimalism: solid typography, subtle glass capsules, floating squircles, and restrained motion.
3. **SpeedDial Test Invariants (`SpeedDial.test.tsx`)**:
   - HTML must contain `Find something to download`.
   - HTML must contain `speed-dial-search` and `speed-dial-add-tile`.
   - HTML must NOT contain `Brave`, `Bandwidth Saved`, or `CPU Cycles`.
   - Zero emojis anywhere in the rendered HTML output.
   - `DEFAULT_SPEED_DIAL_PRESETS` must maintain an array length of exactly 6.
4. **DRM Quarantine Boundary (`CLAUDE.md`)**:
   - `src-tauri/src/downloader/quarantine/` is isolated behind `experimental-drm`.
   - Never enable, fix, or reference it in standard builds. Build and test with default features only.
5. **Windows Node & Vitest Memory Note**:
   - When running Vitest on Windows, parallel worker forks can exhaust process handles or heap memory (`spawn UNKNOWN` / `out of memory`).
   - Run tests sequentially using: `npm test -- --run --fileParallelism=false` or with `$env:NODE_OPTIONS="--max-old-space-size=4096"`.

---

## 5. Update (Claude, Oct 3 2026) — invariants added

* **Window corners:** native window uses Windows 11 DWM rounding (`"shadow": true` in `tauri.conf.json`) with `--radius-window: 8px` under `html.is-tauri`. DWM clips the native browser page too. Do not set `shadow: false` or re-add CSS clip-paths/HWND regions.
* **Unfocused window:** only looping animations are paused (`App.css`, the `:is(...)` list). Never pause all animations — entrance animations start at opacity 0 and views go blank. Add new infinite animations to that list.
* **Start-page shortcuts:** single store in `src/components/browser/shortcuts.ts` (`useShortcuts`, `setShortcuts`, `findShortcut`, `detectSite`). Used by the start page and the address-bar star / Ctrl+D. Do not read `hyperstream_speed_dial_custom` directly elsewhere.
* **Site logos:** `site_icon` command (`src-tauri/src/browser/site_icon.rs`) fetches from the site itself (never a third-party favicon service), caches in `%LOCALAPPDATA%\com.hyperstream.desktop\site-icons`. The built-in browser also saves each visited site's favicon there (`native.rs`, FaviconChanged).
* **Colours:** use `tint(color, pct)` (color-mix) — never append hex alpha to a colour string.
* **Taskbar & notifications:** taskbar progress from `StreamHub` via `setTaskbarProgress`; "Download finished" notification + taskbar flash from `orchestrator.rs` only when the window is not focused. Window size/position/maximized persisted by `tauri-plugin-window-state`; sidebar state in `hyperstream_sidebar_open`.
* **Shutdown:** never call `app.exit` directly from UI paths — use `shut_down()` in `lib.rs` (hides windows, closes WebView2 engines, waits ≤3 s so localStorage/cookies are written). `RunEvent::ExitRequested` routes through it.
* **Engine downloads:** every download passes `download_to_file(url, sums_url, …)`, which refuses files whose SHA-256 doesn't match the published list. Versions are cached in `bin/versions.json` keyed by file size + mtime.
* **Fonts:** bundled via `@fontsource-variable/*` (imported in `main.tsx`). CSP no longer allows Google Fonts; don't add remote font/style links.
* **Opening files:** `open_media_file` only accepts media/subtitle/image extensions (`library::is_openable_media`).
* **GPU layers (measured with CDP LayerTree):** the UI must stay at ~1 composited layer when idle. No permanent `will-change`, `translateZ(0)` or `translate3d` on static elements; wallpaper layers get `will-change` only under `.is-dragging`; entrance animations use fill-mode `backwards` (never `both`).
* **Startup work:** Library, Settings and Browser are `React.lazy` chunks preloaded at idle; the Browser mounts on first visit. Don't add eager imports of them in `App.tsx`.
* **Window:** opaque (`transparent: false`, `backgroundColor`), Windows draws the rounded corners and shadow. The UI engine drops to a low memory target while minimized (`browser::on_main_minimized`).
* **Audio:** the WebAudio context sleeps 2.5 s after the last sound and is closed after 30 s (frees WebView2's audio process). Never resume it eagerly.
* **Thumbnails:** downloads' thumbnails are shrunk to ≤640 px wide with FFmpeg after completion (`library::shrink_thumbnail`). Wallpaper picker uses `public/wallpapers/thumbs/*.webp`; full JPEGs are dropped from `tauri build` by the Vite plugin in `vite.config.ts`.
* **Efficiency mode:** decided once on first launch with the same rule Settings recommends (≤4 GB RAM, ≤4 cores or integrated GPU), then saved; the user's choice wins after that.
* **Performance budgets:** `npm run perf:smoke` (after `npx tauri build --no-bundle`) launches the release exe and fails on: exe > 12 MB, main JS > 340 KB, startup CSS > 110 KB, first paint > 900 ms, any screen blank while unfocused, > 2 GPU layers or layer area > 1.1× window at idle, any running animation at idle, idle CPU > 1.5%. Run it before merging UI work.
* **No endless animations** on anything that stays on screen (they redraw the whole window at 60 fps). Progress bars move with `transform: translateX`, never `width`/`left` (those re-run layout every frame).
* **Browser cookies for downloads:** only read for sites opened in the built-in browser (`browser_sites.json`, seeded once from the profile's cookies); a browser started just for cookies is unloaded after 30 s. Never call `ensure_webview` from download paths directly.
* **"Send to HyperStream":** `hyperstream://download?url=<page>` (deep-link plugin + single instance). Received pages only prefill the Hub; never start a download from a link. Settings → Browser → Other browsers has the bookmarklet.

---

## 6. Update (Claude, Oct 4 2026) — fast downloads and the browser extension

* **Fast engine (`src-tauri/src/downloader/turbo.rs`):** multi-connection HTTP/1.1 downloader. Idle connections take the back half of the biggest unfinished range; connections double (8 → 16, low-memory PCs 4 → 8) only while each step raises speed ≥20% (measured 0.5 s after a change, over 1.5 s), and a step that didn't help is undone. 429/503/refused connections shed connections; 30 s without data hands over to yt-dlp. Partial data is `<name>.hspart` + `<name>.hspart.json` (resume state). Never raise the cap above 16 by default: test servers (Hetzner, OVH) banned or rate-limited this PC after 32–64 connections. HTTP/2 must stay off for it (it would merge the connections).
* **Download pipeline (`orchestrator.rs` `run_download_task`):** (1) yt-dlp `-j` picks formats, from the Hub's recent look-up (`extractor::cached_info`, 20 min, `--load-info-json`) or the URL; (2) if every chosen stream is plain http(s), the fast engine fetches them in parallel to the exact names yt-dlp uses (`<stem>.f<id>.<ext>`); (3) yt-dlp runs again with `--load-info-json`, sees the files, and only merges/embeds/thumbnails. HLS/DASH and anything the engine can't do go through yt-dlp (`--concurrent-fragments 8`). `HYPERSTREAM_TURBO=0` turns the engine off for comparisons. YouTube requests stay ≤ `http_chunk_size` (10 MiB): bigger ones are served at ~0.4 MB/s.
* **yt-dlp is the unpacked build** (`bin/yt-dlp/yt-dlp.exe` from `yt-dlp_win.zip`, checksum-verified, unpacked with Windows' `tar.exe`): ~0.5 s per start instead of ~1.5 s. Older single-file installs are replaced automatically at startup. Freshness is the `.installed` marker's date.
* **Hub look-up** no longer waits for built-in-browser cookies: it looks up without them and retries with them only if that fails (6–7 s → ~2.8 s on YouTube).
* **Browser extension (`app-preview/extension/`, Manifest V3, Chrome/Edge/Brave):** detects video files and HLS/DASH manifests per tab (badge count), right-click "Download with HyperStream", popup, and optional takeover of browser downloads (archives, installers, disk images, media ≥ 2 MB; app unreachable → the browser download resumes). Fixed dev ID `dnhmkngncoccmkbmdbmknjjdficnmenh` (from the `key` in the manifest; the private key was not kept). Store IDs must be added to `EXTENSION_IDS` in `bridge.rs` when published.
* **Native messaging (`src-tauri/src/bridge.rs`):** the app registers `com.hyperstream.bridge` for Chrome, Edge, Brave and Chromium (HKCU) at startup. The browser starts `HyperStream.exe chrome-extension://…` (handled in `main.rs` before Tauri starts); that helper forwards each message over the named pipe `\\.\pipe\HyperStream.bridge.<user>` and starts the app if needed. Pages/media go to the Hub box (user still picks quality); caught files start immediately (`DownloadOptions.direct`) under the site's file name, skip the media library, and use the browser's cookies, Referer and User-Agent. Cookies sent by the extension are kept in memory per site for 2 h and preferred over built-in-browser cookies.
* **Measured (Oct 4):** YouTube 1080p60, paste → file: ~29 s → ~17.5 s (look-up 6.5 → 2.8 s, first byte 5 → 1.3 s); transfer is capped by YouTube at ~11.6 MB/s per PC. IDM on the same YouTube stream: 2.8 MiB/s (asks for >10 MiB ranges). Server with a 2 MB/s per-connection cap: HyperStream 20.7 MiB/s vs IDM 11.1 MiB/s. Servers that cap per PC (GitHub) are equal for everyone.
* **Not verified:** a real browser handing a download to the extension (headless Edge doesn't start downloads); everything around it is tested (extension loads, native messaging, detection, badge, helper → app → finished file).
* **Adding the extension (`src-tauri/src/extension_setup.rs`, `src/components/extension/ExtensionSetup.tsx`):** browsers never let a program install an extension silently. First launch shows a one-time dialog ("Download from Chrome" → Add to Chrome) for the default browser (from `UrlAssociations\https\UserChoice`); Settings → Browser → "Browser extension" offers the same later. With a store listing (`CHROME_STORE_ID` / `EDGE_STORE_ID`, both `None` until published — also add them to `bridge::EXTENSION_IDS`) the button opens the listing in that browser and the user confirms there. Without one, the dialog shows the Load-unpacked steps with copy buttons (browsers refuse to open `chrome://extensions` for other programs; launching `chrome.exe chrome://extensions` just opens a New Tab). The helper writes `bridge/connected-<browser>` (browser from its parent process) and the extension pings on install/startup; the app emits `extension-connected` and the dialog finishes by itself. The prompt is remembered in `hyperstream_extension_prompt`; anything that launches the app (perf:smoke, CDP tests) consumes it.
