pub mod binary_manager;
pub mod container;
pub mod cookies;
pub mod error_classifier;
pub mod extractor;
pub mod library;
pub mod orchestrator;
pub mod queue;

#[cfg(feature = "experimental-drm")]
pub mod quarantine;

pub use binary_manager::{BinaryManager, EngineBinariesReport};
pub use container::FastAtomInspector;
pub use error_classifier::classify_download_error;
pub use extractor::{MediaMetadata, UniversalExtractor};
pub use library::LibraryItem;
pub use orchestrator::{default_download_dir, DownloadOptions, DownloadOrchestrator, DownloadProgress, DownloadState};
pub use queue::QueueConfig;

#[cfg(feature = "experimental-drm")]
pub use quarantine::{AudioVersion, CrunchyrollEngine, KeyStore, PlaybackSession, StreamDecryptor};
