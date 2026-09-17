import { useState } from 'react'
import './integrations.css'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'

interface IntegrationItem {
  id: string
  name: string
  subtitle: string
  enabled: boolean
  icon: string
}

export function Integrations() {
  const [items, setItems] = useState<IntegrationItem[]>([
    {
      id: 'discord',
      name: 'Discord Webhook',
      subtitle: 'Post embed alerts with video thumbnail and duration upon capture completion',
      enabled: true,
      icon: 'discord',
    },
    {
      id: 'plex',
      name: 'Plex Media Server',
      subtitle: 'Trigger instant library scans on local Plex instances (port 32400)',
      enabled: true,
      icon: 'plex',
    },
    {
      id: 'jellyfin',
      name: 'Jellyfin & Emby',
      subtitle: 'Notify self-hosted media servers to refresh active stream directories',
      enabled: false,
      icon: 'jellyfin',
    },
    {
      id: 'aria2',
      name: 'Aria2 Acceleration',
      subtitle: 'Split HLS and DASH stream segments into 16 parallel socket connections',
      enabled: true,
      icon: 'aria2',
    },
    {
      id: 'cloud',
      name: 'Cloud Vault Sync',
      subtitle: 'Mirror finalized MP4 and MKV recordings to remote S3 or WebDAV buckets',
      enabled: false,
      icon: 'cloud',
    },
  ])

  const toggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const next = !item.enabled
          if (next) {
            playHapticGlass()
          } else {
            playHapticPop()
          }
          return { ...item, enabled: next }
        }
        return item
      })
    )
  }

  return (
    <div className="integrations-view">
      {/* Calm, Refined Header */}
      <header className="integrations-header">
        <div className="integrations-header-copy">
          <h1 className="integrations-title">Integrations</h1>
          <p className="integrations-subtitle">
            Automate post-processing notifications, library rescans, and multi-socket ingestion.
          </p>
        </div>
      </header>

      {/* Single Unified Frosted Glass Panel */}
      <div className="integrations-body">
        <div className="integrations-unified-list">
          {items.map((item) => (
            <div key={item.id} className="integration-list-row">
              {/* Icon Squircle */}
              <div className={`integration-icon-squircle ${item.enabled ? 'active' : ''}`}>
                {item.icon === 'discord' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                )}
                {item.icon === 'plex' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.8L19.5 8.5 12 12.2 4.5 8.5 12 4.8zM4 10.2l7 3.5v6.5l-7-3.5v-6.5zm9 10v-6.5l7-3.5v6.5l-7 3.5z"/>
                  </svg>
                )}
                {item.icon === 'jellyfin' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                )}
                {item.icon === 'aria2' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                )}
                {item.icon === 'cloud' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/>
                  </svg>
                )}
              </div>

              {/* Text Info */}
              <div className="integration-row-meta">
                <div className="integration-row-title">{item.name}</div>
                <div className="integration-row-desc">{item.subtitle}</div>
              </div>

              {/* Status & Spring Toggle */}
              <div className="integration-row-controls">
                <span className={`integration-status-tag ${item.enabled ? 'active' : 'idle'}`}>
                  {item.enabled ? 'Active' : 'Disabled'}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={item.enabled}
                  className={`tactile-toggle ${item.enabled ? 'is-on' : ''}`}
                  onClick={() => toggleItem(item.id)}
                  title={item.enabled ? 'Click to disable' : 'Click to enable'}
                >
                  <span className="tactile-toggle-thumb" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Quiet Webhook Endpoint Configuration */}
        <div className="webhook-config-box">
          <div className="webhook-box-header">
            <span className="webhook-box-title">Custom HTTP Webhook Endpoint</span>
            <span className="webhook-box-hint">Optional POST JSON payload</span>
          </div>
          <div className="webhook-input-row">
            <input
              type="text"
              className="webhook-input"
              placeholder="https://your-server.local/api/hyperstream-hook"
              spellCheck={false}
            />
            <button
              type="button"
              className="webhook-test-btn"
              onClick={() => playHapticClick()}
            >
              Test Dispatch
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
