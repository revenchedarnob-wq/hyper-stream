import { useState, useEffect, useRef, type MouseEvent } from 'react'
import type { SpeedDialItem } from './types'
import {
  IconSearch,
  IconGlobe,
  IconBookmark,
  IconArrowRight,
} from './Icons'
import { renderSpeedDialIcon } from './speed-dial-presets'
import { playHapticClick } from '@/lib/sound'

export interface SearchEngine {
  id: string
  name: string
  urlTemplate: string
  iconColor: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'brave', name: 'Brave', urlTemplate: 'https://search.brave.com/search?q=%s', iconColor: '#ff2000' },
  { id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?q=%s', iconColor: '#4285f4' },
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q=%s', iconColor: '#de5833' },
  { id: 'youtube', name: 'YouTube', urlTemplate: 'https://www.youtube.com/results?search_query=%s', iconColor: '#ff0000' },
]

export interface OmnibarDropdownProps {
  query: string
  isOpen: boolean
  onSelect: (url: string) => void
  onClose: () => void
  shortcuts?: SpeedDialItem[]
}

export function OmnibarDropdown({
  query,
  isOpen,
  onSelect,
  onClose,
  shortcuts = [],
}: OmnibarDropdownProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const trimmed = query.trim()

  // Generate suggestions
  interface SuggestionItem {
    id: string
    type: 'search' | 'direct' | 'bookmark'
    title: string
    subtitle: string
    url: string
    engineId?: string
    iconKey?: string
    accentColor?: string
  }

  const items: SuggestionItem[] = []

  if (trimmed) {
    const isDomainLike = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed) && !trimmed.includes(' ')
    if (isDomainLike) {
      const directUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      items.push({
        id: 'direct-nav',
        type: 'direct',
        title: `Navigate to ${trimmed}`,
        subtitle: directUrl,
        url: directUrl,
      })
    }

    // Engine searches
    for (const engine of SEARCH_ENGINES) {
      const searchUrl = engine.urlTemplate.replace('%s', encodeURIComponent(trimmed))
      items.push({
        id: `search-${engine.id}`,
        type: 'search',
        title: `Search with ${engine.name}`,
        subtitle: trimmed,
        url: searchUrl,
        engineId: engine.id,
        accentColor: engine.iconColor,
      })
    }

    // Matching bookmarks / speed dial
    const qLower = trimmed.toLowerCase()
    const matchedBookmarks = shortcuts.filter(
      (s) => s.title.toLowerCase().includes(qLower) || s.url.toLowerCase().includes(qLower),
    )
    for (const bm of matchedBookmarks.slice(0, 4)) {
      items.push({
        id: `bm-${bm.id}`,
        type: 'bookmark',
        title: bm.title,
        subtitle: bm.url.replace(/^https?:\/\//, ''),
        url: bm.url,
        iconKey: bm.iconKey,
        accentColor: bm.accentColor,
      })
    }
  }

  // Handle keyboard events on the dropdown
  useEffect(() => {
    if (!isOpen || items.length === 0) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[selectedIndex]) {
          playHapticClick()
          onSelect(items[selectedIndex].url)
          onClose()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, items, selectedIndex, onSelect, onClose])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [trimmed])

  if (!isOpen || items.length === 0) return null

  return (
    <div
      ref={dropdownRef}
      className="omnibar-dropdown"
      role="listbox"
      aria-label="Address bar suggestions"
      data-testid="omnibar-dropdown"
    >
      <div className="omnibar-dropdown-list">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={isSelected}
              className={`omnibar-dropdown-item ${isSelected ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={(e: MouseEvent) => {
                e.stopPropagation()
                playHapticClick()
                onSelect(item.url)
                onClose()
              }}
              data-testid={`omnibar-item-${item.id}`}
            >
              <div
                className="omnibar-item-icon"
                style={{ color: item.accentColor ?? 'var(--color-text-secondary, #94a3b8)' }}
              >
                {item.type === 'search' ? (
                  <IconSearch size={14} />
                ) : item.type === 'bookmark' ? (
                  item.iconKey ? (
                    renderSpeedDialIcon(item.iconKey, 14)
                  ) : (
                    <IconBookmark size={14} />
                  )
                ) : (
                  <IconGlobe size={14} />
                )}
              </div>

              <div className="omnibar-item-text">
                <span className="omnibar-item-title">{item.title}</span>
                <span className="omnibar-item-subtitle">{item.subtitle}</span>
              </div>

              <div className="omnibar-item-action">
                <IconArrowRight size={12} className="omnibar-item-arrow" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
