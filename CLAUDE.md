# HyperStream

Windows 11 media workstation: Tauri v2 (Rust) + React 19 + TypeScript + Vite, WebView2.
App lives in `app-preview/`. Backend: `app-preview/src-tauri/src/`. Frontend: `app-preview/src/`.

## Commands (run in `app-preview/`)
- Frontend: `npm run dev` · `npm run build` · `npm test` (vitest) · `npm run lint` (oxlint)
- App: `npm run tauri dev`
- Rust (in `src-tauri/`): `cargo build` · `cargo test`

## Backend layout
- `src/lib.rs` — Tauri commands + `generate_handler!` registration.
- `src/downloader/` — legit media pipeline (yt-dlp / aria2c / FFmpeg on user URLs):
  - `orchestrator.rs` downloads, progress events (`download-progress|complete|error`)
  - `extractor.rs` metadata/format probing · `binary_manager.rs` engine binaries
  - `container.rs` `FastAtomInspector` (MP4 box validation)
  - `error_classifier.rs` raw stderr → friendly message (planned)

## Quarantine boundary (hard rule)
`src-tauri/src/downloader/quarantine/` is isolated behind the non-default Cargo
feature `experimental-drm`. Never enable, fix, extend, or build on it. Default and
release builds must not reference it. Build/test with default features only.

## Workflow
- Big multi-file features: short spec → executed by Antigravity (Gemini agent).
- Small edits: done directly. Keep specs free of DRM-related terminology.
