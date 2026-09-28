# Quarantine

Code in this directory is **isolated and disabled by default**. It is not
compiled into standard or release builds and is not registered with the Tauri
app unless the crate is explicitly built with the opt-in feature:

    cargo build --features experimental-drm

`default = []` in `Cargo.toml` keeps this subsystem out of the shipping product.
It is preserved here for reference only; the maintained, legitimate media
pipeline (yt-dlp / aria2c / FFmpeg on user-supplied URLs) lives in
`../orchestrator.rs`, `../extractor.rs`, and `../binary_manager.rs`.
