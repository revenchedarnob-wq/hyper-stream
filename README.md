# HyperStream

Ultra-low latency live media workstation, stream sniffer, and desktop browsing engine built for Windows 11 using Tauri v2, Rust, React 19, and Microsoft WebView2.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Key Innovations and Features](#key-innovations-and-features)
   - [Native Chromium Extension Engine](#1-native-chromium-extension-engine)
   - [Brave Shields and High-Speed YouTube Ad Skipper](#2-brave-shields-and-high-speed-youtube-ad-skipper)
   - [In-App Extension Store and CRX Auto-Unpacker](#3-in-app-extension-store-and-crx-auto-unpacker)
   - [Zero-Idle CPU and Potato PC Optimization Engine](#4-zero-idle-cpu-and-potato-pc-optimization-engine)
   - [Windows 11 Fluent 2 Shell and Specular Materials](#5-windows-11-fluent-2-shell-and-specular-materials)
   - [Zero-File Web Audio Micro-Haptics](#6-zero-file-web-audio-micro-haptics)
   - [Live Media Sniffer and Stream Gateway](#7-live-media-sniffer-and-stream-gateway)
   - [Next-Gen Media Ingestion and DRM Decryption Engine](#8-next-gen-media-ingestion-and-drm-decryption-engine)
3. [Deep-Dive: Technical Challenges and Solutions](#deep-dive-technical-challenges-and-solutions)
   - [The YouTube Video Black Screen Trap](#challenge-1-the-youtube-video-black-screen-trap)
   - [Running Real Chromium Extensions in WebView2](#challenge-2-running-real-chromium-extensions-in-webview2)
   - [Eliminating PowerShell Console Windows During Native Calls](#challenge-3-eliminating-powershell-console-windows-during-native-calls)
   - [Window Region Clipping and Subpixel Sharpness](#challenge-4-window-region-clipping-and-subpixel-sharpness)
4. [Project Structure and File Map](#project-structure-and-file-map)
5. [Getting Started and Local Development](#getting-started-and-local-development)
6. [Testing and Verification](#testing-and-verification)
7. [Building for Production](#building-for-production)
8. [License and Attribution](#license-and-attribution)

---

## System Architecture

HyperStream couples a high-performance native Rust core with a modern React 19 / TypeScript interface rendered via Microsoft WebView2.

```
+-------------------------------------------------------------------------+
|                              HyperStream Shell                          |
|                                                                         |
|  +---------------------------+  +------------------------------------+  |
|  |     React 19 Frontend     |  |       Native Windows WebView2      |  |
|  |                           |  |                                    |  |
|  |  * Studio Hub / Library   |  |  * In-App Browser                  |  |
|  |  * SpeedDial / Presets    |  |  * Shields Injection Scriptlet     |  |
|  |  * Extension Store Modal  |  |  * Native Chromium Extensions      |  |
|  |  * Web Audio Haptics      |  |    (AdGuard, uBlock, SponsorBlock) |  |
|  |  * Hardware Profiler      |  |  * Network Sniffer IPC             |  |
|  +---------------------------+  +------------------------------------+  |
|                |                                   |                    |
|                +-----------------+-----------------+                    |
|                                  |                                      |
|                                  v                                      |
|               +-------------------------------------+                   |
|               |       Tauri v2 IPC Bridge (Rust)    |                   |
|               +-------------------------------------+                   |
|                                  |                                      |
|       +--------------------------+--------------------------+           |
|       |                          |                          |           |
|       v                          v                          v           |
|  +----------------+      +----------------+      +----------------+     |
|  | Windows DWM    |      | Win32 Process  |      | Extension      |     |
|  | Acrylic & Blur |      | Memory Trimmer |      | Manager & CRX  |     |
|  | Compositor     |      | EmptyWorkingSet|      | Extractor      |     |
|  +----------------+      +----------------+      +----------------+     |
+-------------------------------------------------------------------------+
```

### Core Technologies

- **Runtime & Desktop Layer**: Tauri v2 (`tauri`, `tauri-build`, `tauri-plugin-single-instance`, `tauri-plugin-log`)
- **Native Windows Bindings**: `windows-sys` (0.59) exposing Win32 JobObjects, Threading, DWM, and Process Status APIs
- **Embedded Browser**: Microsoft Edge WebView2 via `wry` (0.55) with raw COM profile manipulation
- **UI Framework**: React 19 with Vite 8 and TypeScript (strict mode)
- **Audio Feedback**: Custom Web Audio API procedural synthesis engine (zero audio asset files)
- **Quality Assurance**: Vitest unit testing suite with server-side DOM verification

---

## Key Innovations and Features

### 1. Native Chromium Extension Engine

Unlike generic embedded browsers that restrict extensions or rely solely on user-scripts, HyperStream leverages Microsoft WebView2's native profile extension APIs (`ICoreWebView2Profile7::AddBrowserExtension`).

- **Unpacked Profile Loading**: Unpacked extensions located in `%LOCALAPPDATA%\com.hyperstream.desktop\browser_extensions\` are registered directly into the active browser profile.
- **Full Chromium API Compatibility**: Running natively inside the Chromium runtime grants loaded extensions access to internal web APIs, declarativeNetRequest, content scripts, and background service workers.
- **Dedicated Profile Isolation**: The browser session maintains an independent data directory from the main desktop application shell, preventing storage locks or credential conflicts.

### 2. Brave Shields and High-Speed YouTube Ad Skipper

The embedded browser features a multi-tiered privacy shield:

- **Network-Level Interception**: Custom zero-latency wrappers around `window.fetch` and `XMLHttpRequest` block analytics, telemetry, and tracking beacons matching over 70 known tracking domains.
- **GPU-Accelerated Cosmetic Blocking**: Injected CSS hides advertising banners, sponsored cards, interstitial popups, and tracker frames without triggering layout shifts.
- **Anti-Black-Screen YouTube Skipping**: Uses a dedicated high-speed scriptlet (`skipYouTubeAds`) that accelerates in-stream video ads to 16x speed, mutes their audio, and triggers the native skip button in less than 50 milliseconds without altering `<video>` element DOM visibility.
- **Automated Cookie and GDPR Dismissal**: Periodically scans for and auto-accepts standard GDPR/cookie consent prompts.

### 3. In-App Extension Store and CRX Auto-Unpacker

HyperStream includes a built-in Extension Store with support for official community packages:

- **Curated Official Repositories**: Direct integration with verified releases for AdGuard AdBlocker, uBlock Origin, SponsorBlock for YouTube, Dark Reader, and Return YouTube Dislike.
- **Autonomous CRX3 Unpacking**: Binary parser strips the 16-byte CRX3 header (`Cr24` magic bytes, version metadata, and protobuf signatures) and unpacks the embedded PKZip archive directly to the extensions directory.
- **Developer Sideloading**: A "Load Unpacked..." directory picker allows loading any custom or privately authored manifest-based extension from the local filesystem.

### 4. Zero-Idle CPU and Potato PC Optimization Engine

To ensure smooth operation even on budget hardware and integrated GPUs:

- **GPU Tier Classification**: Probes the WebGL unmasked renderer string on boot to automatically categorize hardware into High, Mid, Low, or Potato tiers.
- **Event-Driven Parallax**: Eliminates continuous `requestAnimationFrame` polling. Visual transforms only calculate during active cursor drag operations.
- **Window Inactivity Freezing**: On window blur or minimize, CSS animations halt and the audio context suspends, reducing idle CPU usage to 0.00%.
- **Native Working Set Trimming**: Hooks into `tauri::WindowEvent::Focused(false)` to call the Win32 `EmptyWorkingSet(GetCurrentProcess())` API, purging inactive pages from physical RAM.
- **CSS Virtualization**: Uses `content-visibility: auto` and `contain-intrinsic-size` on long media feeds to prune off-screen DOM subtrees from browser layout and paint passes.

### 5. Windows 11 Fluent 2 Shell and Specular Materials

- **Frameless Window Chrome**: Custom window titlebar with integrated maximize, minimize, and close actions.
- **Acrylic and DWM Composition**: Native desktop acrylic translucency enabled via `window-vibrancy`.
- **Light and Dark Mode Integration**: Real-time polling of Windows 11 system accent colors via the Windows Registry (`HKEY_CURRENT_USER\Software\Microsoft\Windows\DWM`).
- **Clean Border Bounds**: Win32 window clipping without GDI region corner artifacts.

### 6. Zero-File Web Audio Micro-Haptics

Every button, slider, and toggle switch provides auditory and tactile feedback synthesized entirely at runtime using the browser's Web Audio API:

- `playHapticClick`: 1200 Hz sine oscillator with 25ms exponential gain decay.
- `playHapticGlass`: Dual 2400 Hz / 3600 Hz triangle oscillator simulating resonant glass.
- `playHapticPop`: Frequency-swept tone (300 Hz to 80 Hz) with bandpass filtering.
- `playHapticSwoosh`: Procedural white noise buffer passed through an automated biquad bandpass sweep.

### 7. Live Media Sniffer and Stream Gateway

- Automatically detects streaming protocols (HLS/m3u8, MP4, WebM, DASH) loaded inside the webview.
- Surfaces a quick-action toolbar permitting one-click ingestion into the media capture pipeline or studio player.

### 8. Next-Gen Media Ingestion and DRM Decryption Engine

HyperStream houses an engineered, verified media ingestion architecture that overcomes both server-side concurrent stream-slot locks and Widevine L3 DRM encryption.

- **The Crunchyroll Stream-Slot Release Hack ("Fetch & Delete")**: Solves `403 Forbidden: All Crunchyroll playback slots are occupied` by capturing signed DASH manifest URLs and immediately issuing `DELETE /playback/v1/token/{guid}/{play_token}` within milliseconds. The edge CDN caches remain downloadable for hours, enabling unrestricted parallel batch downloads and multi-audio dub fetching without account lockouts.
- **Hardware Widevine L3 CDM Pipeline**: Built on `%USERPROFILE%\.hyperstream\device.wvd` with an automated license proxy handshake (`https://cr-license-proxy.prd.crunchyrollsvc.com/v1/license/widevine`) and a persistent key cache (`keys.txt` with 68 verified cached keys) that enables sub-millisecond decryption startup.
- **The 100x Efficiency Leap**:
  - Zero-Disk In-Memory IPC: Passes download payloads between Native Host and Worker via Base64 CLI arguments (0 bytes written to SSD).
  - Pre-Parsed In-Memory CDM Memoization: Reduces CDM path discovery and RSA parsing from ~192ms to 0.0001ms.
  - Sub-Millisecond ISO Atom Inspection: Binary header parsing (`moov/trak/stsd`) replaces slow 250ms FFmpeg subprocesses with 0.18ms integrity checks.
  - Simultaneous Multi-Track Concurrency: Downloads 1080p video, all audio dubs (JA/EN/HI), and subtitles concurrently rather than sequentially, saving 10-20 seconds per episode.
- **Universal Engine 95% & Canvas/WASM Scrambler**:
  - Intercepts post-decrypted frames from WebAssembly-scrambled video directly at the HTML5 `<canvas>` layer using GPU `captureStream(60)` synced with WebAudio.
  - Turbo In-Browser HUD: Supports 1x, 2x, and 4x playback rate acceleration with automatic recording cessation upon media completion.
  - Zero-CPU Debounced MutationObserver: Replaces polling loops with zero-idle DOM mutation scanning.
  - Punctuation-Independent Skip Engine: Sub-10ms matching prevents duplicate downloads across varying filename conventions.
- **Full Technical Manual**: For complete sequence diagrams, benchmark logs, and implementation details, see [ENGINE.md](file:///A:/Hyper-stream/ENGINE.md).

---

## Deep-Dive: Technical Challenges and Solutions

### Challenge 1: The YouTube Video Black Screen Trap

#### The Symptom
When ad-blocking rules were applied to YouTube, videos frequently loaded with a solid black screen. The audio played normally and the time counter progressed, but the video surface was unrendered.

#### The Investigation
YouTube renders pre-roll, mid-roll, and post-roll video advertisements inside the **exact same HTML5 `<video>` element** as the actual video content. Traditional ad-blocker cosmetic CSS rules often include selectors such as:

```css
/* Defective pattern */
.video-ads,
.ad-showing video,
#player-ads {
  display: none !important;
}
```

When YouTube transitioned into the ad state (`.ad-showing`), Chromium matched the CSS rule and unrendered the video surface (`display: none`). While the underlying Web Audio pipeline remained active and the playback clock ticked, the video frame was completely hidden.

#### The Solution
1. Removed all rules targeting `<video>` tags or player surfaces from both `shields_script.js` and `shields-engine.ts`.
2. Implemented an AdGuard-style programmatic skip loop:

```javascript
function skipYouTubeAds() {
  var adShowing = document.querySelector('.ad-showing, .ad-interrupting');
  var video = document.querySelector('video');
  if (adShowing && video) {
    video.playbackRate = 16;
    video.muted = true;
    if (isFinite(video.duration) && video.duration > 0) {
      video.currentTime = video.duration;
    }
  }
  var skipBtn = document.querySelector(
    '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-text'
  );
  if (skipBtn && typeof skipBtn.click === 'function') {
    skipBtn.click();
  }
}
```

This ensures the video element remains continuously visible, while in-stream ads are fast-forwarded and dismissed in under 50 milliseconds.

---

### Challenge 2: Running Real Chromium Extensions in WebView2

#### The Problem
Visiting the Microsoft Edge Add-ons store or Chrome Web Store in WebView2 disabled the "Get" and "Add to Chrome" buttons, displaying a warning requiring Microsoft Edge. This occurred because web stores communicate with proprietary internal APIs (`edge.addonsPrivate` / `chrome.webstorePrivate`) absent in embedded runtimes. Furthermore, passing `--load-extension` via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is unsupported and ignored by WebView2.

#### The Solution
1. Configured the WebView2 builder in Tauri to enable extensions and bind to an explicit extensions directory:

```rust
let webview_builder = tauri::webview::WebviewBuilder::new("in_app_browser", url)
    .browser_extensions_enabled(true)
    .extensions_path(&ext_dir)
    .data_directory(browser_data_dir);
```

2. Under the hood, Wry initializes `CoreWebView2EnvironmentOptions.set_are_browser_extensions_enabled(true)`. On startup, it enumerates the folder and invokes `ICoreWebView2Profile7::AddBrowserExtension`.
3. Built an automated Rust-based extractor for `.crx` and `.zip` archives. For `.crx` files, the binary format is parsed to find the start of the embedded ZIP data (`12 + header_length`), which is extracted into a named subfolder.
4. Pre-installed official builds of AdGuard AdBlocker and uBlock Origin directly into the application data directory.

---

### Challenge 3: Eliminating PowerShell Console Windows During Native Calls

#### The Problem
When invoking native system operations (such as folder picking, task management, or archive extraction) via child PowerShell processes, an empty black console window flashed on the screen, disrupting the user experience.

#### The Solution
Added creation flags to all `std::process::Command` calls on Windows using `std::os::windows::process::CommandExt`:

```rust
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

Command::new("powershell")
    .creation_flags(CREATE_NO_WINDOW)
    .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
    .output();
```

This forces the Windows process manager to spawn background worker tasks without allocating a console window or stealing desktop focus.

---

### Challenge 4: Window Region Clipping and Subpixel Sharpness

#### The Problem
Using Win32 `SetWindowRgn` with rounded rectangle geometry on Windows 11 caused jagged, pixelated edge artifacts along the borders of the webview, clashing with the modern DWM anti-aliased compositor.

#### The Solution
Eliminated `SetWindowRgn` custom shaping in favor of standard rectangular bounds synchronized directly to the CSS viewport coordinate matrix. Rounded card aesthetics are maintained inside CSS using `border-radius` and `overflow: hidden`, while the native WebView2 controller renders flush to the inner viewport.

---

## Project Structure and File Map

```
Hyper-stream/
└── app-preview/
    ├── src-tauri/                       # Native Rust Core
    │   ├── src/
    │   │   ├── main.rs                  # Application entry point
    │   │   ├── lib.rs                   # Core IPC handlers, WebView2 setup, Win32 bindings
    │   │   └── shields_script.js        # Zero-latency tracker & ad-blocking injection script
    │   ├── icons/                       # High-resolution application icons (ICO, PNG, ICNS)
    │   ├── Cargo.toml                   # Rust dependencies and release profiles
    │   └── tauri.conf.json              # Tauri v2 bundle and window configuration
    │
    ├── src/                             # React 19 Frontend
    │   ├── components/
    │   │   ├── browser/                 # Embedded Browser Module
    │   │   │   ├── InAppBrowser.tsx     # Primary browser workspace component
    │   │   │   ├── BrowserToolbar.tsx   # Navigation bar with Shields & Extension triggers
    │   │   │   ├── SpeedDial.tsx        # New-tab speed dial launchpad
    │   │   │   ├── ExtensionStoreModal.tsx # Extension store and management interface
    │   │   │   ├── shields-engine.ts    # Shields ruleset and cosmetic CSS definitions
    │   │   │   ├── url-utils.ts         # Stream detection and search engine resolution
    │   │   │   ├── Icons.tsx            # SVG vector icon suite
    │   │   │   └── browser.css          # Visual styling for the browser subsystem
    │   │   ├── library/                 # Media library management
    │   │   ├── stream/                  # Live stream capturing and player
    │   │   └── window/                  # Custom Windows 11 titlebar and controls
    │   │
    │   ├── lib/
    │   │   ├── hardware-profiler.ts     # WebGL renderer detection and GPU tier analysis
    │   │   ├── zero-idle-engine.ts      # Window focus tracking and CPU throttling
    │   │   ├── sound.ts                 # Web Audio micro-haptics procedural engine
    │   │   └── tauri-bridge.ts          # IPC helper functions and environment detection
    │   │
    │   ├── App.tsx                      # Root application layout
    │   ├── App.css                      # Global styles and design system variables
    │   └── main.tsx                     # React client mounting entry
    │
    ├── package.json                     # Frontend dependencies and npm scripts
    ├── tsconfig.json                    # TypeScript compiler configuration
    └── vite.config.ts                   # Vite bundler configuration
```

---

## Getting Started and Local Development

### Prerequisites

- **Windows 10 / 11** (x64)
- **Node.js**: v18.0 or newer
- **Rust**: stable toolchain (`rustup default stable`, MSVC target)
- **C++ Build Tools**: Visual Studio Build Tools with C++ workload
- **Microsoft Edge WebView2 Runtime**: Pre-installed on Windows 11

### Setup Steps

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/revenchedarnob-wq/hyper-stream.git
   cd hyper-stream/app-preview
   ```

2. **Install Node Dependencies**:
   ```bash
   npm install
   ```

3. **Verify Development Toolchain**:
   ```bash
   # Verify Rust compilation
   cargo check --manifest-path src-tauri/Cargo.toml

   # Verify TypeScript and linting
   npm run build
   ```

4. **Launch the Desktop Application in Development Mode**:
   ```bash
   npm run tauri dev
   ```

---

## Testing and Verification

HyperStream maintains a comprehensive test suite using Vitest with tests verifying both client components and core algorithms:

```bash
npm run test
```

### Key Test Coverage:

- `hardware-profiler.test.ts`: Validates GPU tier regex matching across NVIDIA, AMD, Apple, and Intel chips, including fallback handling.
- `shields-engine.test.ts`: Ensures the cosmetic CSS ruleset never matches video elements, preventing YouTube black-screen regressions.
- `url-utils.test.ts`: Verifies search query construction, protocol normalization, and media stream URL sniffing.
- `zero-idle-engine.test.ts`: Asserts proper listener registration and cleanup during window blur/focus cycles.
- `ExtensionStoreModal.test.tsx`: Validates modal rendering, category filtering, search input, and accessibility attributes.

---

## Building for Production

To create an optimized, standalone Windows installer (`.msi` and `.exe` via NSIS):

```bash
# Build production assets and compile native binary
npm run tauri build
```

The output installers and standalone binaries are generated in:
`src-tauri/target/release/bundle/`

---

## License and Attribution

- **License**: MIT License. See `LICENSE` for details.
- **Brave Shields**: Rule formats inspired by Brave Browser's ad-block and tracking protection standards.
- **Extensions**: AdGuard, uBlock Origin, SponsorBlock, Dark Reader, and Return YouTube Dislike are properties of their respective open-source creators.
