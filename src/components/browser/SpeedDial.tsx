import { useState, useEffect, type FormEvent, type MouseEvent } from 'react'
import type { ShieldsMetrics, SpeedDialItem } from './types'
import {
  IconBraveLion,
  IconBraveShield,
  IconDownloadCloud,
  IconCpu,
  IconPlus,
  IconX,
} from './Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'
import './browser.css'


export interface SpeedDialTileProps {
  item: SpeedDialItem
  onSelect: (url: string) => void
  onRemove?: (id: string) => void
  isCustom?: boolean
}

export function SpeedDialTile({ item, onSelect, onRemove, isCustom = false }: SpeedDialTileProps) {
  const handleClick = () => {
    playHapticClick()
    onSelect(item.url)
  }

  const handleRemove = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    playHapticPop()
    onRemove?.(item.id)
  }

  const iconStyle = item.accentColor
    ? {
        color: item.accentColor,
        background: `${item.accentColor}18`,
        borderColor: `${item.accentColor}33`,
      }
    : undefined

  return (
    <button
      type="button"
      className="speed-dial-tile"
      onClick={handleClick}
      title={`${item.title} (${item.url})`}
      data-testid={`speed-dial-tile-${item.id}`}
    >
      <div className="speed-dial-tile-icon" style={iconStyle}>
        {renderSpeedDialIcon(item.iconKey, 20)}
      </div>

      <div className="speed-dial-tile-info">
        <span className="speed-dial-tile-title">{item.title}</span>
        <span className="speed-dial-tile-url">{item.url.replace(/^https?:\/\//, '')}</span>
        <span className="speed-dial-tile-category">{item.category}</span>
      </div>

      {isCustom && onRemove && (
        <button
          type="button"
          className="speed-dial-tile-remove"
          onClick={handleRemove}
          title={`Remove ${item.title}`}
          aria-label={`Remove ${item.title}`}
        >
          <IconX size={12} />
        </button>
      )}
    </button>
  )
}

export interface SpeedDialProps {
  shieldsStats: ShieldsMetrics
  onSelectUrl: (url: string) => void
}

export function SpeedDial({ shieldsStats, onSelectUrl }: SpeedDialProps) {
  const [customTiles, setCustomTiles] = useState<SpeedDialItem[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('hyperstream_speed_dial_custom')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch {
      // Ignore storage access errors
    }
    return []
  })

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isAddModalOpen) {
        setIsAddModalOpen(false)
      }
    }
    if (isAddModalOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAddModalOpen])

  const saveCustomTiles = (tiles: SpeedDialItem[]) => {
    setCustomTiles(tiles)
    try {
      localStorage.setItem('hyperstream_speed_dial_custom', JSON.stringify(tiles))
    } catch {
      // Ignore storage write errors
    }
  }

  const handleOpenAddModal = () => {
    playHapticClick()
    setIsAddModalOpen(true)
  }

  const handleCloseAddModal = () => {
    playHapticPop()
    setIsAddModalOpen(false)
    setNewTitle('')
    setNewUrl('')
  }

  const handleAddBookmark = (e: FormEvent) => {
    e.preventDefault()
    const trimmedTitle = newTitle.trim()
    let trimmedUrl = newUrl.trim()
    if (!trimmedTitle || !trimmedUrl) return

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = `https://${trimmedUrl}`
    }

    const newBookmark: SpeedDialItem = {
      id: `custom-${Date.now()}`,
      title: trimmedTitle,
      url: trimmedUrl,
      category: 'custom',
      iconKey: 'custom',
      accentColor: 'var(--color-brand-primary)',
    }

    playHapticGlass()
    saveCustomTiles([...customTiles, newBookmark])
    setNewTitle('')
    setNewUrl('')
    setIsAddModalOpen(false)
  }

  const handleRemoveCustomTile = (id: string) => {
    saveCustomTiles(customTiles.filter((tile) => tile.id !== id))
  }

  const totalAdsAndTrackers = (
    (shieldsStats?.adsBlocked || 0) + (shieldsStats?.trackersBlocked || 0)
  ).toLocaleString()

  const bandwidthSavedMb = `${(
    (shieldsStats?.bandwidthSavedBytes || 0) /
    (1024 * 1024)
  ).toFixed(1)} MB`

  const cpuCyclesPreserved = 'Hyper-Efficient'

  return (
    <section className="speed-dial-container" aria-label="Speed Dial Portal">
      {/* Header with Brave Privacy Workspace badge */}
      <header className="speed-dial-header">
        <div className="speed-dial-badge">
          <div className="speed-dial-badge-icon" aria-hidden="true">
            <IconBraveLion size={15} />
          </div>
          <span>Brave Privacy Workspace</span>
        </div>

        <h1 className="speed-dial-title">Decentralized Streaming Gateway</h1>
        <p className="speed-dial-subtitle">
          High-performance hardware-accelerated media portals protected with zero-telemetry shields
        </p>
      </header>

      {/* Privacy Telemetry Ribbon */}
      <div
        className="speed-dial-ticker"
        role="region"
        aria-label="Privacy Telemetry Ribbon"
        data-testid="privacy-telemetry-ribbon"
      >
        <div className="speed-dial-ticker-stat">
          <div className="speed-dial-ticker-icon" aria-hidden="true">
            <IconBraveShield size={18} />
          </div>
          <div className="speed-dial-ticker-meta">
            <span className="speed-dial-ticker-value">{totalAdsAndTrackers}</span>
            <span className="speed-dial-ticker-label">Total Ads & Trackers Blocked</span>
          </div>
        </div>

        <div className="speed-dial-ticker-stat">
          <div className="speed-dial-ticker-icon" aria-hidden="true">
            <IconDownloadCloud size={18} />
          </div>
          <div className="speed-dial-ticker-meta">
            <span className="speed-dial-ticker-value">{bandwidthSavedMb}</span>
            <span className="speed-dial-ticker-label">Bandwidth Saved</span>
          </div>
        </div>

        <div className="speed-dial-ticker-stat">
          <div className="speed-dial-ticker-icon" aria-hidden="true">
            <IconCpu size={18} />
          </div>
          <div className="speed-dial-ticker-meta">
            <span className="speed-dial-ticker-value">{cpuCyclesPreserved}</span>
            <span className="speed-dial-ticker-label">CPU Cycles Preserved</span>
          </div>
        </div>
      </div>

      {/* Streaming Portal Grid */}
      <div className="speed-dial-grid" role="list" aria-label="Streaming Portals">
        {DEFAULT_SPEED_DIAL_PRESETS.map((preset) => (
          <SpeedDialTile
            key={preset.id}
            item={preset}
            onSelect={onSelectUrl}
          />
        ))}

        {customTiles.map((custom) => (
          <SpeedDialTile
            key={custom.id}
            item={custom}
            onSelect={onSelectUrl}
            onRemove={handleRemoveCustomTile}
            isCustom
          />
        ))}

        {/* Custom Tile Slot / Add Button */}
        <button
          type="button"
          className="speed-dial-add-tile"
          onClick={handleOpenAddModal}
          aria-label="Add custom streaming portal bookmark"
          data-testid="speed-dial-add-button"
        >
          <IconPlus size={16} />
          <span>Add Bookmark</span>
        </button>
      </div>

      {/* Add Bookmark Modal Dialog */}
      {isAddModalOpen && (
        <div
          className="speed-dial-modal-backdrop"
          onClick={handleCloseAddModal}
          role="presentation"
        >
          <div
            className="speed-dial-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add Bookmark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="speed-dial-modal-header">
              <h2 className="speed-dial-modal-title">Add Streaming Portal</h2>
              <button
                type="button"
                className="shields-close-btn"
                onClick={handleCloseAddModal}
                aria-label="Close dialog"
              >
                <IconX size={14} />
              </button>
            </div>

            <form onSubmit={handleAddBookmark} className="speed-dial-modal-form">
              <div className="speed-dial-form-group">
                <label htmlFor="portal-title-input" className="speed-dial-form-label">
                  Portal Title
                </label>
                <input
                  id="portal-title-input"
                  type="text"
                  className="speed-dial-form-input"
                  placeholder="e.g. Bilibili"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="speed-dial-form-group">
                <label htmlFor="portal-url-input" className="speed-dial-form-label">
                  Destination URL
                </label>
                <input
                  id="portal-url-input"
                  type="text"
                  className="speed-dial-form-input"
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  required
                />
              </div>

              <div className="speed-dial-form-actions">
                <button
                  type="button"
                  className="speed-dial-btn speed-dial-btn-cancel"
                  onClick={handleCloseAddModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="speed-dial-btn speed-dial-btn-submit"
                  disabled={!newTitle.trim() || !newUrl.trim()}
                >
                  Add Bookmark
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
