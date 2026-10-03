# HyperStream

Windows 11 media workstation: Tauri v2 (Rust) + React 19 + TypeScript + Vite, WebView2.
App lives in `app-preview/`. Backend: `app-preview/src-tauri/src/`. Frontend: `app-preview/src/`.

## Commands (run in `app-preview/`)
- Frontend: `npm run dev` · `npm run build` · `npm test` (vitest) · `npm run lint` (oxlint)
- App: `npm run tauri dev`
- Rust (in `src-tauri/`): `cargo build` · `cargo test`

## Backend layout
- `src/lib.rs` — Tauri commands + `generate_handler!` registration.
- `src/downloader/` — media pipeline (yt-dlp + FFmpeg on user URLs):
  - `orchestrator.rs` queue workers, yt-dlp process, progress events (`download-progress|complete|error`, `download-queue-changed`)
  - `queue.rs` persisted priority queue · `extractor.rs` link probing (formats, audio tracks, subtitles, playlists)
  - `binary_manager.rs` engine install/update · `library.rs` finished downloads (`library-changed`)
  - `cookies.rs` built-in browser session → cookie file · `error_classifier.rs` stderr → friendly message
  - `container.rs` `FastAtomInspector` (MP4 box validation)

## Frontend layout
- `src/components/stream-hub/` Hub (Omnibar probe → capture, ActivePipeline queue) · `media-library/` · `browser/` · `settings/`
- `src/lib/` `tauri-bridge.ts` (all IPC), `settings.ts` (download prefs), `hooks.ts` (useSettings/useLibrary/useEngine), `format.ts`
- No mock data: every number shown comes from the backend.

## Quarantine boundary (hard rule)
`src-tauri/src/downloader/quarantine/` is isolated behind the non-default Cargo
feature `experimental-drm`. Never enable, fix, extend, or build on it. Default and
release builds must not reference it. Build/test with default features only.

## Workflow
- Big multi-file features: short spec → executed by Antigravity (Gemini agent).
- Small edits: done directly. Keep specs free of DRM-related terminology.
- Recent state & detailed handoff: see `docs/AGENT_HANDOFF.md`.
