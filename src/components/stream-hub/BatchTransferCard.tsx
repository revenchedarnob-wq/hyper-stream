import React, { useState } from 'react'
import type { DownloadItem, BatchEpisode } from './ActivePipeline'
import {
  IconFilm,
  IconPause,
  IconPlay,
  IconX,
  IconChevronDown,
  IconCheckCircle,
} from './Icons'
import { playHapticClick, playHapticPop } from '@/lib/sound'

export interface BatchTransferCardProps {
  item: DownloadItem
  onTogglePause: (id: string) => void
  onCancel: (id: string) => void
}

export const BatchTransferCard: React.FC<BatchTransferCardProps> = React.memo(({
  item,
  onTogglePause,
  onCancel,
}) => {
  const batch = item.batch
  const [isExpanded, setIsExpanded] = useState(batch?.isExpanded ?? false)
  const [episodeOverrides, setEpisodeOverrides] = useState<Record<string, Partial<BatchEpisode>>>({})

  if (!batch) {
    return null
  }

  const episodes: BatchEpisode[] = (batch.episodes || []).map((ep) => {
    const override = episodeOverrides[ep.id]
    return override ? { ...ep, ...override } : ep
  })

  const isPaused = item.status === 'paused'
  const totalEpisodes = batch.totalEpisodes || episodes.length

  const finishedCount = episodes.filter((ep) => ep.status === 'completed').length
  const ingestingCount = episodes.filter((ep) => ep.status === 'ingesting').length
  const pausedCount = episodes.filter((ep) => ep.status === 'paused').length
  const queuedCount = episodes.filter((ep) => ep.status === 'queued').length

  const subtitleParts: string[] = []
  if (finishedCount > 0) subtitleParts.push(`${finishedCount} Finished`)
  if (ingestingCount > 0) subtitleParts.push(`${ingestingCount} Ingesting`)
  if (pausedCount > 0) subtitleParts.push(`${pausedCount} Paused`)
  if (queuedCount > 0) subtitleParts.push(`${queuedCount} Queued`)

  const subtitleText = subtitleParts.length > 0
    ? subtitleParts.join(' · ')
    : `${batch.completedEpisodes} Finished · ${totalEpisodes - batch.completedEpisodes} Queued`

  const seriesTitleText = batch.seriesTitle
    ? `${batch.seriesTitle} · Season ${batch.seasonNumber}`
    : item.title

  const overallProgress = batch.overallProgress ?? item.progress
  const aggregateSpeed = batch.aggregateSpeed || item.speed
  const rawRemaining = batch.timeRemaining || item.eta
  const timeRemainingText = rawRemaining.toLowerCase().includes('left')
    ? rawRemaining
    : `${rawRemaining} left`

  const handleToggleExpand = () => {
    playHapticPop()
    setIsExpanded((prev) => !prev)
  }

  const handleToggleEpisodePause = (episodeId: string) => {
    playHapticClick()
    const targetEp = episodes.find((e) => e.id === episodeId)
    if (!targetEp) return

    if (targetEp.status === 'ingesting') {
      setEpisodeOverrides((prev) => ({
        ...prev,
        [episodeId]: { status: 'paused', speed: '0 MB/s' },
      }))
    } else if (targetEp.status === 'paused') {
      setEpisodeOverrides((prev) => ({
        ...prev,
        [episodeId]: { status: 'ingesting', speed: aggregateSpeed },
      }))
    } else if (targetEp.status === 'queued') {
      setEpisodeOverrides((prev) => ({
        ...prev,
        [episodeId]: { status: 'paused', speed: '0 MB/s' },
      }))
    }
  }

  return (
    <div className={`pipeline-card batch-transfer-card state-${item.status}`}>
      <div className="pipeline-card-top">
        <div className="pipeline-thumbnail-wrap">
          <div className="pipeline-thumbnail">
            <IconFilm size={22} />
          </div>
          <span className="pipeline-type-badge">{totalEpisodes} EPS</span>
        </div>

        <div className="pipeline-info">
          <div className="pipeline-title" title={seriesTitleText}>
            {seriesTitleText}
          </div>

          <div className="pipeline-meta-line">
            <span className="batch-subtitle-counts">{subtitleText}</span>
          </div>
        </div>

        <div className="pipeline-controls">
          <button
            type="button"
            className="batch-expand-btn"
            onClick={handleToggleExpand}
            aria-expanded={isExpanded}
            title={isExpanded ? 'Hide Episodes' : `Show ${totalEpisodes} Episodes`}
          >
            <span>{isExpanded ? 'Hide Episodes' : `Show ${totalEpisodes} Episodes`}</span>
            <IconChevronDown
              size={12}
              className={`batch-expand-caret ${isExpanded ? 'is-expanded' : ''}`}
            />
          </button>

          <button
            type="button"
            className={`pipeline-action-btn primary-control ${isPaused ? 'is-paused' : ''}`}
            onClick={() => {
              playHapticClick()
              onTogglePause(item.id)
            }}
            title={isPaused ? 'Resume transfer' : 'Pause transfer'}
            aria-label={isPaused ? 'Resume transfer' : 'Pause transfer'}
          >
            {isPaused ? <IconPlay size={13} /> : <IconPause size={13} />}
          </button>

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

      <div className="batch-progress-container">
        <div className="batch-progress-track">
          <div
            className={`batch-progress-bar ${isPaused ? 'is-paused' : ''}`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        <div className="pipeline-progress-meta">
          <span className="pipeline-progress-size">
            {item.downloadedSize} of {item.totalSize}
          </span>
          <span className="batch-telemetry-stats">
            {isPaused ? 'Paused' : `${aggregateSpeed} · ${timeRemainingText}`}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="batch-episodes-panel">
          {episodes.map((ep) => {
            const isEpCompleted = ep.status === 'completed'
            const isEpIngesting = ep.status === 'ingesting'
            const isEpPaused = ep.status === 'paused'
            const isEpQueued = ep.status === 'queued'
            const epNumFormatted = `EP ${String(ep.episodeNumber).padStart(2, '0')}`

            return (
              <div key={ep.id} className={`batch-episode-row state-${ep.status}`}>
                <div className="batch-ep-left">
                  <span className="batch-ep-capsule">{epNumFormatted}</span>
                  <div className="batch-ep-info">
                    <span className="batch-ep-title" title={ep.title}>
                      {ep.title}
                    </span>
                    <span className="batch-ep-size">{ep.size}</span>
                  </div>
                </div>

                <div className="batch-ep-right">
                  <div className="batch-ep-status-wrap">
                    {isEpCompleted && (
                      <span className="batch-ep-status completed">
                        <span className="batch-status-dot green" />
                        Finished
                      </span>
                    )}
                    {isEpIngesting && (
                      <span className="batch-ep-status ingesting">
                        <span className="batch-status-pulse purple" />
                        {ep.speed || 'Ingesting'}
                      </span>
                    )}
                    {isEpPaused && (
                      <span className="batch-ep-status paused">
                        <span className="batch-status-dot amber" />
                        Paused
                      </span>
                    )}
                    {isEpQueued && (
                      <span className="batch-ep-status queued">
                        <span className="batch-status-dot gray" />
                        Queued
                      </span>
                    )}
                  </div>

                  <div className="batch-ep-actions">
                    {(isEpIngesting || isEpQueued) && (
                      <button
                        type="button"
                        className="batch-ep-action-btn"
                        onClick={() => handleToggleEpisodePause(ep.id)}
                        title="Pause episode"
                        aria-label={`Pause ${ep.title}`}
                      >
                        <IconPause size={10} />
                      </button>
                    )}
                    {isEpPaused && (
                      <button
                        type="button"
                        className="batch-ep-action-btn is-paused"
                        onClick={() => handleToggleEpisodePause(ep.id)}
                        title="Resume episode"
                        aria-label={`Resume ${ep.title}`}
                      >
                        <IconPlay size={10} />
                      </button>
                    )}
                    {isEpCompleted && (
                      <span className="batch-ep-action-placeholder" title="Finished">
                        <IconCheckCircle size={12} className="batch-ep-completed-icon" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

BatchTransferCard.displayName = 'BatchTransferCard'
