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
  IconChevronUp,
  IconChevronDown,
  IconTrash,
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
  queueOrder?: string[]
  maxConcurrent?: number
  onMaxConcurrentChange?: (limit: number) => void
  onReorder?: (id: string, direction: 'up' | 'down') => void
  onPauseAll?: () => void
  onResumeAll?: () => void
  onClearFinished?: () => void
}

export const ActivePipeline: React.FC<ActivePipelineProps> = React.memo(({
  items,
  onTogglePause,
  onCancel,
  onRetry,
  queueOrder = [],
  maxConcurrent = 3,
  onMaxConcurrentChange,
  onReorder,
  onPauseAll,
  onResumeAll,
  onClearFinished,
}) => {
  const renderStatusBadge = (status: TransferStatus, queueIndex: number) => {
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
            {queueIndex >= 0 ? `#${queueIndex + 1} in Queue` : 'Queued'}
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

  const hasFinished = items.some((i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled')
  const hasActive = items.some((i) => i.status === 'downloading' || i.status === 'ingesting' || i.status === 'queued')
  const hasPaused = items.some((i) => i.status === 'paused')

  return (
    <div className="pipeline-section">
      <div className="section-header">
        <h2 className="section-title">
          <span>Active Transfers</span>
          <span className="section-badge-count">{items.length}</span>
        </h2>

        {/* Global Queue Controls */}
        <div className="pipeline-header-controls">
          {onMaxConcurrentChange && (
            <div className="pipeline-concurrency-wrap" title="Maximum concurrent active downloads">
              <span className="pipeline-control-label">Limit:</span>
              <select
                className="pipeline-concurrency-select"
                value={maxConcurrent}
                onChange={(e) => {
                  playHapticClick()
                  onMaxConcurrentChange(Number(e.target.value))
                }}
                aria-label="Max concurrent downloads"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} Parallel
                  </option>
                ))}
              </select>
            </div>
          )}

          {hasActive && onPauseAll && (
            <button
              type="button"
              className="pipeline-header-btn"
              onClick={() => {
                playHapticClick()
                onPauseAll()
              }}
              title="Pause all transfers"
            >
              <IconPause size={12} />
              <span>Pause All</span>
            </button>
          )}

          {hasPaused && onResumeAll && (
            <button
              type="button"
              className="pipeline-header-btn"
              onClick={() => {
                playHapticClick()
                onResumeAll()
              }}
              title="Resume all transfers"
            >
              <IconPlay size={12} />
              <span>Resume All</span>
            </button>
          )}

          {hasFinished && onClearFinished && (
            <button
              type="button"
              className="pipeline-header-btn clear-btn"
              onClick={() => {
                playHapticClick()
                onClearFinished()
              }}
              title="Clear finished and cancelled tasks"
            >
              <IconTrash size={12} />
              <span>Clear Finished</span>
            </button>
          )}
        </div>
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

            const queueIndex = queueOrder.indexOf(item.id)
            const canMoveUp = queued && queueIndex > 0
            const canMoveDown = queued && queueIndex >= 0 && queueIndex < queueOrder.length - 1

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
                      {renderStatusBadge(item.status, queueIndex)}
                    </div>
                  </div>

                  <div className="pipeline-controls">
                    {/* Reorder controls for queued items */}
                    {queued && onReorder && (
                      <div className="pipeline-order-controls">
                        <button
                          type="button"
                          className="pipeline-reorder-btn"
                          disabled={!canMoveUp}
                          onClick={() => {
                            playHapticClick()
                            onReorder(item.id, 'up')
                          }}
                          title="Move up in queue"
                          aria-label="Move up in queue"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="pipeline-reorder-btn"
                          disabled={!canMoveDown}
                          onClick={() => {
                            playHapticClick()
                            onReorder(item.id, 'down')
                          }}
                          title="Move down in queue"
                          aria-label="Move down in queue"
                        >
                          <IconChevronDown size={13} />
                        </button>
                      </div>
                    )}

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
                      {paused ? 'Paused' : queued ? (queueIndex >= 0 ? `#${queueIndex + 1} in Queue` : 'In Queue') : failed ? 'Failed' : item.speed}
                    </span>
                    <span className="pipeline-progress-eta">
                      {paused ? 'Suspended' : failed ? (item.errorReason || 'Network error') : queued ? 'Waiting for slot' : completed ? '100%' : `${item.eta} left`}
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