import React, { useEffect } from 'react'
import './series-detail-view.css'
import type { MediaItem, EpisodeItem } from './mock-media-data'
import { IconArrowLeft, IconPlay, IconFolder, IconCheck } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass } from '@/lib/sound'

export interface SeriesDetailViewProps {
  seriesItem: MediaItem
  onBack: () => void
  onPlayEpisode: (series: MediaItem, episode: EpisodeItem) => void
  onRevealEpisode?: (episode: EpisodeItem) => void
  onOpenFolder?: (item?: MediaItem) => void
}

const SERIES_SYNOPSIS: Record<string, string> = {
  'media-1': "After a 10-year quest with the Hero's Party, elven mage Frieren embarks on a journey to the land where souls rest, reflecting on the fleeting lives of mortals and the passage of time.",
  'media-2': "On Halloween night in Shibuya, a massive veil descends, trapping civilians inside. Satoru Gojo and Jujutsu sorcerers engage in a decisive catastrophe against ancient curses.",
  'med-1': "After a 10-year quest with the Hero's Party, elven mage Frieren embarks on a journey to the land where souls rest, reflecting on the fleeting lives of mortals and the passage of time.",
  'med-2': "On Halloween night in Shibuya, a massive veil descends, trapping civilians inside. Satoru Gojo and Jujutsu sorcerers engage in a decisive catastrophe against ancient curses.",
}

