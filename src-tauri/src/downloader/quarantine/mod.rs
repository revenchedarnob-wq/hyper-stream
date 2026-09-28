//! # Quarantine — isolated, non-default subsystem
//!
//! This module is compiled **only** when the crate is built with
//! `--features experimental-drm`. It is excluded from every normal /
//! release build (`default = []`). It is retained in-tree for reference and
//! is not wired into the shipped application. See `README.md` in this folder.

pub mod crunchyroll_engine;

pub use crunchyroll_engine::{
    AudioVersion, CrunchyrollEngine, KeyStore, PlaybackSession, StreamDecryptor,
};
