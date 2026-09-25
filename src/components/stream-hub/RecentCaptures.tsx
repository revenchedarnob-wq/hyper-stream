import React from 'react'
import { IconCheckCircle, IconPlay, IconFolder } from './Icons'
import { playHapticClick } from '@/lib/sound'

export interface RecentItem {
  id: string
  title: string
  quality: string
  size: string
  duration: string
  timestamp: string
}

interface RecentCapturesProps {
  items: RecentItem[]
  onPlay: (item: RecentItem) => void
  onOpenFolder: (item: RecentItem) => void
}

export const RecentCaptures: React.FC<RecentCapturesProps> = React.memo(({
  items,
  onPlay,
  onOpenFolder,
}) => {
  return (
    <div className="recent-captures-card">
      <div className="section-header">
        <h3 className="section-title">
          <span>Recent</span>
          <span className="section-badge-count">{items.length}</span>
        </h3>
      </div>

      <div className="recent-items-list">
        {items.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--color-text-tertiary, rgba(255, 255, 255, 0.45))',
              fontSize: '12px',
              lineHeight: '1.5',
            }}
          >
            No recent captures yet. Completed transfers will appear here.
          </div>
        ) : (
          items.map((item) => (
          <div key={item.id} className="recent-item">
            <div className="recent-item-left">
              <div className="recent-icon-badge" aria-hidden="true">
                <IconCheckCircle size={14} />
              </div>

              <div className="recent-details">
                <div className="recent-name" title={item.title}>
                  {item.title}
                </div>
                <div className="recent-sub">
                  <span className="recent-meta-pill">{item.quality}</span>
                  <span className="recent-dot">·</span>
                  <span className="recent-meta-size">{item.size}</span>
                  <span className="recent-dot">·</span>
                  <span className="recent-meta-time">{item.timestamp}</span>
                </div>
              </div>
            </div>

            <div className="recent-item-actions">
              <button
                type="button"
                className="recent-action-icon-btn play-btn"
                onClick={() => {
                  playHapticClick()
                  onPlay(item)
                }}
                title={`Quick Play: ${item.title}`}
                aria-label={`Quick Play ${item.title}`}
              >
                <IconPlay size={12} />
              </button>

              <button
                type="button"
                className="recent-action-icon-btn folder-btn"
                onClick={() => {
                  playHapticClick()
                  onOpenFolder(item)
                }}
                title={`Show in Folder: ${item.title}`}
                aria-label={`Show in Folder ${item.title}`}
              >
                <IconFolder size={13} />
              </button>
            </div>
          </div>
        )))}
      </div>
    </div>
  )
})
