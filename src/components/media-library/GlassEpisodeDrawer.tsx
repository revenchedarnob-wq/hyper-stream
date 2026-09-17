import React, { useEffect, useState } from 'react'
import type { MediaItem, EpisodeItem } from './mock-media-data'
import { IconX, IconPlay, IconFolder, IconCheck } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass } from '@/lib/sound'

export interface GlassEpisodeDrawerProps {
  seriesItem: MediaItem | null
  isOpen: boolean
  onClose: () => void
  onPlayEpisode: (series: MediaItem, episode: EpisodeItem) => void
  onRevealEpisode?: (episode: EpisodeItem) => void
}

export const GlassEpisodeDrawer: React.FC<GlassEpisodeDrawerProps> = ({
  seriesItem,
  isOpen,
  onClose,
  onPlayEpisode,
  onRevealEpisode,
}) => {
  const [cachedSeries, setCachedSeries] = useState<MediaItem | null>(seriesItem)

  if (seriesItem && seriesItem !== cachedSeries) {
    setCachedSeries(seriesItem)
  }

  const activeSeries = seriesItem || cachedSeries

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        playHapticGlass()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!activeSeries || !activeSeries.series) {
    return null
  }

  const series = activeSeries.series
  const episodes = series.episodes || []

  // Locate the resume episode: first matching currentEpisodeId, or first unwatched / in-progress, or first episode
  const currentEpisode =
    (series.currentEpisodeId ? episodes.find((ep) => ep.id === series.currentEpisodeId) : undefined) ||
    episodes.find((ep) => (ep.progress ?? 0) > 0 && (ep.progress ?? 0) < 1) ||
    episodes.find((ep) => (ep.progress ?? 0) < 1) ||
    episodes[0]

  const resumeEpNumber = currentEpisode ? currentEpisode.episodeNumber : 1
  const resumeButtonLabel = `Resume Ep ${resumeEpNumber}`

  const handleHeroResume = () => {
    playHapticClick()
    if (currentEpisode) {
      onPlayEpisode(activeSeries, currentEpisode)
    }
  }

  const handleEpisodePlay = (episode: EpisodeItem, e?: React.MouseEvent) => {
    e?.stopPropagation()
    playHapticClick()
    onPlayEpisode(activeSeries, episode)
  }

  const handleEpisodeReveal = (episode: EpisodeItem, e: React.MouseEvent) => {
    e.stopPropagation()
    playHapticClick()
    if (onRevealEpisode) {
      onRevealEpisode(episode)
    }
  }

  const handleBackdropClick = () => {
    playHapticGlass()
    onClose()
  }

  const handleCloseClick = () => {
    playHapticClick()
    onClose()
  }

  return (
    <div
      className={`episode-drawer-backdrop ${isOpen ? 'open' : ''}`}
      onClick={handleBackdropClick}
      aria-hidden={!isOpen}
    >
      <div
        className={`episode-drawer-panel ${isOpen ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={activeSeries.title}
      >
        {/* Header Section with Backdrop Banner */}
        <div className="episode-drawer-header">
          <div
            className="episode-drawer-banner"
            style={{ background: activeSeries.gradient }}
          >
            {activeSeries.posterUrl && (
              <img
                src={activeSeries.posterUrl}
                alt={activeSeries.title}
                className="episode-drawer-banner-img"
              />
            )}
            <div className="episode-drawer-banner-scrim" />
            <div className="episode-drawer-banner-ambient" />

            {/* Top Close Button */}
            <button
              type="button"
              className="episode-drawer-close-btn"
              onClick={handleCloseClick}
              title="Close Drawer (Esc)"
              aria-label="Close episode drawer"
            >
              <IconX size={15} />
            </button>
          </div>

          {/* Series Info and Hero Action */}
          <div className="episode-drawer-header-content">
            <h2 className="episode-drawer-title" title={activeSeries.title}>
              {activeSeries.title}
            </h2>

            {/* Season Info Capsule */}
            <div className="episode-drawer-capsule-row">
              <span className="episode-drawer-season-capsule">
                Season {series.seasonNumber} · {series.totalEpisodes || episodes.length} Episodes · {activeSeries.size}
              </span>
            </div>

            {/* Sleek Compact Resume Hero Action Button */}
            <button
              type="button"
              className="episode-drawer-hero-resume-btn"
              onClick={handleHeroResume}
              title={currentEpisode ? `Resume ${currentEpisode.title}` : resumeButtonLabel}
            >
              <div className="hero-resume-icon-circle">
                <IconPlay size={11} />
              </div>
              <span className="hero-resume-label">
                Resume Ep {currentEpisode ? currentEpisode.episodeNumber : '1'}
                {currentEpisode && (
                  <span className="hero-resume-sub"> · {currentEpisode.title.replace(/^Ep\s*\d+:\s*/i, '')}</span>
                )}
              </span>
            </button>
          </div>
        </div>

        {/* Scrollable Episode List */}
        <div className="episode-drawer-list">
          <div className="episode-drawer-list-header">
            <span className="episode-drawer-list-title">All Episodes</span>
            <span className="episode-drawer-list-count">{episodes.length} files</span>
          </div>

          <div className="episode-drawer-items">
            {episodes.map((episode) => {
              const isWatched = (episode.progress ?? 0) >= 1
              const isInProgress = (episode.progress ?? 0) > 0 && (episode.progress ?? 0) < 1
              const progressPercent = Math.min(100, Math.max(0, Math.round((episode.progress ?? 0) * 100)))
              const cleanTitle = episode.title.replace(/^Ep\s*\d+:\s*/i, '')

              return (
                <div
                  key={episode.id}
                  className={`episode-drawer-item ${isWatched ? 'is-watched' : ''} ${isInProgress ? 'is-in-progress' : ''}`}
                  onClick={(e) => handleEpisodePlay(episode, e)}
                  title={`Play ${episode.title}`}
                >
                  {/* Minimal Tabular Episode Index or Checked Glyph */}
                  <div className="episode-item-index" title={isWatched ? 'Watched' : undefined}>
                    {isWatched ? (
                      <IconCheck size={11} className="episode-watched-check" />
                    ) : (
                      String(episode.episodeNumber).padStart(2, '0')
                    )}
                  </div>

                  {/* Title and Editorial Metadata */}
                  <div className="episode-item-details">
                    <div className="episode-item-title" title={episode.title}>
                      {cleanTitle}
                    </div>
                    <div className="episode-item-meta-line">
                      <span className="episode-item-duration">{episode.duration}</span>
                      <span className="meta-dot">·</span>
                      <span className="episode-item-badge">{episode.quality} · {episode.codec}</span>
                      <span className="meta-dot">·</span>
                      <span className="episode-item-size">{episode.size}</span>
                      {isWatched && (
                        <>
                          <span className="meta-dot">·</span>
                          <span className="episode-item-status-tag watched">Watched</span>
                        </>
                      )}
                      {isInProgress && (
                        <>
                          <span className="meta-dot">·</span>
                          <div className="episode-item-inline-progress" title={`${progressPercent}% watched`}>
                            <div className="episode-item-inline-fill" style={{ width: `${progressPercent}%` }} />
                          </div>
                          <span className="episode-item-status-tag in-progress">{progressPercent}%</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Interactive Action Triggers */}
                  <div className="episode-item-actions">
                    <button
                      type="button"
                      className="episode-action-btn play"
                      onClick={(e) => handleEpisodePlay(episode, e)}
                      title={`Play ${episode.title}`}
                      aria-label={`Play ${episode.title}`}
                    >
                      <IconPlay size={11} />
                    </button>

                    <button
                      type="button"
                      className="episode-action-btn reveal"
                      onClick={(e) => handleEpisodeReveal(episode, e)}
                      title="Reveal in Explorer"
                      aria-label={`Reveal ${episode.title} in Explorer`}
                    >
                      <IconFolder size={12} />
                    </button>
                  </div>

                  {/* Subtle Progress Track Underneath */}
                  {episode.progress !== undefined && (
                    <div className="episode-progress-track">
                      <div
                        className={`episode-progress-fill ${isWatched ? 'watched' : isInProgress ? 'in-progress' : ''}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GlassEpisodeDrawer