import React from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { IconCheckCircle, IconPlay, IconFolder, IconVolume2 } from './Icons'
import { playHapticClick } from '@/lib/sound'
import type { LibraryItem } from '@/lib/tauri-bridge'
import { formatBytes, qualityLabel, timeAgo } from '@/lib/format'

interface RecentCapturesProps {
  items: LibraryItem[]
  onPlay: (item: LibraryItem) => void
  onReveal: (item: LibraryItem) => void
  onShowAll: () => void
}

export function thumbnailSrc(item: LibraryItem): string | null {
  if (!item.thumbnail_path) return null
  try {
    return convertFileSrc(item.thumbnail_path)
  } catch {
    return null
  }
}

export const RecentCaptures: React.FC<RecentCapturesProps> = React.memo(({ items, onPlay, onReveal, onShowAll }) => {
  return (
    <div className="recent-captures-card">
      <div className="section-header">
        <h3 className="section-title">
          <span>Recent</span>
          <span className="section-badge-count">{items.length}</span>
        </h3>
        {items.length > 0 && (
          <button type="button" className="recent-show-all" onClick={() => { playHapticClick(); onShowAll() }}>
            Library
          </button>
        )}
      </div>

      <div className="recent-items-list">
        {items.length === 0 ? (
          <div className="recent-empty">Finished downloads will appear here.</div>
        ) : (
          items.map((item) => {
            const thumb = thumbnailSrc(item)
            const quality = item.kind === 'audio' ? 'Audio' : qualityLabel(item.width, item.height)
            return (
              <div key={item.id} className={`recent-item ${item.missing ? 'is-missing' : ''}`}>
                <div className="recent-item-left">
                  <div className="recent-icon-badge" aria-hidden="true">
                    {thumb ? (
                      <img className="recent-thumb-img" src={thumb} alt="" />
                    ) : item.kind === 'audio' ? (
                      <IconVolume2 size={14} />
                    ) : (
                      <IconCheckCircle size={14} />
                    )}
                  </div>
                  <div className="recent-details">
                    <div className="recent-name" title={item.title}>
                      {item.title}
                    </div>
                    <div className="recent-sub">
                      {item.missing ? (
                        <span className="recent-meta-pill">File missing</span>
                      ) : (
                        <>
                          {quality && <span className="recent-meta-pill">{quality}</span>}
                          {quality && <span className="recent-dot">·</span>}
                          <span className="recent-meta-size">{formatBytes(item.size_bytes)}</span>
                        </>
                      )}
                      <span className="recent-dot">·</span>
                      <span className="recent-meta-time">{timeAgo(item.added_at)}</span>
                    </div>
                  </div>
                </div>

                {!item.missing && (
                  <div className="recent-item-actions">
                    <button
                      type="button"
                      className="recent-action-icon-btn play-btn"
                      onClick={() => { playHapticClick(); onPlay(item) }}
                      title="Play"
                      aria-label={`Play ${item.title}`}
                    >
                      <IconPlay size={12} />
                    </button>
                    <button
                      type="button"
                      className="recent-action-icon-btn folder-btn"
                      onClick={() => { playHapticClick(); onReveal(item) }}
                      title="Show in folder"
                      aria-label={`Show ${item.title} in folder`}
                    >
                      <IconFolder size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
})
