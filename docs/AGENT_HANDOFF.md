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
