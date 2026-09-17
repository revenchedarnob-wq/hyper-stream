import React from 'react'
import { IconSearch, IconX, IconGrid, IconList } from '../stream-hub/Icons'
import { playHapticPop, playHapticGlass, playHapticClick } from '@/lib/sound'
import { GlassSelect } from '../common/GlassSelect'

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'size', label: 'Size (Largest)' },
  { value: 'duration', label: 'Duration' },
  { value: 'title', label: 'Title (A-Z)' },
]

interface LibraryFilterBarProps {
  searchQuery: string
  onSearchChange: (val: string) => void
  activeCategory: string
  onCategoryChange: (cat: string) => void
  sortBy: string
  onSortChange: (sort: string) => void
  viewMode: 'grid' | 'list'
  onViewModeChange: (mode: 'grid' | 'list') => void
  counts: {
    all: number
    anime: number
    stream: number
    '4k': number
    audio: number
  }
}

export const LibraryFilterBar: React.FC<LibraryFilterBarProps> = React.memo(({
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  counts,
}) => {
  const CATEGORIES = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'anime', label: 'Anime', count: counts.anime },
    { id: 'stream', label: 'Streams', count: counts.stream },
    { id: '4k', label: '4K Masters', count: counts['4k'] },
    { id: 'audio', label: 'Audio', count: counts.audio },
  ]

  return (
    <div className="library-filter-wrapper">
      {/* Top Search & Controls Row */}
      <div className="library-filter-top">
        <div className="library-search-card">
          <div className="library-search-icon">
            <IconSearch size={16} />
          </div>
          <input
            id="library-search-input"
            name="librarySearch"
            type="text"
            className="library-search-input"
            placeholder="Filter library by title, tag, codec (e.g. AV1, 4K)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="omnibar-clear-btn"
              onClick={() => {
                playHapticClick()
                onSearchChange('')
              }}
              title="Clear Search"
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        {/* View mode toggle & Sort */}
        <div className="library-actions-group">
          <GlassSelect
            id="library-sort-select"
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={onSortChange}
            ariaLabel="Sort library items"
          />

          {/* Grid vs List View Toggle Pill */}
          <div className="view-mode-pill">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => {
                playHapticGlass()
                onViewModeChange('grid')
              }}
              title="Grid View"
            >
              <IconGrid size={15} />
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => {
                playHapticGlass()
                onViewModeChange('list')
              }}
              title="List View"
            >
              <IconList size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Category Pills Row */}
      <div className="library-category-pills">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`library-cat-pill ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => {
              playHapticPop()
              onCategoryChange(cat.id)
            }}
          >
            <span>{cat.label}</span>
            <span className="cat-pill-count">{cat.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
})
