import { useState, useEffect, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SpeedDialItem } from './types'
import { IconPlus, IconX, IconGlobe, IconBookmark } from './Icons'
import { IconSearch } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { DEFAULT_SPEED_DIAL_PRESETS, renderSpeedDialIcon } from './speed-dial-presets'
import { resolveBrowserNavigation } from './url-utils'
import {
  detectSite,
  hostOf,
  setShortcuts,
  getShortcuts,
  tint,
  useDebounced,
  useShortcuts,
  useSiteLogo,
  withScheme,
} from './shortcuts'
import './browser.css'

/** The site's real logo when it has loaded, otherwise its brand mark or a globe. */
function SiteIcon({ url, iconKey, accentColor, size }: { url: string; iconKey: string; accentColor?: string; size: number }) {
  const logo = useSiteLogo(url)
  const accent = logo?.accent ?? accentColor ?? 'var(--color-brand-primary, #6366f1)'
  if (logo) {
    return (
      <span
        className={`site-icon has-logo ${logo.fullBleed ? 'is-full-bleed' : 'is-mark'}`}
        style={{ '--site-accent': accent } as CSSProperties}
      >
        <img src={logo.src} alt="" draggable={false} />
      </span>
    )
  }
  return (
    <span
      className="site-icon"
      style={{ '--site-accent': accent, color: accent, background: tint(accent, 10), borderColor: tint(accent, 22) } as CSSProperties}
    >
      {renderSpeedDialIcon(iconKey, size)}
    </span>
  )
}

export interface SpeedDialTileProps {
  item: SpeedDialItem
  onSelect: (url: string) => void
  onRemove?: (id: string) => void
  onContextMenu?: (item: SpeedDialItem, e: MouseEvent<HTMLElement>) => void
  isCustom?: boolean
  /** Drag-to-reorder wiring from the grid. */
  dragProps?: {
    draggable: boolean
    onDragStart: (e: DragEvent<HTMLDivElement>) => void
    onDragOver: (e: DragEvent<HTMLDivElement>) => void
    onDrop: (e: DragEvent<HTMLDivElement>) => void
    onDragEnd: () => void
  }
  isDragging?: boolean
}

