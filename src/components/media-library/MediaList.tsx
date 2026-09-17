import React, { useState } from 'react'
import type { MediaItem, EpisodeItem } from './mock-media-data'
import {
  IconPlay,
  IconFolder,
  IconTrash,
  IconFilm,
  IconSearch,
  IconList,
  IconChevronDown,
} from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass } from '@/lib/sound'

interface MediaListProps {
  items: MediaItem[]
  onPlay: (item: MediaItem) => void
  onOpenFolder: (item: MediaItem) => void
  onDelete: (id: string) => void
  onOpenSeries?: (item: MediaItem) => void
  searchQuery?: string
  activeCategory?: string
  onResetFilters?: () => void
  totalLibraryCount?: number
}

export const MediaList: React.FC<MediaListProps> = React.memo(({
  items,
  onPlay,
  onOpenFolder,
  onDelete,
  onOpenSeries,
  searchQuery = '',
  activeCategory = 'all',
  onResetFilters,
  totalLibraryCount,
}) => {
  const [expandedSeriesIds, setExpandedSeriesIds] = useState<Set<string>>(new Set())

  const toggleSeriesExpand = (id: string) => {
    playHapticClick()
    setExpandedSeriesIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const getUnwatchedEpisode = (item: MediaItem): EpisodeItem | null => {
    if (!item.series || !item.series.episodes || item.series.episodes.length === 0) return null
    const episodes = item.series.episodes
    return (
      (item.series.currentEpisodeId ? episodes.find((ep) => ep.id === item.series?.currentEpisodeId) : undefined) ||
      episodes.find((ep) => (ep.progress ?? 0) > 0 && (ep.progress ?? 0) < 1) ||
      episodes.find((ep) => (ep.progress ?? 0) < 1) ||
      episodes[0] ||
      null
    )
  }

  if (items.length === 0) {
    const isLibraryEmpty = (totalLibraryCount ?? 0) === 0 && !searchQuery && activeCategory === 'all'

    return (
      <div className="library-empty-state">
        <div className="library-empty-icon-circle">
          {isLibraryEmpty ? <IconFilm size={26} /> : <IconSearch size={24} />}
        </div>
        <p className="empty-title">
          {isLibraryEmpty ? 'No media in library' : 'No matching captures'}
        </p>
        <p className="empty-sub">
          {isLibraryEmpty
            ? 'Captures and completed ingestions from Stream Hub will appear here.'
            : searchQuery
            ? `No media matches "${searchQuery}".`
            : `No media found under the "${activeCategory}" filter.`}
        </p>
        {!isLibraryEmpty && onResetFilters && (
          <button
            type="button"
            className="empty-reset-btn"
            onClick={() => {
              playHapticClick()
              onResetFilters()
            }}
          >
            <span>Reset filters</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="media-list-container">
      {/* Table Header Row */}
      <div className="media-list-header-row">
        <div className="list-col col-main">Capture & Title</div>
        <div className="list-col col-format">Format</div>
        <div className="list-col col-audio">Audio</div>
        <div className="list-col col-size">Size</div>
        <div className="list-col col-date">Date</div>
        <div className="list-col col-actions">Actions</div>
      </div>

      {/* Table Rows */}
      <div className="media-list-body">
        {items.map((item) => {
          const isSeries = Boolean(item.series)
          const isExpanded = expandedSeriesIds.has(item.id)
          const episodes = item.series?.episodes || []
          const currentEpisode = isSeries ? getUnwatchedEpisode(item) : null

          const handlePlayItem = () => {
            playHapticClick()
            if (isSeries && currentEpisode) {
              onPlay({
                ...item,
                title: `${item.title} · ${currentEpisode.title}`,
                videoUrl: currentEpisode.videoUrl || item.videoUrl,
                duration: currentEpisode.duration || item.duration,
                quality: currentEpisode.quality || item.quality,
                codec: currentEpisode.codec || item.codec,
                size: currentEpisode.size || item.size,
              })
            } else {
              onPlay(item)
            }
          }

          return (
            <React.Fragment key={item.id}>
              {/* Parent Row */}
              <div
                className={`media-list-row ${isSeries ? 'media-list-series-row' : ''} ${isExpanded ? 'is-expanded' : ''}`}
              >
                {/* Main Item Column with Chevron + 16:9 Thumbnail + Title + Badge */}
                <div className="list-col col-main">
                  {isSeries ? (
                    <button
                      type="button"
                      className={`media-list-chevron-btn ${isExpanded ? 'expanded' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSeriesExpand(item.id)
                      }}
                      title={isExpanded ? 'Collapse season episodes' : 'Expand season episodes'}
                      aria-label={isExpanded ? 'Collapse season episodes' : 'Expand season episodes'}
                      aria-expanded={isExpanded}
                    >
                      <IconChevronDown size={13} className="media-list-chevron-icon" />
                    </button>
                  ) : (
                    <span className="media-list-chevron-spacer" aria-hidden="true" />
                  )}

                  <div
                    className="list-row-thumb"
                    style={{ background: item.gradient }}
                    onClick={handlePlayItem}
                    title={isSeries && currentEpisode ? `Play ${currentEpisode.title}` : `Play ${item.title}`}
                  >
                    {item.posterUrl && (
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        className="list-thumb-img"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <div className="list-thumb-overlay">
                      <IconPlay size={12} className="list-thumb-play-icon" />
                    </div>
                  </div>

                  <div className="list-row-title-area">
                    <div className="list-row-title-line">
                      <span className="list-row-title" title={item.title}>
                        {item.title}
                      </span>
                      {item.series && (
                        <span className="media-list-series-badge">
                          S{item.series.seasonNumber} · {item.series.totalEpisodes} EPS
                        </span>
                      )}
                    </div>
                    <span className="list-row-sub">
                      <span>{item.source}</span>
                      <span className="meta-dot">·</span>
                      <span>{item.duration}</span>
                    </span>
                  </div>
                </div>

                {/* Format Column */}
                <div className="list-col col-format">
                  <span className="list-format-text">{item.quality}</span>
                  <span className="meta-dot">·</span>
                  <span className="list-codec-text">{item.codec}</span>
                </div>

                {/* Audio Tracks Column */}
                <div className="list-col col-audio">
                  <span className="list-audio-text" title={item.audioTracks.join(', ')}>
                    {item.audioTracks[0]}
                  </span>
                </div>

                {/* Size Column */}
                <div className="list-col col-size">
                  <span className="list-size-num">{item.size}</span>
                </div>

                {/* Date Column */}
                <div className="list-col col-date">
                  <span className="list-date-text">{item.timestamp}</span>
                </div>

                {/* Actions Column */}
                <div className="list-col col-actions">
                  <button
                    type="button"
                    className="media-ghost-play-btn mini"
                    onClick={handlePlayItem}
                    title={isSeries && currentEpisode ? `Play ${currentEpisode.title}` : `Play ${item.title}`}
                  >
                    <IconPlay size={11} />
                    <span>Play</span>
                  </button>

                  {isSeries && onOpenSeries && (
                    <button
                      type="button"
                      className="media-series-count-pill"
                      onClick={() => {
                        playHapticGlass()
                        onOpenSeries(item)
                      }}
                      title={`Browse all ${item.series?.totalEpisodes || 0} episodes`}
                    >
                      <IconList size={10} />
                      <span>{item.series?.totalEpisodes || 0} Eps</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="media-icon-ghost-btn"
                    onClick={() => {
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
                    onClick={() => {
                      playHapticGlass()
                      onDelete(item.id)
                    }}
                    title="Remove from Library"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              </div>

              {/* Expanded Nested Child Episode Rows */}
              {isSeries && isExpanded && episodes.map((episode) => (
                <div
                  key={episode.id}
                  className="media-list-child-row"
                >
                  {/* Indented Episode Pill + Title */}
                  <div className="list-col col-main list-child-col-main">
                    <div className="media-list-child-indent-guide" aria-hidden="true" />
                    <span
                      className="media-episode-num-pill"
                      onClick={() => {
                        playHapticClick()
                        onPlay({
                          ...item,
                          title: `${item.title} · ${episode.title}`,
                          videoUrl: episode.videoUrl || item.videoUrl,
                          duration: episode.duration || item.duration,
                          quality: episode.quality || item.quality,
                          codec: episode.codec || item.codec,
                          size: episode.size || item.size,
                        })
                      }}
                      title={`Play EP ${String(episode.episodeNumber).padStart(2, '0')}`}
                    >
                      EP {String(episode.episodeNumber).padStart(2, '0')}
                    </span>
                    <span
                      className="media-child-title"
                      title={episode.title}
                      onClick={() => {
                        playHapticClick()
                        onPlay({
                          ...item,
                          title: `${item.title} · ${episode.title}`,
                          videoUrl: episode.videoUrl || item.videoUrl,
                          duration: episode.duration || item.duration,
                          quality: episode.quality || item.quality,
                          codec: episode.codec || item.codec,
                          size: episode.size || item.size,
                        })
                      }}
                    >
                      {episode.title}
                    </span>
                    {episode.progress !== undefined && episode.progress > 0 && (
                      <span className="media-child-progress-tag">
                        {Math.round(episode.progress * 100)}%
                      </span>
                    )}
                  </div>

                  {/* Format & Codec */}
                  <div className="list-col col-format">
                    <span className="list-format-text">{episode.quality || item.quality}</span>
                    <span className="meta-dot">·</span>
                    <span className="list-codec-text">{episode.codec || item.codec}</span>
                  </div>

                  {/* Audio Track */}
                  <div className="list-col col-audio">
                    <span
                      className="list-audio-text"
                      title={item.audioTracks?.join(', ') || 'Original Audio'}
                    >
                      {item.audioTracks?.[0] || 'Stereo'}
                    </span>
                  </div>

                  {/* Size */}
                  <div className="list-col col-size">
                    <span className="list-size-num">{episode.size}</span>
                  </div>

                  {/* Duration */}
                  <div className="list-col col-date">
                    <span className="list-date-text">{episode.duration}</span>
                  </div>

                  {/* Child Actions */}
                  <div className="list-col col-actions">
                    <button
                      type="button"
                      className="media-ghost-play-btn mini"
                      onClick={() => {
                        playHapticClick()
                        onPlay({
                          ...item,
                          title: `${item.title} · ${episode.title}`,
                          videoUrl: episode.videoUrl || item.videoUrl,
                          duration: episode.duration || item.duration,
                          quality: episode.quality || item.quality,
                          codec: episode.codec || item.codec,
                          size: episode.size || item.size,
                        })
                      }}
                      title={`Play ${episode.title}`}
                    >
                      <IconPlay size={11} />
                      <span>Play</span>
                    </button>
                    <button
                      type="button"
                      className="media-icon-ghost-btn"
                      onClick={() => {
                        playHapticClick()
                        onOpenFolder({
                          ...item,
                          title: episode.title,
                        })
                      }}
                      title={`Reveal ${episode.title} in Explorer`}
                    >
                      <IconFolder size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
})