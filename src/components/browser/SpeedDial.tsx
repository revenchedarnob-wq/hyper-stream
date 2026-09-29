import { useState, useEffect, type CSSProperties, type FormEvent, type MouseEvent } from 'react'
import type { SpeedDialItem } from './types'
import {
  IconPlus,
  IconX,
} from './Icons'
import { IconSearch } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'
import { resolveBrowserNavigation } from './url-utils'
import './browser.css'

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

    let host = ''
    try { host = new URL(trimmedUrl).hostname.replace(/^www\./, '') } catch { /* keep empty */ }
    const known = DEFAULT_SPEED_DIAL_PRESETS.find((p) => host === new URL(p.url).hostname || host.endsWith(`.${new URL(p.url).hostname}`))
    const newBookmark: SpeedDialItem = {
      id: `custom-${Date.now()}`,
      title: trimmedTitle,
      url: trimmedUrl,
      category: known?.category ?? 'custom',
      iconKey: known?.iconKey ?? 'custom',
      accentColor: known?.accentColor ?? 'var(--color-brand-primary)',
    }

    playHapticGlass()
    saveCustomTiles([...customTiles, newBookmark])
    setNewTitle('')
    setNewUrl('')
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
              <h2 className="speed-dial-modal-title">Add Bookmark</h2>
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
                  Name
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
                  Address
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
