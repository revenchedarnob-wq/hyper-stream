import React from 'react'
import type { MediaItem } from './mock-media-data'
import {
  IconPlay,
  IconFolder,
  IconTrash,
  IconFilm,
  IconRadio,
  IconActivity,
  IconVolume2,
  IconList,
} from '../stream-hub/Icons'
import { useCardSheen } from '../common/useCardSheen'
import { playHapticClick, playHapticGlass } from '@/lib/sound'

export interface MediaCardProps {
  item: MediaItem
  onPlay: (item: MediaItem) => void
  onOpenFolder: (item: MediaItem) => void
  onDelete: (id: string) => void
  onOpenSeries?: (item: MediaItem) => void
}

export const MediaCard: React.FC<MediaCardProps> = React.memo(({
  item,
  onPlay,
  onOpenFolder,
  onDelete,
  onOpenSeries,
}) => {
  const { onPointerMove, onPointerLeave } = useCardSheen()

  const isSeries = Boolean(item.series)
  const series = item.series

  const currentEpisode = isSeries && series?.currentEpisodeId
    ? series.episodes.find((ep) => ep.id === series.currentEpisodeId)
    : undefined

  const episodeNumber = currentEpisode
    ? currentEpisode.episodeNumber
    : series?.currentEpisodeId
    ? parseInt(series.currentEpisodeId.replace(/\D/g, ''), 10) || 1
    : undefined

  const playButtonLabel = episodeNumber ? `Ep ${episodeNumber}` : 'Play'
  const resumeTooltip = episodeNumber && currentEpisode
    ? `Resume Ep ${episodeNumber}: ${currentEpisode.title}`
    : `Play ${item.title}`

  const handlePlayCurrent = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    playHapticClick()
    if (currentEpisode) {
      onPlay({
        ...item,
        title: `${item.title} - ${currentEpisode.title}`,
        videoUrl: currentEpisode.videoUrl || item.videoUrl,
        duration: currentEpisode.duration || item.duration,
        quality: currentEpisode.quality || item.quality,
      })
    } else {
      onPlay(item)
    }
  }

  const handleOpenSeriesAction = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenSeries) {
      playHapticGlass()
      onOpenSeries(item)
    }
  }

  const handleCardBodyClick = () => {
    if (isSeries && onOpenSeries) {
      playHapticGlass()
      onOpenSeries(item)
    }
  }

  const renderCategoryIcon = (category: string) => {
    switch (category) {
      case 'anime':
        return <IconFilm size={26} />
      case 'stream':
        return <IconRadio size={26} />
      case '4k':
        return <IconActivity size={26} />
      case 'audio':
        return <IconVolume2 size={26} />
      default:
        return <IconFilm size={26} />
    }
  }

  const handleThumbnailClick = (e: React.MouseEvent) => {
    if (isSeries && onOpenSeries) {
      e.stopPropagation()
      playHapticGlass()
      onOpenSeries(item)
    } else {
      handlePlayCurrent(e)
    }
  }

  const thumbnailContent = (
    <div
      className="media-card-thumb"
      style={{ background: item.gradient }}
      onClick={handleThumbnailClick}
      title={isSeries ? `View ${item.title} Series` : `Play ${item.title}`}
    >
      {item.posterUrl && (
        <img
          src={item.posterUrl}
          alt={item.title}
          className="media-thumb-img"
          loading="lazy"
          decoding="async"
        />
      )}

      {/* Micro gradient scrim for visual contrast */}
      <div className="media-thumb-scrim" />

      {/* Fallback watermark icon */}
      <div className="media-thumb-watermark-icon">
        {renderCategoryIcon(item.category)}
      </div>

      {/* Hover Glass Play Circle */}
      <div className="media-thumb-play-overlay">
        <div className="media-glass-play-circle">
          <IconPlay size={16} />
        </div>
      </div>

      {/* Top-Right Series Badge */}
      {isSeries && series && (
        <div className="media-thumb-overlay-top-right">
          <span className="media-duration-badge series-badge">
            S{series.seasonNumber} · {series.totalEpisodes} EPS
          </span>
        </div>
      )}

      {/* Duration badge */}
      <div className="media-thumb-overlay-bottom">
        <span className="media-micro-duration">{item.duration}</span>
      </div>
    </div>
  )

  return (
    <div
      className={`media-grid-card media-card sheen-card ${isSeries ? 'media-card-series is-series' : ''}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {/* Physical Glass Stack Container when series, or direct thumbnail */}
      {isSeries ? (
        <div className="media-thumbnail-stack">
          {thumbnailContent}
        </div>
      ) : (
        thumbnailContent
      )}

      {/* Minimal Card Details */}
      <div
        className={`media-card-body ${isSeries ? 'is-series-body' : ''}`}
        onClick={handleCardBodyClick}
      >
        <h3 className="media-card-title" title={item.title}>
          {item.title}
        </h3>

        {/* Dynamic Metadata Line */}
        {isSeries && series ? (
          <div className="media-card-meta-line">
            <span className="media-series-meta-season">Season {series.seasonNumber}</span>
            <span className="meta-dot">·</span>
            <span className="media-series-meta-episodes">{series.totalEpisodes} Episodes</span>
            <span className="meta-dot">·</span>
            <span className="media-meta-size">{item.size}</span>
          </div>
        ) : (
          <div className="media-card-meta-line">
            <span className="media-badge-quality">{item.quality}</span>
            <span className="meta-dot">·</span>
            <span className="media-meta-size">{item.size}</span>
            <span className="meta-dot">·</span>
            <span className="media-meta-time">{item.timestamp}</span>
          </div>
        )}

        {/* Quiet Action Bar */}
        <div className="media-card-actions">
          {isSeries ? (
            <div className="media-card-actions-primary">
              <button
                type="button"
                className="media-ghost-play-btn"
                onClick={handlePlayCurrent}
                title={resumeTooltip}
              >
                <IconPlay size={11} />
                <span>{playButtonLabel}</span>
              </button>
              <button
                type="button"
                className="media-series-count-pill"
                onClick={handleOpenSeriesAction}
                title={`Browse ${series?.totalEpisodes ?? ''} Episodes`}
              >
                <IconList size={11} />
                <span>{series?.totalEpisodes} Eps</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="media-ghost-play-btn"
              onClick={handlePlayCurrent}
              title="Play media preview"
            >
              <IconPlay size={11} />
              <span>Play</span>
            </button>
          )}

          <div className="media-action-icons-group">
            <button
              type="button"
              className="media-icon-ghost-btn"
              onClick={(e) => {
                e.stopPropagation()
                playHapticClick()
                onOpenFolder(item)
              }}
              title="Reveal in Explorer"
            >
              <IconFolder size={13} />
            </button>
            <button
              type="button"
              className="media-icon-ghost-btn delete"
              onClick={(e) => {
                e.stopPropagation()
                playHapticGlass()
                onDelete(item.id)
              }}
              title="Remove from Library"
            >
              <IconTrash size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export default MediaCard