export function SpeedDialTile({ item, onSelect, onRemove, onContextMenu, isCustom = false, dragProps, isDragging }: SpeedDialTileProps) {
  const handleClick = () => {
    playHapticClick()
    onSelect(item.url)
  }

  const handleRemove = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    playHapticPop()
    onRemove?.(item.id)
  }

  // The remove button sits beside the tile button (a button can't contain another button).
  return (
    <div
      className={`speed-dial-tile-wrap ${isDragging ? 'is-dragging' : ''}`}
      role="listitem"
      onContextMenu={onContextMenu ? (e) => onContextMenu(item, e) : undefined}
      {...dragProps}
    >
      <button
        type="button"
        className="speed-dial-tile"
        onClick={handleClick}
        title={`${item.title} (${item.url.replace(/^https?:\/\//, '')})`}
        data-testid={`speed-dial-tile-${item.id}`}
      >
        <div className="speed-dial-tile-icon">
          <SiteIcon url={item.url} iconKey={item.iconKey} accentColor={item.accentColor} size={24} />
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

interface MenuState {
  item: SpeedDialItem
  x: number
  y: number
}

export function SpeedDial({ onSelectUrl }: SpeedDialProps) {
  const shortcuts = useShortcuts()

  const [isModalOpen, setIsModalOpen] = useState(false)
  /** The shortcut being edited; null while adding a new one. */
  const [editing, setEditing] = useState<SpeedDialItem | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [userEditedTitle, setUserEditedTitle] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
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
    if (!isModalOpen && !menu) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenu(null)
      setIsModalOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, menu])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openModal = (item: SpeedDialItem | null) => {
    playHapticClick()
    setEditing(item)
    setNewTitle(item?.title ?? '')
    setNewUrl(item ? item.url.replace(/^https:\/\//, '') : '')
    setUserEditedTitle(Boolean(item))
    setIsModalOpen(true)
  }

  const closeModal = () => {
    playHapticPop()
    setIsModalOpen(false)
  }

  const handleUrlChange = (val: string) => {
    setNewUrl(val)
    if (!userEditedTitle) setNewTitle(detectSite(val)?.title ?? '')
  }

  const handlePickPreset = (preset: SpeedDialItem) => {
    playHapticClick()
    setNewUrl(preset.url.replace(/^https:\/\//, ''))
    setNewTitle(preset.title)
    setUserEditedTitle(false)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    const url = withScheme(newUrl)
    if (!title || !newUrl.trim()) return

    const detected = detectSite(url)
    const saved: SpeedDialItem = {
      id: editing?.id ?? `custom-${Date.now()}`,
      title,
      url,
      category: detected?.category ?? 'custom',
      iconKey: detected?.iconKey ?? 'custom',
      accentColor: detected?.accentColor,
    }
    playHapticGlass()
    const list = getShortcuts()
    setShortcuts(editing ? list.map((s) => (s.id === editing.id ? saved : s)) : [...list, saved])
    setIsModalOpen(false)
  }

  const handleQuickAdd = (preset: SpeedDialItem) => {
    playHapticGlass()
    setShortcuts([...getShortcuts(), { ...preset, id: `custom-${Date.now()}` }])
  }

  const handleRemove = (id: string) => {
    setShortcuts(getShortcuts().filter((tile) => tile.id !== id))
  }

  const handleContextMenu = (item: SpeedDialItem, e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    // Keep the menu inside the window.
    setMenu({ item, x: Math.min(e.clientX, window.innerWidth - 168), y: Math.min(e.clientY, window.innerHeight - 96) })
  }

  const dragPropsFor = (item: SpeedDialItem): SpeedDialTileProps['dragProps'] => ({
    draggable: true,
    onDragStart: (e) => {
      setDragId(item.id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', item.url)
    },
    onDragOver: (e) => {
      if (!dragId || dragId === item.id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e) => {
      e.preventDefault()
      if (!dragId || dragId === item.id) return
      const list = [...getShortcuts()]
      const from = list.findIndex((s) => s.id === dragId)
      const to = list.findIndex((s) => s.id === item.id)
      if (from < 0 || to < 0) return
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      playHapticClick()
      setShortcuts(list)
    },
    onDragEnd: () => setDragId(null),
  })

  const addedHosts = new Set(shortcuts.map((t) => hostOf(t.url)))
  const suggestions = DEFAULT_SPEED_DIAL_PRESETS.filter((p) => !addedHosts.has(hostOf(p.url)))

  // Only look a logo up once the address has stopped changing.
  const settledUrl = useDebounced(newUrl.trim(), 450)
  const previewSite = detectSite(newUrl)
  const previewLooksValid = /\.[a-z]{2,}/i.test(settledUrl)

  const modalElement = isModalOpen ? (
    <div className="speed-dial-modal-backdrop" onClick={closeModal} role="presentation">
      <div
        className="speed-dial-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="speed-dial-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="speed-dial-modal-header">
          <h2 id="speed-dial-modal-title" className="speed-dial-modal-title">
            {editing ? 'Edit shortcut' : 'Add shortcut'}
          </h2>
          <button type="button" className="speed-dial-modal-close" onClick={closeModal} aria-label="Close dialog">
            <IconX size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="speed-dial-modal-form">
          <div className="speed-dial-form-group">
            <label htmlFor="portal-url-input" className="speed-dial-form-label">
              Web address
            </label>
            <div className="speed-dial-input-box">
              <span className="speed-dial-input-icon is-site" aria-hidden="true">
                {previewLooksValid ? (
                  <SiteIcon
                    url={settledUrl}
                    iconKey={previewSite?.iconKey ?? 'custom'}
                    accentColor={previewSite?.accentColor}
                    size={14}
                  />
                ) : (
                  <IconGlobe size={16} />
                )}
              </span>
              <input
                id="portal-url-input"
                type="text"
                className="speed-dial-form-input"
                placeholder="twitch.tv"
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
            <label htmlFor="portal-title-input" className="speed-dial-form-label">
              Name
            </label>
            <div className="speed-dial-input-box">
              <span className="speed-dial-input-icon" aria-hidden="true">
                <IconBookmark size={16} />
              </span>
              <input
                id="portal-title-input"
                type="text"
                className="speed-dial-form-input"
                placeholder="Twitch"
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

          {!editing && (
            <div className="speed-dial-modal-presets">
              <span className="speed-dial-modal-presets-label">Popular</span>
              <div className="speed-dial-modal-chips">
                {DEFAULT_SPEED_DIAL_PRESETS.map((preset) => {
                  const isSelected = hostOf(newUrl) === hostOf(preset.url)
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`speed-dial-modal-chip ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => handlePickPreset(preset)}
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
          )}

          <div className="speed-dial-modal-actions">
            <button type="button" className="speed-dial-btn speed-dial-btn-cancel" onClick={closeModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="speed-dial-btn speed-dial-btn-submit"
              disabled={!newTitle.trim() || !newUrl.trim()}
            >
              {editing ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null

  const menuElement = menu ? (
    <div
      className="speed-dial-menu"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="speed-dial-menu-item"
        onClick={() => {
          const item = menu.item
          setMenu(null)
          openModal(item)
        }}
      >
        Edit
      </button>
      <button
        type="button"
        role="menuitem"
        className="speed-dial-menu-item is-danger"
        onClick={() => {
          playHapticPop()
          handleRemove(menu.item.id)
          setMenu(null)
        }}
      >
        Remove
      </button>
    </div>
  ) : null

  const portal = (node: ReactNode) =>
    node && (typeof document !== 'undefined' ? createPortal(node, document.body) : node)

  return (
    <section className="speed-dial-container" aria-label="Start page">
      <header className="speed-dial-header">
        <h1 className="speed-dial-title">Find something to download</h1>
        <p className="speed-dial-subtitle">Open a video page, then press Download.</p>
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

      <div className="speed-dial-grid" role="list" aria-label="Sites">
        {shortcuts.map((item) => (
          <SpeedDialTile
            key={item.id}
            item={item}
            onSelect={onSelectUrl}
            onRemove={handleRemove}
            onContextMenu={handleContextMenu}
            dragProps={dragPropsFor(item)}
            isDragging={dragId === item.id}
            isCustom
          />
        ))}

        <button
          type="button"
          className="speed-dial-add-tile"
          onClick={() => openModal(null)}
          aria-label="Add site"
          data-testid="speed-dial-add-button"
        >
          <div className="speed-dial-add-icon">
            <IconPlus size={22} />
          </div>
          <span className="speed-dial-add-text">{shortcuts.length === 0 ? 'Add your first site' : 'Add site'}</span>
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

      {/* Portaled so the dim and the menu cover the whole window, not just the content pane. */}
      {portal(modalElement)}
      {portal(menuElement)}
    </section>
  )
}
