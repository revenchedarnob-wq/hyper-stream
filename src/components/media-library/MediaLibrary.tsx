import React, { useState, useMemo, useEffect } from 'react'
import './media-library.css'
import { INITIAL_MEDIA_ITEMS } from './mock-media-data'
import type { MediaItem, EpisodeItem } from './mock-media-data'
import { MediaGrid } from './MediaGrid'
import { MediaList } from './MediaList'
import { GlassPlayerModal } from './GlassPlayerModal'
import { SeriesDetailView } from './SeriesDetailView'
import { revealInExplorer } from '@/lib/tauri-bridge'
import { IconSearch, IconX, IconGrid, IconList, IconHardDrive, IconFolder } from '../stream-hub/Icons'
import { GlassSelect } from '../common/GlassSelect'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'size', label: 'Size' },
  { value: 'duration', label: 'Duration' },
  { value: 'title', label: 'Title' },
]

export const MediaLibrary: React.FC = () => {
  const [items, setItems] = useState<MediaItem[]>(() => {
    try {
      const saved = localStorage.getItem('hyperstream_media_items')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: MediaItem) => {
            const initialMatch = INITIAL_MEDIA_ITEMS.find((init) => init.id === item.id)
            return initialMatch
              ? { ...item, ...initialMatch, posterUrl: initialMatch.posterUrl || item.posterUrl }
              : item
          })
        }
      }
    } catch {
      // Ignore storage read error
    }
    return INITIAL_MEDIA_ITEMS
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [playerItem, setPlayerItem] = useState<MediaItem | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null)
  const [notification, setNotification] = useState<string | null>(null)

  const handleResetFilters = () => {
    setSearchQuery('')
    setActiveCategory('all')
  }

  const updateItems = (updater: (prev: MediaItem[]) => MediaItem[]) => {
    setItems((prev) => {
      const next = updater(prev)
      try {
        localStorage.setItem('hyperstream_media_items', JSON.stringify(next))
      } catch {
        // Ignore storage write error
      }
      return next
    })
  }

  useEffect(() => {
    const handleMediaAdded = (e: Event) => {
      const customEvent = e as CustomEvent<MediaItem>
      if (customEvent.detail) {
        setItems((prev) => [customEvent.detail, ...prev.filter((i) => i.id !== customEvent.detail.id)])
      }
    }
    window.addEventListener('hyperstream:media-added', handleMediaAdded)
    return () => window.removeEventListener('hyperstream:media-added', handleMediaAdded)
  }, [])

  const showNotification = (msg: string) => {
    setNotification(msg)
    setTimeout(() => {
      setNotification((curr) => (curr === msg ? null : curr))
    }, 3000)
  }

  // Category counts
  const counts = useMemo(() => {
    return {
      all: items.length,
      anime: items.filter((i) => i.category === 'anime').length,
      stream: items.filter((i) => i.category === 'stream').length,
      '4k': items.filter((i) => i.category === '4k').length,
      audio: items.filter((i) => i.category === 'audio').length,
    }
  }, [items])

  const categories = useMemo(() => [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'anime', label: 'Anime', count: counts.anime },
    { id: 'stream', label: 'Streams', count: counts.stream },
    { id: '4k', label: '4K Masters', count: counts['4k'] },
    { id: 'audio', label: 'Audio', count: counts.audio },
  ], [counts])

  // Filtered & Sorted items
  const displayedItems = useMemo(() => {
    let result = [...items]

    // Category filter
    if (activeCategory !== 'all') {
      result = result.filter((item) => item.category === activeCategory)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.codec.toLowerCase().includes(q) ||
          item.quality.toLowerCase().includes(q) ||
          item.source.toLowerCase().includes(q)
      )
    }

    // Sort
    if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy === 'size') {
      const parseSize = (s: string) => {
        const num = parseFloat(s)
        if (s.includes('GB')) return num * 1024
        return num
      }
      result.sort((a, b) => parseSize(b.size) - parseSize(a.size))
    } else if (sortBy === 'duration') {
      const parseDuration = (d: string) => {
        const parts = d.split(':')
        if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
        if (d.includes('h')) {
          const hrs = parseInt(d.split('h')[0])
          const mins = parseInt(d.split('h')[1]?.replace('m', '') || '0')
          return hrs * 3600 + mins * 60
        }
        return 0
      }
      result.sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration))
    }

    return result
  }, [items, activeCategory, searchQuery, sortBy])

  const handleDelete = (id: string) => {
    const target = items.find((i) => i.id === id)
    updateItems((prev) => prev.filter((i) => i.id !== id))
    if (target) {
      showNotification(`Removed: ${target.title}`)
    }
  }

  const handleOpenFolder = (item?: MediaItem) => {
    if (item) {
      revealInExplorer(`C:\\Users\\arnob\\Downloads\\${item.title}.mp4`)
      showNotification(`Revealed in Explorer: ${item.title}`)
    } else {
      revealInExplorer(`C:\\Users\\arnob\\Downloads`)
      showNotification('Revealed capture directory in Explorer')
    }
  }

  const handlePlayEpisode = (series: MediaItem, episode: EpisodeItem) => {
    playHapticClick()
    setPlayerItem({
      ...series,
      title: `${series.title} · ${episode.title}`,
      videoUrl: episode.videoUrl || series.videoUrl,
      duration: episode.duration || series.duration,
      quality: episode.quality || series.quality,
      codec: episode.codec || series.codec,
      size: episode.size || series.size,
    })
  }

  const handleRevealEpisode = (episode: EpisodeItem) => {
    playHapticClick()
    const filePath = episode.filePath || `C:\\Users\\arnob\\Downloads\\${episode.title}.mp4`
    revealInExplorer(filePath)
    showNotification(`Revealed in Explorer: ${episode.title}`)
  }

  return (
    <div className="media-library-container">
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '20px',
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#ffffff',
            padding: '9px 16px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0,0,0,0.20)',
            zIndex: 100,
            animation: 'bannerSlideIn 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
        >
          {notification}
        </div>
      )}

      {selectedSeries ? (
        <SeriesDetailView
          seriesItem={selectedSeries}
          onBack={() => setSelectedSeries(null)}
          onPlayEpisode={handlePlayEpisode}
          onRevealEpisode={handleRevealEpisode}
          onOpenFolder={handleOpenFolder}
        />
      ) : (
        <div className="media-library-content animate-fade-in">
        {/* Unified Clean Header: Title on Left, Search & View Controls on Right */}
        <div className="media-library-header">
          <h1 className="media-library-title">Media Library</h1>

          <div className="media-library-header-actions">
            {/* Compact Search Input */}
            <div className="library-search-card">
              <div className="library-search-icon">
                <IconSearch size={14} />
              </div>
              <input
                id="library-search-input"
                name="librarySearch"
                type="text"
                className="library-search-input"
                placeholder="Search media..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="omnibar-clear-btn"
                  onClick={() => {
                    playHapticClick()
                    setSearchQuery('')
                  }}
                  title="Clear Search"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <GlassSelect
              id="library-sort-select"
              value={sortBy}
              options={SORT_OPTIONS}
              onChange={setSortBy}
              ariaLabel="Sort library items"
            />

            {/* Grid vs List View Toggle Pill */}
            <div className="view-mode-pill">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => {
                  playHapticGlass()
                  setViewMode('grid')
                }}
                title="Grid View"
              >
                <IconGrid size={14} />
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => {
                  playHapticGlass()
                  setViewMode('list')
                }}
                title="List View"
              >
                <IconList size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Subnav Row: Category Pills on Left + Quiet Storage Pill on Right */}
        <div className="media-library-subnav">
          <div className="library-category-pills">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`library-cat-pill ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => {
                  playHapticPop()
                  setActiveCategory(cat.id)
                }}
              >
                <span>{cat.label}</span>
                <span className="cat-pill-count">{cat.count}</span>
              </button>
            ))}
          </div>

          <div className="library-storage-pill">
            <IconHardDrive size={13} className="storage-pill-icon" />
            <span className="storage-pill-text">
              37.4 GB used <span className="meta-dot">·</span> 1.85 TB free
            </span>
            <button
              type="button"
              className="storage-pill-folder-btn"
              onClick={() => handleOpenFolder()}
              title="Reveal Downloads folder in Explorer"
            >
              <IconFolder size={11} />
              <span>Folder</span>
            </button>
          </div>
        </div>

        {/* Presentation Grid or List */}
        {viewMode === 'grid' ? (
          <MediaGrid
            items={displayedItems}
            onPlay={(item) => setPlayerItem(item)}
            onOpenFolder={(item) => handleOpenFolder(item)}
            onDelete={handleDelete}
            onOpenSeries={(item) => setSelectedSeries(item)}
            searchQuery={searchQuery}
            activeCategory={activeCategory}
            onResetFilters={handleResetFilters}
            totalLibraryCount={items.length}
          />
        ) : (
          <MediaList
            items={displayedItems}
            onPlay={(item) => setPlayerItem(item)}
            onOpenFolder={(item) => handleOpenFolder(item)}
            onDelete={handleDelete}
            onOpenSeries={(item) => setSelectedSeries(item)}
            searchQuery={searchQuery}
            activeCategory={activeCategory}
            onResetFilters={handleResetFilters}
            totalLibraryCount={items.length}
          />
        )}
      </div>
      )}

      {/* 4. In-App Glass Video Preview Player */}
      <GlassPlayerModal
        item={playerItem}
        onClose={() => setPlayerItem(null)}
      />
    </div>
  )
}

export default MediaLibrary
