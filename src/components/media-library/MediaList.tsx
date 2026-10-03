import React from 'react'
import { IconPlay, IconFolder, IconTrash, IconAlertCircle } from '../stream-hub/Icons'
import { playHapticClick } from '@/lib/sound'
import type { LibraryItem } from '@/lib/tauri-bridge'
import { formatBytes, formatDuration, hostnameOf, languageName, timeAgo } from '@/lib/format'
import { MediaThumb, formatLabel, type MediaItemActions } from './MediaCard'

function audioSummary(item: LibraryItem): string {
  if (item.audio_languages.length === 0) return item.kind === 'audio' ? item.container.toUpperCase() : 'Original'
  return item.audio_languages.map(languageName).join(', ')
}

export const MediaList: React.FC<{ items: LibraryItem[] } & MediaItemActions> = React.memo(
  ({ items, onPlay, onReveal, onDelete }) => (
    <div className="media-list-container">
      <div className="media-list-header-row">
        <div className="list-col col-main">Title</div>
        <div className="list-col col-format">Format</div>
        <div className="list-col col-audio">Audio</div>
        <div className="list-col col-size">Size</div>
        <div className="list-col col-date">Added</div>
        <div className="list-col col-actions">Actions</div>
      </div>

      <div className="media-list-body">
        {items.map((item) => {
          const play = () => {
            if (item.missing) return
            playHapticClick()
            onPlay(item)
          }
          const sub = [item.uploader || hostnameOf(item.source_url), formatDuration(item.duration)].filter(Boolean)
          const subs = item.subtitle_languages.length
          return (
            <div key={item.id} className={`media-list-row ${item.missing ? 'is-missing' : ''}`}>
              <div className="list-col col-main">
                <div className="list-row-thumb" onClick={play} title={item.missing ? 'File not found' : `Play ${item.title}`}>
                  <MediaThumb item={item} className="list-thumb-img" iconSize={16} />
                  {!item.missing && (
                    <div className="list-thumb-overlay">
                      <IconPlay size={12} className="list-thumb-play-icon" />
                    </div>
                  )}
                </div>

                <div className="list-row-title-area">
                  <div className="list-row-title-line">
                    <span className="list-row-title" title={item.title}>
                      {item.title}
                    </span>
                    {item.missing && (
                      <span className="media-missing-badge">
                        <IconAlertCircle size={11} /> Missing
                      </span>
                    )}
                  </div>
                  <span className="list-row-sub">
                    {sub.map((part, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="meta-dot">·</span>}
                        <span>{part}</span>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              </div>

              <div className="list-col col-format">
                <span className="list-format-text">{formatLabel(item)}</span>
                <span className="meta-dot">·</span>
                <span className="list-codec-text">{item.container.toUpperCase()}</span>
              </div>

              <div className="list-col col-audio">
                <span
                  className="list-audio-text"
                  title={subs > 0 ? `Subtitles: ${item.subtitle_languages.map(languageName).join(', ')}` : undefined}
                >
                  {audioSummary(item)}
                  {subs > 0 && ` · ${subs} sub${subs === 1 ? '' : 's'}`}
                </span>
              </div>

              <div className="list-col col-size">
                <span className="list-size-num">{item.missing ? '—' : formatBytes(item.size_bytes)}</span>
              </div>

              <div className="list-col col-date">
                <span className="list-date-text" title={new Date(item.added_at).toLocaleString()}>
                  {timeAgo(item.added_at)}
                </span>
              </div>

              <div className="list-col col-actions">
                <button
                  type="button"
                  className="media-ghost-play-btn mini"
                  onClick={play}
                  disabled={item.missing}
                  title={item.missing ? 'The file was moved or deleted' : 'Open in your default player'}
                >
                  <IconPlay size={11} />
                  <span>Play</span>
                </button>
                {!item.missing && (
                  <button
                    type="button"
                    className="media-icon-ghost-btn"
                    onClick={() => {
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
                  onClick={() => {
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
          )
        })}
      </div>
    </div>
  ),
)

export default MediaList
