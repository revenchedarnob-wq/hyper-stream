import { useEffect, useRef } from 'react'
import type { ShieldsMetrics } from './types'
import { IconBraveLion, IconX } from './Icons'
import { playHapticClick, playHapticGlass } from '@/lib/sound'
import './browser.css'

export interface BraveShieldsPopoverProps {
  stats: ShieldsMetrics
  onToggleShields: () => void
  onClose: () => void
}

export function BraveShieldsPopover({ stats, onToggleShields, onClose }: BraveShieldsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    function handleMouseDown(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  const handleToggle = () => {
    playHapticGlass()
    onToggleShields()
  }

  const handleCloseClick = () => {
    playHapticClick()
    onClose()
  }

  const trackersAndAdsBlocked = (stats.adsBlocked + stats.trackersBlocked).toLocaleString()
  const bandwidthSavedMb = `${((stats.bandwidthSavedBytes || 0) / (1024 * 1024)).toFixed(1)} MB`
  const fingerprintingProtection = stats.isEnabled ? 'Strict' : 'Disabled'

  return (
    <>
      <div
        className="brave-shields-backdrop"
        onClick={handleCloseClick}
        aria-hidden="true"
        data-testid="brave-shields-backdrop"
      />
      <div
        ref={popoverRef}
        className="brave-shields-popover"
        role="dialog"
        aria-label="Brave Shields"
      >
      <header className="shields-popover-header">
        <div className="shields-header-brand">
          <div className={`shields-lion-badge ${stats.isEnabled ? 'is-enabled' : 'is-disabled'}`}>
            <IconBraveLion size={20} />
          </div>
          <div className="shields-header-titles">
            <h3 className="shields-popover-title">Brave Shields</h3>
            <div className={`shields-status-subtitle ${stats.isEnabled ? 'is-up' : 'is-down'}`}>
              <span className="shields-status-dot" />
              <span>{stats.isEnabled ? 'Shields are UP for this site' : 'Shields are DOWN'}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="shields-close-btn"
          onClick={handleCloseClick}
          aria-label="Close Brave Shields"
        >
          <IconX size={14} />
        </button>
      </header>

      <div className="shields-master-row">
        <div className="shields-master-info">
          <span className="shields-master-label">Shields Protection</span>
          <span className="shields-master-desc">Block trackers, fingerprinting & ads</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={stats.isEnabled}
          className={`shields-toggle-btn ${stats.isEnabled ? 'is-active' : ''}`}
          onClick={handleToggle}
          aria-label="Toggle Brave Shields"
        >
          <span className="shields-toggle-knob" />
        </button>
      </div>

      <div className="shields-stat-grid">
        <div className="shields-stat-card">
          <span className="shields-stat-val">{trackersAndAdsBlocked}</span>
          <span className="shields-stat-lbl">Trackers & Ads</span>
        </div>
        <div className="shields-stat-card">
          <span className="shields-stat-val">{bandwidthSavedMb}</span>
          <span className="shields-stat-lbl">Bandwidth Saved</span>
        </div>
        <div className="shields-stat-card">
          <span className="shields-stat-val">{fingerprintingProtection}</span>
          <span className="shields-stat-lbl">Fingerprint Defense</span>
        </div>
      </div>

      <footer className="shields-popover-footer">
        Hardware-accelerated zero-telemetry shield engine
      </footer>
    </div>
    </>
  )
}
