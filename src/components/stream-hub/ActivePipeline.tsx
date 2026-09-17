import React from 'react'
import {
  IconPause,
  IconPlay,
  IconX,
  IconFilm,
  IconRadio,
  IconClock,
  IconAlertCircle,
  IconRefreshCw,
  IconCpu,
  IconCheckCircle,
} from './Icons'
import { playHapticClick } from '@/lib/sound'
import { BatchTransferCard } from './BatchTransferCard'

export type TransferStatus =
  | 'downloading'
  | 'ingesting'
  | 'paused'
  | 'queued'
  | 'connecting'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'

export interface BatchEpisode {
  id: string
  episodeNumber: number
  title: string
  size: string
  status: 'completed' | 'ingesting' | 'queued' | 'paused'
  progress: number
  speed: string
}

export interface BatchTransfer {
  seriesTitle: string
  seasonNumber: number
  totalEpisodes: number
  completedEpisodes: number
  overallProgress: number
  aggregateSpeed: string
  timeRemaining: string
  isExpanded?: boolean
  episodes: BatchEpisode[]
}

export type BatchTransferItem = BatchTransfer

export interface DownloadItem {
  id: string
  title: string
  sourceType: 'anime' | 'stream' | 'vod'
  quality: string
  codec: string
  audioLang: string
  progress: number
  downloadedSize: string
  totalSize: string
  speed: string
  eta: string
  status: TransferStatus
  errorReason?: string
  batch?: BatchTransfer
}

interface ActivePipelineProps {
  items: DownloadItem[]
  onTogglePause: (id: string) => void
  onCancel: (id: string) => void
  onRetry?: (id: string) => void
}

export const ActivePipeline: React.FC<ActivePipelineProps> = React.memo(({
  items,
  onTogglePause,
  onCancel,
  onRetry,
}) => {
  const renderStatusBadge = (status: TransferStatus) => {
    switch (status) {
      case 'downloading':
      case 'ingesting':
        return (
          <span className="meta-status ingesting">
            <span className="meta-status-pulse" />
            Ingesting
          </span>
        )
      case 'paused':
        return (
          <span className="meta-status paused">
            <span className="meta-status-dot paused-dot" />
            Paused
          </span>
        )
      case 'queued':
        return (
          <span className="meta-status queued">
            <IconClock size={11} />
            Queued
          </span>
        )
      case 'connecting':
        return (
          <span className="meta-status connecting">
            <span className="meta-status-pulse cyan" />
            Connecting
          </span>
        )
      case 'processing':
        return (
          <span className="meta-status processing">
            <IconCpu size={11} />
            Transcoding
          </span>
        )
      case 'completed':
        return (
          <span className="meta-status completed">
            <IconCheckCircle size={11} />
            Complete
          </span>
        )
      case 'failed':
        return (
          <span className="meta-status failed">
            <IconAlertCircle size={11} />
            Failed
          </span>
        )
      case 'retrying':
        return (
          <span className="meta-status retrying">
            <IconRefreshCw size={11} className="spin-slow" />
            Retrying
          </span>
        )
      case 'cancelled':
        return (
          <span className="meta-status cancelled">
            <IconX size={11} />
            Cancelled
          </span>
        )
      default:
        return null
    }
  }

  const isPaused = (status: TransferStatus) => status === 'paused'
  const isFailed = (status: TransferStatus) => status === 'failed'
  const isCompleted = (status: TransferStatus) => status === 'completed'
  const isQueued = (status: TransferStatus) => status === 'queued'

  return (
    <div className="pipeline-section">
      <div className="section-header">
        <h2 className="section-title">
          <span>Active Transfers</span>
          <span className="section-badge-count">{items.length}</span>
        </h2>
      </div>

      <div className="pipeline-cards-list">
        {items.length === 0 ? (
          <div className="pipeline-empty-state">
            All transfers complete. Paste a stream URL above or drop a playlist to begin capture.
          </div>
        ) : (
          items.map((item) => {
            if (item.batch) {
              return (
                <BatchTransferCard
                  key={item.id}
                  item={item}
                  onTogglePause={onTogglePause}
                  onCancel={onCancel}
                />
              )
            }

            const paused = isPaused(item.status)
            const failed = isFailed(item.status)
            const completed = isCompleted(item.status)
            const queued = isQueued(item.status)

            return (
              <div key={item.id} className={`pipeline-card state-${item.status}`}>
                <div className="pipeline-card-top">
                  <div className="pipeline-thumbnail-wrap">
                    <div className="pipeline-thumbnail">
                      {item.sourceType === 'anime' ? (
                        <IconFilm size={22} />
                      ) : (
                        <IconRadio size={22} />
                      )}
                    </div>
                    <span className="pipeline-type-badge">
                      {item.quality.includes('4K') ? '4K' : item.quality.includes('1440p') ? '2K' : 'HLS'}
                    </span>
                  </div>

                  <div className="pipeline-info">
                    {/* Primary Title: single-line truncation with full tooltip */}
                    <div className="pipeline-title" title={item.title}>
                      {item.title}
                    </div>

                    <div className="pipeline-meta-line">
                      <span className="meta-quality">{item.quality}</span>
                      <span className="meta-dot">·</span>
                      <span className="meta-codec">{item.codec}</span>
                      <span className="meta-dot">·</span>
                      <span className="meta-audio">{item.audioLang}</span>
                      <span className="meta-dot">·</span>
                      {renderStatusBadge(item.status)}
                    </div>
                  </div>

                  <div className="pipeline-controls">
                    {failed ? (
                      <button
                        type="button"
                        className="pipeline-action-btn retry"
                        onClick={() => {
                          playHapticClick()
                          onRetry?.(item.id)
                        }}
                        title="Retry download"
                        aria-label="Retry download"
                      >
                        <IconRefreshCw size={13} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`pipeline-action-btn primary-control ${paused ? 'is-paused' : ''}`}
                        onClick={() => {
                          playHapticClick()
                          onTogglePause(item.id)
                        }}
                        title={paused ? 'Resume transfer' : 'Pause transfer'}
                        aria-label={paused ? 'Resume transfer' : 'Pause transfer'}
                      >
                        {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
                      </button>
                    )}

                    <button
                      type="button"
                      className="pipeline-action-btn cancel"
                      onClick={() => {
                        playHapticClick()
                        onCancel(item.id)
                      }}
                      title="Cancel and remove transfer"
                      aria-label="Cancel and remove transfer"
                    >
                      <IconX size={13} />
                    </button>
                  </div>
                </div>

                {/* Progress bar and metrics (1-second scan) */}
                <div className="pipeline-progress-container">
                  <div className="pipeline-progress-track">
                    <div
                      className={`pipeline-progress-bar ${paused ? 'is-paused' : ''} ${failed ? 'is-failed' : ''} ${completed ? 'is-complete' : ''}`}
                      style={{
                        width: `${item.progress}%`,
                      }}
                    />
                  </div>

                  <div className="pipeline-progress-meta">
                    <span className="pipeline-progress-size">
                      {item.downloadedSize} of {item.totalSize}
                    </span>
                    <span className={`pipeline-speed-badge ${paused ? 'is-paused' : ''}`}>
                      {paused ? 'Paused' : queued ? 'In Queue' : failed ? 'Failed' : item.speed}
                    </span>
                    <span className="pipeline-progress-eta">
                      {paused ? 'Suspended' : failed ? (item.errorReason || 'Network error') : queued ? 'Waiting' : completed ? '100%' : `${item.eta} left`}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
})