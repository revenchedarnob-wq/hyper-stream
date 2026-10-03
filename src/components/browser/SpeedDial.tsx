import { useState, useEffect, type CSSProperties, type FormEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SpeedDialItem } from './types'
import {
  IconPlus,
  IconX,
  IconGlobe,
  IconBookmark,
} from './Icons'
import { IconSearch } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'
import { resolveBrowserNavigation } from './url-utils'
import './browser.css'

export function detectPreset(inputUrl: string): { title: string; iconKey: string; accentColor: string; category: SpeedDialItem['category'] } | null {
  if (!inputUrl) return null
  let host = ''
  try {
    const withProto = /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`
    host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    host = inputUrl.toLowerCase().trim()
  }

  const match = DEFAULT_SPEED_DIAL_PRESETS.find((p) => {
    try {
      const pHost = new URL(p.url).hostname.replace(/^www\./, '')
      return host === pHost || host.endsWith(`.${pHost}`)
    } catch {
      return false
    }
  })
  if (match) {
    return {
      title: match.title,
      iconKey: match.iconKey,
      accentColor: match.accentColor ?? 'var(--color-brand-primary, #6366f1)',
      category: match.category,
    }
  }

  if (host.includes('twitch')) return { title: 'Twitch', iconKey: 'twitch', accentColor: '#9146FF', category: 'streaming' }
  if (host.includes('kick')) return { title: 'Kick', iconKey: 'kick', accentColor: '#53FC18', category: 'streaming' }
  if (host.includes('vimeo')) return { title: 'Vimeo', iconKey: 'vimeo', accentColor: '#1AB7EA', category: 'video' }
  if (host.includes('soundcloud')) return { title: 'SoundCloud', iconKey: 'soundcloud', accentColor: '#FF5500', category: 'music' }
  if (host.includes('bilibili')) return { title: 'Bilibili', iconKey: 'bilibili', accentColor: '#00A1D6', category: 'video' }
  if (host.includes('reddit')) return { title: 'Reddit', iconKey: 'reddit', accentColor: '#FF4500', category: 'social' }
  if (host.includes('github')) return { title: 'GitHub', iconKey: 'github', accentColor: '#ffffff', category: 'custom' }
  if (host.includes('spotify')) return { title: 'Spotify', iconKey: 'spotify', accentColor: '#1DB954', category: 'music' }
  if (host.includes('tiktok')) return { title: 'TikTok', iconKey: 'tiktok', accentColor: '#00F2FE', category: 'social' }

  if (host && host.includes('.')) {
    const parts = host.split('.')
    const domainName = parts[0]
    if (domainName && domainName.length > 1) {
      const pretty = domainName.charAt(0).toUpperCase() + domainName.slice(1)
      return { title: pretty, iconKey: 'custom', accentColor: 'var(--color-brand-primary, #6366f1)', category: 'custom' }
    }
  }

  return null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

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

  // The remove button sits beside the tile button (a button can't contain another button).
  return (
    <div className="speed-dial-tile-wrap">
      <button
        type="button"
        className="speed-dial-tile"
        onClick={handleClick}
        title={`${item.title} (${item.url})`}
        data-testid={`speed-dial-tile-${item.id}`}
      >
        <div className="speed-dial-tile-icon" style={iconStyle}>
          {renderSpeedDialIcon(item.iconKey, 24)}
        </div>

        <div className="speed-dial-tile-info">
          <span className="speed-dial-tile-title">{item.title}</span>
          <span className="speed-dial-tile-url">{item.url.replace(/^https?:\/\//, '')}</span>
          <span className="speed-dial-tile-category">{item.category}</span>
        </div>
      </button>

      {isCustom && onRemove && (
        <button
          type="button"
          className="speed-dial-tile-remove"
          onClick={handleRemove}
          title={`Remove ${item.title}`}
          aria-label={`Remove ${item.title}`}
        >
          <IconX size={11} />
        </button>
      )}
    </div>
  )
}

export interface SpeedDialProps {
  onSelectUrl: (url: string) => void
}

export function SpeedDial({ onSelectUrl }: SpeedDialProps) {
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
  const [userEditedTitle, setUserEditedTitle] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestHidden, setSuggestHidden] = useState(() => {
    try {
      return localStorage.getItem('hyperstream_speed_dial_hide_suggest') === '1'
    } catch {
      return false
    }
  })

  const hideSuggestions = () => {
    playHapticPop()
    setSuggestHidden(true)
    try {
      localStorage.setItem('hyperstream_speed_dial_hide_suggest', '1')
    } catch {
      // Ignore storage write errors
    }
  }

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    playHapticClick()
    onSelectUrl(resolveBrowserNavigation(q).url)
  }

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
    setNewTitle('')
    setNewUrl('')
    setUserEditedTitle(false)
    setIsAddModalOpen(true)
  }

  const handleCloseAddModal = () => {
    playHapticPop()
    setIsAddModalOpen(false)
    setNewTitle('')
    setNewUrl('')
    setUserEditedTitle(false)
  }

  const handleUrlChange = (val: string) => {
    setNewUrl(val)
    if (!userEditedTitle) {
      const detected = detectPreset(val)
      if (detected?.title) {
        setNewTitle(detected.title)
      }
    }
  }

  const handleSelectPresetSuggestion = (preset: SpeedDialItem) => {
    playHapticClick()
    setNewUrl(preset.url)
    setNewTitle(preset.title)
    setUserEditedTitle(true)
  }

  const handleAddBookmark = (e: FormEvent) => {
    e.preventDefault()
    const trimmedTitle = newTitle.trim()
    let trimmedUrl = newUrl.trim()
    if (!trimmedTitle || !trimmedUrl) return

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = `https://${trimmedUrl}`
    }

    const detected = detectPreset(trimmedUrl)
    const newBookmark: SpeedDialItem = {
      id: `custom-${Date.now()}`,
      title: trimmedTitle,
      url: trimmedUrl,
      category: detected?.category ?? 'custom',
      iconKey: detected?.iconKey ?? 'custom',
      accentColor: detected?.accentColor ?? 'var(--color-brand-primary, #6366f1)',
    }

    playHapticGlass()
    saveCustomTiles([...customTiles, newBookmark])
    setNewTitle('')
    setNewUrl('')
    setUserEditedTitle(false)
    setIsAddModalOpen(false)
  }

  const handleQuickAdd = (preset: SpeedDialItem) => {
    playHapticGlass()
    saveCustomTiles([...customTiles, { ...preset, id: `custom-${Date.now()}` }])
  }

  const addedHosts = new Set(customTiles.map((t) => hostOf(t.url)))
  const suggestions = DEFAULT_SPEED_DIAL_PRESETS.filter((p) => !addedHosts.has(hostOf(p.url)))

  const handleRemoveCustomTile = (id: string) => {
    saveCustomTiles(customTiles.filter((tile) => tile.id !== id))
  }

  const detectedPreview = detectPreset(newUrl)
  const previewIconKey = detectedPreview?.iconKey ?? 'custom'
  const previewColor = detectedPreview?.accentColor ?? 'var(--color-brand-primary, #6366f1)'

  const modalElement = isAddModalOpen ? (
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
          <div className="speed-dial-modal-heading-wrap">
            <h2 className="speed-dial-modal-title">Add Shortcut</h2>
            <span className="speed-dial-modal-pill-tag">Start page</span>
          </div>
          <button
            type="button"
            className="speed-dial-modal-close"
            onClick={handleCloseAddModal}
            aria-label="Close dialog"
          >
            <IconX size={14} />
          </button>
        </div>

        {/* Live Interactive Preview Tile Stage (Horizontal Luxury Showcase) */}
        <div
          className="speed-dial-modal-preview-stage"
          style={{ '--preview-glow': previewColor } as CSSProperties}
        >
          <div
            className="speed-dial-preview-icon"
            style={{
              color: previewColor,
              backgroundColor: `${previewColor}1f`,
              borderColor: `${previewColor}45`,
            }}
          >
            {renderSpeedDialIcon(previewIconKey, 24)}
          </div>
          <div className="speed-dial-preview-info">
            <div className="speed-dial-preview-title-row">
              <span className="speed-dial-preview-title">
                {newTitle.trim() || detectedPreview?.title || (newUrl.trim() ? hostOf(newUrl) : 'New Shortcut')}
              </span>
              {detectedPreview?.title && !userEditedTitle && (
                <span className="speed-dial-preview-badge">Auto-detected</span>
              )}
            </div>
            <span className="speed-dial-preview-url">
              {newUrl.trim() ? newUrl.trim().replace(/^https?:\/\//, '') : 'Enter an address below or pick a preset'}
            </span>
          </div>
        </div>

        <form onSubmit={handleAddBookmark} className="speed-dial-modal-form">
          <div className="speed-dial-form-group">
            <label htmlFor="portal-url-input" className="speed-dial-form-label">
              Web Address
            </label>
            <div className="speed-dial-input-box">
              <span className="speed-dial-input-icon">
                <IconGlobe size={16} />
              </span>
              <input
                id="portal-url-input"
                type="text"
                className="speed-dial-form-input"
                placeholder="e.g. twitch.tv or https://..."
                value={newUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                required
              />
              {newUrl && (
                <button
                  type="button"
                  className="speed-dial-input-clear"
                  onClick={() => {
                    playHapticPop()
                    setNewUrl('')
                    if (!userEditedTitle) setNewTitle('')
                  }}
                  title="Clear address"
                  aria-label="Clear address"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="speed-dial-form-group">
            <div className="speed-dial-form-label-row">
              <label htmlFor="portal-title-input" className="speed-dial-form-label">
                Name
              </label>
              {!userEditedTitle && newTitle && (
                <span className="speed-dial-auto-badge">Auto-filled</span>
              )}
            </div>
            <div className="speed-dial-input-box">
              <span className="speed-dial-input-icon">
                <IconBookmark size={16} />
              </span>
              <input
                id="portal-title-input"
                type="text"
                className="speed-dial-form-input"
                placeholder="e.g. Twitch"
                value={newTitle}
                onChange={(e) => {
                  setNewTitle(e.target.value)
                  setUserEditedTitle(true)
                }}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
          </div>

          {/* Popular Shortcuts Quick-Pick */}
          <div className="speed-dial-modal-presets">
            <span className="speed-dial-modal-presets-label">Popular</span>
            <div className="speed-dial-modal-chips">
              {DEFAULT_SPEED_DIAL_PRESETS.map((preset) => {
                const isSelected = newUrl === preset.url || newUrl === preset.url.replace(/^https?:\/\//, '')
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`speed-dial-modal-chip ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectPresetSuggestion(preset)}
                  >
                    <span style={{ color: preset.accentColor, display: 'inline-flex' }}>
                      {renderSpeedDialIcon(preset.iconKey, 13)}
                    </span>
                    <span>{preset.title}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="speed-dial-modal-actions">
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
              aria-label="Add Bookmark"
            >
              Add Shortcut
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null

  return (
    <section className="speed-dial-container" aria-label="Start page">
      <header className="speed-dial-header">
        <h1 className="speed-dial-title">Find something to download</h1>
        <p className="speed-dial-subtitle">
          Open a video page, then press Download.
        </p>
      </header>

      <form className="speed-dial-search" role="search" onSubmit={handleSearch}>
        <IconSearch size={18} className="speed-dial-search-icon" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the web or type a link"
          aria-label="Search the web or type a link"
          autoComplete="off"
          spellCheck={false}
          data-testid="speed-dial-search"
        />
      </form>

      {/* Speed Dial Grid */}
      <div className="speed-dial-grid" role="list" aria-label="Sites">
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
          aria-label="Add bookmark"
          data-testid="speed-dial-add-button"
        >
          <div className="speed-dial-add-icon">
            <IconPlus size={22} />
          </div>
          <span className="speed-dial-add-text">
            {customTiles.length === 0 ? 'Add your first site' : 'Add site'}
          </span>
        </button>
      </div>

      {!suggestHidden && suggestions.length > 0 && (
        <div className="speed-dial-suggest" aria-label="Suggested sites">
          <span className="speed-dial-suggest-label">Quick add</span>
          <div className="speed-dial-chips-wrap">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="speed-dial-chip"
                onClick={() => handleQuickAdd(p)}
                title={`Add ${p.title}`}
                style={{ '--chip-accent': p.accentColor } as CSSProperties}
              >
                {renderSpeedDialIcon(p.iconKey, 14)}
                <span>{p.title}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="speed-dial-suggest-close"
            onClick={hideSuggestions}
            title="Hide Quick add"
            aria-label="Hide Quick add"
          >
            <IconX size={12} />
          </button>
        </div>
      )}

      {/* Render modal into document.body to cover the entire window uniformly */}
      {modalElement && (typeof document !== 'undefined' ? createPortal(modalElement, document.body) : modalElement)}
    </section>
  )
}
