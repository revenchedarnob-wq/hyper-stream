pub mod binary_manager;
pub mod container;
pub mod error_classifier;
pub mod extractor;
pub mod orchestrator;
pub mod queue;

#[cfg(feature = "experimental-drm")]
pub mod quarantine;

pub use binary_manager::{BinaryManager, BinaryStatus, EngineBinariesReport};
pub use container::FastAtomInspector;
pub use error_classifier::classify_download_error;
pub use extractor::{MediaFormat, MediaMetadata, SubtitleTrack, UniversalExtractor};
pub use orchestrator::{DownloadOptions, DownloadOrchestrator, DownloadProgress, DownloadState};
pub use queue::{QueueChangedPayload, QueueConfig, QueueEntry};

#[cfg(feature = "experimental-drm")]
pub use quarantine::{AudioVersion, CrunchyrollEngine, KeyStore, PlaybackSession, StreamDecryptor};