export const SeriesDetailView: React.FC<SeriesDetailViewProps> = ({
  seriesItem,
  onBack,
  onPlayEpisode,
  onRevealEpisode,
  onOpenFolder,
}) => {
  const series = seriesItem.series
  const episodes = series?.episodes ?? []

  // Keyboard shortcut: Escape or Backspace to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        playHapticGlass()
        onBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  if (!series) {
    return null
  }

  const currentEpisode = episodes.find((ep) => ep.id === series.currentEpisodeId) || episodes[0]
  const currentEpisodeNum = currentEpisode ? currentEpisode.episodeNumber : 1
  const currentEpisodeTitle = currentEpisode ? currentEpisode.title.replace(/^Ep\s*\d+:\s*/i, '') : ''

  const watchedCount = episodes.filter((ep) => (ep.progress ?? 0) >= 1).length
  const watchedPercent = Math.round((watchedCount / episodes.length) * 100) || 0

  const synopsis = SERIES_SYNOPSIS[seriesItem.id] ||
    `Master archival edition of ${seriesItem.title} featuring all ${series.totalEpisodes} episodes in uncompressed high-bitrate video and lossless spatial audio.`

  const handleResumeClick = () => {
    if (currentEpisode) {
      playHapticClick()
      onPlayEpisode(seriesItem, currentEpisode)
    }
  }

  const handleFolderClick = () => {
    playHapticClick()
    onOpenFolder?.(seriesItem)
  }

  return (
    <div className="series-detail-view animate-fade-in">
      {/* Top Breadcrumb & Navigation Bar */}
      <div className="series-detail-topbar">
        <button
          type="button"
          className="series-back-btn"
          onClick={() => {
            playHapticGlass()
            onBack()
          }}
          title="Back to Library (Esc)"
        >
          <IconArrowLeft size={13} />
          <span>Back to Library</span>
        </button>

        <div className="series-breadcrumb">
          <span className="breadcrumb-root">Media Library</span>
          <span className="breadcrumb-slash">/</span>
          <span className="breadcrumb-title">{seriesItem.title}</span>
        </div>
      </div>

      {/* Cinematic Hero Section */}
      <div className="series-hero-banner">
        {seriesItem.posterUrl && (
          <img
            src={seriesItem.posterUrl}
            alt={seriesItem.title}
            className="series-hero-bg-img"
          />
        )}
        <div className="series-hero-scrim" />
        <div className="series-hero-ambient" />

        <div className="series-hero-content">
          {/* Metadata Chips */}
          <div className="series-hero-chips">
            <span className="series-hero-chip season-chip">Season {series.seasonNumber}</span>
            <span className="meta-dot">·</span>
            <span className="series-hero-chip">{series.totalEpisodes} Episodes</span>
            <span className="meta-dot">·</span>
            <span className="series-hero-chip">{seriesItem.size}</span>
            <span className="meta-dot">·</span>
            <span className="series-hero-chip">{seriesItem.quality}</span>
            <span className="meta-dot">·</span>
            <span className="series-hero-chip">{seriesItem.codec || 'HEVC'}</span>
          </div>

          {/* Series Display Title */}
          <h1 className="series-hero-title">{seriesItem.title}</h1>

          {/* Editorial Synopsis */}
          <p className="series-hero-synopsis">{synopsis}</p>

          {/* Hero Action Row */}
          <div className="series-hero-actions">
            <button
              type="button"
              className="series-primary-resume-btn"
              onClick={handleResumeClick}
              title={`Resume Episode ${currentEpisodeNum}: ${currentEpisodeTitle}`}
            >
              <div className="primary-resume-icon-circle">
                <IconPlay size={12} />
              </div>
              <span className="primary-resume-text">
                Resume Ep {currentEpisodeNum}
                {currentEpisodeTitle && <span className="primary-resume-sub"> · {currentEpisodeTitle}</span>}
              </span>
            </button>

            <button
              type="button"
              className="series-secondary-btn"
              onClick={handleFolderClick}
              title="Reveal Season in Explorer"
            >
              <IconFolder size={13} />
              <span>Reveal in Explorer</span>
            </button>

            <div className="series-watch-stats">
              <span className="stats-dot" />
              <span>{watchedCount} of {series.totalEpisodes} Watched ({watchedPercent}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Episodes Section Header */}
      <div className="series-episodes-section">
        <div className="series-episodes-header">
          <div className="series-episodes-header-left">
            <h2 className="series-section-title">Season {series.seasonNumber} Episodes</h2>
            <span className="series-section-count">{episodes.length} Episodes</span>
          </div>
          <div className="series-section-runtime">
            Total Runtime: {seriesItem.duration}
          </div>
        </div>

        {/* Spacious 2-Column Episode Grid */}
        <div className="series-episodes-grid">
          {episodes.map((episode) => {
            const isWatched = (episode.progress ?? 0) >= 1
            const isInProgress = (episode.progress ?? 0) > 0 && (episode.progress ?? 0) < 1
            const progressPercent = Math.min(100, Math.max(0, Math.round((episode.progress ?? 0) * 100)))
            const cleanTitle = episode.title.replace(/^Ep\s*\d+:\s*/i, '')

            return (
              <div
                key={episode.id}
                className={`series-episode-card ${isWatched ? 'is-watched' : ''} ${isInProgress ? 'is-in-progress' : ''}`}
                onClick={() => {
                  playHapticClick()
                  onPlayEpisode(seriesItem, episode)
                }}
                title={`Play Episode ${episode.episodeNumber}: ${cleanTitle}`}
              >
                {/* 16:9 Episode Thumbnail Preview */}
                <div
                  className="episode-card-thumb"
                  style={{ background: seriesItem.gradient }}
                >
                  {seriesItem.posterUrl && (
                    <img
                      src={seriesItem.posterUrl}
                      alt={cleanTitle}
                      className="episode-card-img"
                      loading="lazy"
                    />
                  )}
                  <div className="episode-card-thumb-scrim" />

                  {/* Play Overlay Circle on Hover */}
                  <div className="episode-card-play-overlay">
                    <div className="episode-card-play-circle">
                      <IconPlay size={14} />
                    </div>
                  </div>

                  {/* Micro Duration Badge */}
                  <div className="episode-card-duration">{episode.duration}</div>
                </div>

                {/* Episode Details */}
                <div className="episode-card-details">
                  <div className="episode-card-badge-row">
                    <span className="episode-card-num-badge">
                      EP {String(episode.episodeNumber).padStart(2, '0')}
                    </span>

                    {isWatched && (
                      <span className="episode-card-watched-badge">
                        <IconCheck size={10} />
                        <span>Watched</span>
                      </span>
                    )}

                    {isInProgress && (
                      <span className="episode-card-in-progress-badge">
                        {progressPercent}%
                      </span>
                    )}
                  </div>

                  <h3 className="episode-card-title" title={cleanTitle}>
                    {cleanTitle}
                  </h3>

                  <div className="episode-card-meta">
                    <span>{episode.quality} · {episode.codec}</span>
                    <span className="meta-dot">·</span>
                    <span>{episode.size}</span>
                  </div>

                  {/* In-Progress Micro Bar */}
                  {isInProgress && (
                    <div className="episode-card-progress-bar">
                      <div
                        className="episode-card-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="episode-card-actions">
                    <button
                      type="button"
                      className="episode-card-action-btn play"
                      onClick={(e) => {
                        e.stopPropagation()
                        playHapticClick()
                        onPlayEpisode(seriesItem, episode)
                      }}
                      title={`Play ${cleanTitle}`}
                      aria-label={`Play ${cleanTitle}`}
                    >
                      <IconPlay size={11} />
                      <span>Play</span>
                    </button>

                    <button
                      type="button"
                      className="episode-card-action-btn reveal"
                      onClick={(e) => {
                        e.stopPropagation()
                        playHapticGlass()
                        onRevealEpisode?.(episode)
                      }}
                      title="Reveal in Explorer"
                      aria-label={`Reveal ${cleanTitle} in Explorer`}
                    >
                      <IconFolder size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default SeriesDetailView
