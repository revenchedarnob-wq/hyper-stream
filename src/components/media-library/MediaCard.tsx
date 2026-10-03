import React, { useState } from 'react'
import { IconPlay, IconFolder, IconTrash, IconFilm, IconVolume2, IconAlertCircle } from '../stream-hub/Icons'
import { useCardSheen } from '../common/useCardSheen'
import { playHapticClick } from '@/lib/sound'
import type { LibraryItem } from '@/lib/tauri-bridge'
import { formatBytes, formatDuration, qualityLabel, timeAgo } from '@/lib/format'
import { thumbnailSrc } from '../stream-hub/RecentCaptures'

export interface MediaItemActions {
  onPlay: (item: LibraryItem) => void
  onReveal: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => void
}

/** "1080p", "Audio", or the container when nothing better is known. */
export function formatLabel(item: LibraryItem): string {
  if (item.kind === 'audio') return 'Audio'
  return qualityLabel(item.width, item.height) || item.container.toUpperCase()
}

export const MediaThumb: React.FC<{ item: LibraryItem; className: string; iconSize: number }> = ({
  item,
  className,
  iconSize,
}) => {
  const [failed, setFailed] = useState(false)
  const src = thumbnailSrc(item)
  if (src && !failed) {
    return <img src={src} alt="" className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  }
  return (
    <div className="media-thumb-watermark-icon" aria-hidden="true">
      {item.kind === 'audio' ? <IconVolume2 size={iconSize} /> : <IconFilm size={iconSize} />}
    </div>
  )
}

export const MediaCard: React.FC<{ item: LibraryItem } & MediaItemActions> = React.memo(
  ({ item, onPlay, onReveal, onDelete }) => {
    const { onPointerMove, onPointerLeave } = useCardSheen()
    const duration = formatDuration(item.duration)

    const play = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (item.missing) return
      playHapticClick()
      onPlay(item)
    }

    return (
      <div
        className={`media-grid-card media-card sheen-card ${item.missing ? 'is-missing' : ''}`}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <div
          className="media-card-thumb"
          onClick={play}
          title={item.missing ? 'File not found' : `Play ${item.title}`}
        >
          <MediaThumb item={item} className="media-thumb-img" iconSize={26} />
          <div className="media-thumb-scrim" />
          {!item.missing && (
            <div className="media-thumb-play-overlay">
              <div className="media-glass-play-circle">
                <IconPlay size={16} />
              </div>
            </div>
          )}
          {item.missing && (
            <div className="media-thumb-overlay-top-right">
              <span className="media-missing-badge">
                <IconAlertCircle size={11} /> Missing
              </span>
            </div>
          )}
          {duration && (
            <div className="media-thumb-overlay-bottom">
              <span className="media-micro-duration">{duration}</span>
            </div>
          )}
        </div>

        <div className="media-card-body">
          <h3 className="media-card-title" title={item.title}>
            {item.title}
          </h3>

          <div className="media-card-meta-line">
            <span className="media-badge-quality">{formatLabel(item)}</span>
            <span className="meta-dot">·</span>
            <span className="media-meta-size">{item.missing ? 'Not found' : formatBytes(item.size_bytes)}</span>
            <span className="meta-dot">·</span>
            <span className="media-meta-time">{timeAgo(item.added_at)}</span>
          </div>

          <div className="media-card-actions">
            <button
              type="button"
              className="media-ghost-play-btn"
              onClick={play}
              disabled={item.missing}
              title={item.missing ? 'The file was moved or deleted' : 'Open in your default player'}
            >
              <IconPlay size={11} />
              <span>Play</span>
            </button>

            <div className="media-action-icons-group">
              {!item.missing && (
                <button
                  type="button"
                  className="media-icon-ghost-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    playHapticClick()
                    onReveal(item)
                  }}
                  title="Show in folder"
                  aria-label="Show in folder"
                >
                  <IconFolder size={13} />
                </button>
              )}
              <button
                type="button"
                className="media-icon-ghost-btn delete"
                onClick={(e) => {
                  e.stopPropagation()
                  playHapticClick()
                  onDelete(item)
                }}
                title="Delete"
                aria-label="Delete"
              >
                <IconTrash size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  },
)

export default MediaCard
