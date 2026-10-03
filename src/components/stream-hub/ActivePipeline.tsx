import React from 'react'
import {
  IconPause,
  IconPlay,
  IconX,
  IconRadio,
  IconClock,
  IconAlertCircle,
  IconRefreshCw,
  IconCpu,
  IconCheckCircle,
  IconChevronUp,
  IconChevronDown,
  IconTrash,
  IconFolder,
  IconVolume2,
} from './Icons'
import { playHapticClick } from '@/lib/sound'
import { GlassSelect } from '../common/GlassSelect'
import type { NativeDownloadProgress } from '@/lib/tauri-bridge'
import { formatBytes, formatEta, formatSpeed, hostnameOf } from '@/lib/format'

export interface TransferActions {
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onOpen: (task: NativeDownloadProgress) => void
  onReveal: (task: NativeDownloadProgress) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
}

interface ActivePipelineProps extends TransferActions {
  tasks: NativeDownloadProgress[]
  queueOrder: string[]
  maxConcurrent: number
  onMaxConcurrentChange: (limit: number) => void
  onPauseAll: () => void
  onResumeAll: () => void
  onClearFinished: () => void
}

const FINISHED = new Set(['completed', 'failed', 'cancelled'])

// Same range as Settings → Downloads at once.
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))

function StatusBadge({ task, queueIndex }: { task: NativeDownloadProgress; queueIndex: number }) {
  switch (task.state) {
    case 'downloading':
      return (
        <span className="meta-status ingesting">
          <span className="meta-status-pulse" />
          Downloading
        </span>
      )
    case 'remuxing':
      return (
        <span className="meta-status processing">
          <IconCpu size={11} />
          {task.stage || 'Processing'}
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
      return task.error_message ? (
        <span className="meta-status retrying">
          <IconRefreshCw size={11} className="spin-slow" />
          Retrying
        </span>
      ) : (
        <span className="meta-status queued">
          <IconClock size={11} />
          {queueIndex >= 0 ? `#${queueIndex + 1} in queue` : 'Queued'}
        </span>
      )
    case 'completed':
      return (
        <span className="meta-status completed">
          <IconCheckCircle size={11} />
          Done
        </span>
      )
    case 'failed':
      return (
        <span className="meta-status failed">
          <IconAlertCircle size={11} />
          Failed
        </span>
      )
    case 'cancelled':
      return (
        <span className="meta-status cancelled">
          <IconX size={11} />
          Cancelled
        </span>
      )
  }
}

function IconButton({
  label,
  onClick,
  className = '',
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`pipeline-action-btn ${className}`}
      disabled={disabled}
      onClick={() => {
        playHapticClick()
        onClick()
      }}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}

function progressLine(task: NativeDownloadProgress): { left: string; middle: string; right: string } {
  const sizes = task.total_bytes
    ? `${formatBytes(task.downloaded_bytes)} of ${formatBytes(task.total_bytes)}`
    : task.downloaded_bytes > 0
      ? formatBytes(task.downloaded_bytes)
      : ''
  switch (task.state) {
    case 'downloading':
      return { left: sizes || 'Starting…', middle: formatSpeed(task.speed_bytes_per_sec), right: formatEta(task.eta_seconds) }
    case 'remuxing':
      return { left: sizes, middle: '', right: 'Almost done' }
    case 'queued':
      return { left: task.error_message ? task.stage : 'Waiting for a free slot', middle: '', right: '' }
    case 'paused':
      return { left: sizes || 'Not started', middle: '', right: `${Math.round(task.progress_percent)}%` }
    case 'completed':
      return { left: formatBytes(task.total_bytes ?? task.downloaded_bytes), middle: '', right: '' }
    case 'cancelled':
      return { left: 'Cancelled', middle: '', right: '' }
    case 'failed':
      return { left: '', middle: '', right: '' }
  }
}

export const ActivePipeline: React.FC<ActivePipelineProps> = React.memo(
  ({
    tasks,
    queueOrder,
    maxConcurrent,
    onMaxConcurrentChange,
    onPauseAll,
    onResumeAll,
    onClearFinished,
    ...actions
  }) => {
    const hasFinished = tasks.some((t) => FINISHED.has(t.state))
    const hasActive = tasks.some((t) => t.state === 'downloading' || t.state === 'queued')
    const hasPaused = tasks.some((t) => t.state === 'paused')

    return (
      <div className="pipeline-section">
        <div className="section-header">
          <h2 className="section-title">
            <span>Transfers</span>
            <span className="section-badge-count">{tasks.length}</span>
          </h2>

          <div className="pipeline-header-controls">
            <div className="pipeline-concurrency-wrap" title="How many downloads run at the same time">
              <span className="pipeline-control-label">At once:</span>
              <GlassSelect
                className="pipeline-concurrency-select"
                value={String(maxConcurrent)}
                options={CONCURRENCY_OPTIONS}
                onChange={(v) => onMaxConcurrentChange(Number(v))}
                ariaLabel="Downloads at the same time"
              />
            </div>

            {hasActive && (
              <button type="button" className="pipeline-header-btn" onClick={() => { playHapticClick(); onPauseAll() }}>
                <IconPause size={12} />
                <span>Pause all</span>
              </button>
            )}
            {hasPaused && (
              <button type="button" className="pipeline-header-btn" onClick={() => { playHapticClick(); onResumeAll() }}>
                <IconPlay size={12} />
                <span>Resume all</span>
              </button>
            )}
            {hasFinished && (
              <button type="button" className="pipeline-header-btn clear-btn" onClick={() => { playHapticClick(); onClearFinished() }}>
                <IconTrash size={12} />
                <span>Clear finished</span>
              </button>
            )}
          </div>
        </div>

        <div className="pipeline-cards-list">
          {tasks.length === 0 ? (
            <div className="pipeline-empty-state">Nothing downloading. Paste a link above to get started.</div>
          ) : (
            tasks.map((task) => {
              const queueIndex = queueOrder.indexOf(task.task_id)
              const queued = task.state === 'queued'
              const line = progressLine(task)
              const metaParts = [task.quality_label, hostnameOf(task.source_url)].filter(Boolean)

              return (
                <div key={task.task_id} className={`pipeline-card state-${task.state}`}>
                  <div className="pipeline-card-top">
                    <div className="pipeline-thumbnail-wrap">
                      <div className="pipeline-thumbnail">
                        {task.thumbnail ? (
                          <img className="pipeline-thumbnail-img" src={task.thumbnail} alt="" referrerPolicy="no-referrer" />
                        ) : task.audio_only ? (
                          <IconVolume2 size={20} />
                        ) : (
                          <IconRadio size={20} />
                        )}
                      </div>
                      {task.container && <span className="pipeline-type-badge">{task.container}</span>}
                    </div>

                    <div className="pipeline-info">
                      <div className="pipeline-title" title={task.title}>
                        {task.title}
                      </div>
                      <div className="pipeline-meta-line">
                        {metaParts.map((part) => (
                          <React.Fragment key={part}>
                            <span className="meta-quality">{part}</span>
                            <span className="meta-dot">·</span>
                          </React.Fragment>
                        ))}
                        <StatusBadge task={task} queueIndex={queueIndex} />
                      </div>
                    </div>

                    <div className="pipeline-controls">
                      {queued && queueIndex >= 0 && (
                        <div className="pipeline-order-controls">
                          <button
                            type="button"
                            className="pipeline-reorder-btn"
                            disabled={queueIndex <= 0}
                            onClick={() => { playHapticClick(); actions.onReorder(task.task_id, 'up') }}
                            title="Move up"
                            aria-label="Move up in queue"
                          >
                            <IconChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="pipeline-reorder-btn"
                            disabled={queueIndex >= queueOrder.length - 1}
                            onClick={() => { playHapticClick(); actions.onReorder(task.task_id, 'down') }}
                            title="Move down"
                            aria-label="Move down in queue"
                          >
                            <IconChevronDown size={13} />
                          </button>
                        </div>
                      )}

                      {(task.state === 'downloading' || queued) && (
                        <IconButton label="Pause" className="primary-control" onClick={() => actions.onPause(task.task_id)}>
                          <IconPause size={13} />
                        </IconButton>
                      )}
                      {task.state === 'paused' && (
                        <IconButton label="Resume" className="primary-control is-paused" onClick={() => actions.onResume(task.task_id)}>
                          <IconPlay size={13} />
                        </IconButton>
                      )}
                      {(task.state === 'failed' || task.state === 'cancelled') && (
                        <IconButton label="Try again" className="retry" onClick={() => actions.onRetry(task.task_id)}>
                          <IconRefreshCw size={13} />
                        </IconButton>
                      )}
                      {task.state === 'completed' && (
                        <>
                          <IconButton label="Play" className="primary-control" onClick={() => actions.onOpen(task)}>
                            <IconPlay size={13} />
                          </IconButton>
                          <IconButton label="Show in folder" onClick={() => actions.onReveal(task)}>
                            <IconFolder size={13} />
                          </IconButton>
                        </>
                      )}

                      <IconButton
                        label={FINISHED.has(task.state) ? 'Remove from list' : 'Cancel download'}
                        className="cancel"
                        onClick={() => actions.onRemove(task.task_id)}
                      >
                        <IconX size={13} />
                      </IconButton>
                    </div>
                  </div>

                  {task.state === 'failed' ? (
                    <div className="pipeline-error-line" role="alert">
                      <IconAlertCircle size={12} />
                      <span>{task.error_message || 'The download failed.'}</span>
                    </div>
                  ) : (
                    <div className="pipeline-progress-container">
                      {task.state !== 'completed' && task.state !== 'cancelled' && (
                        <div className="pipeline-progress-track">
                          <div
                            className={`pipeline-progress-bar ${task.state === 'paused' ? 'is-paused' : ''} ${task.state === 'remuxing' ? 'is-indeterminate' : ''}`}
                            // Slides instead of resizing: a width change re-lays out the page on every frame.
                            style={{ transform: `translateX(${Math.max(0, Math.min(100, task.progress_percent)) - 100}%)` }}
                          />
                        </div>
                      )}
                      <div className="pipeline-progress-meta">
                        <span className="pipeline-progress-size">{line.left}</span>
                        <span className="pipeline-speed-badge">{line.middle}</span>
                        <span className="pipeline-progress-eta">{line.right}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  },
)
