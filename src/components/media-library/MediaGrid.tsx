import React from 'react'
import type { MediaItem } from './mock-media-data'
import { MediaCard } from './MediaCard'
import { IconFilm, IconSearch } from '../stream-hub/Icons'
import { playHapticClick } from '@/lib/sound'

export interface MediaGridProps {
  items: MediaItem[]
  onPlay: (item: MediaItem) => void
  onOpenFolder: (item: MediaItem) => void
  onDelete: (id: string) => void
  onOpenSeries?: (item: MediaItem) => void
  searchQuery?: string
  activeCategory?: string
  onResetFilters?: () => void
  totalLibraryCount?: number
}

export const MediaGrid: React.FC<MediaGridProps> = React.memo(({
  items,
  onPlay,
  onOpenFolder,
  onDelete,
  onOpenSeries,
  searchQuery = '',
  activeCategory = 'all',
  onResetFilters,
  totalLibraryCount,
}) => {
  if (items.length === 0) {
    const isLibraryEmpty = (totalLibraryCount ?? 0) === 0 && !searchQuery && activeCategory === 'all'

    return (
      <div className="library-empty-state">
        <div className="library-empty-icon-circle">
          {isLibraryEmpty ? <IconFilm size={26} /> : <IconSearch size={24} />}
        </div>
        <p className="empty-title">
          {isLibraryEmpty ? 'No media in library' : 'No matching captures'}
        </p>
        <p className="empty-sub">
          {isLibraryEmpty
            ? 'Captures and completed ingestions from Stream Hub will appear here.'
            : searchQuery
            ? `No media matches "${searchQuery}".`
            : `No media found under the "${activeCategory}" filter.`}
        </p>
        {!isLibraryEmpty && onResetFilters && (
          <button
            type="button"
            className="empty-reset-btn"
            onClick={() => {
              playHapticClick()
              onResetFilters()
            }}
          >
            <span>Reset filters</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="media-grid-container">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onPlay={onPlay}
          onOpenFolder={onOpenFolder}
          onDelete={onDelete}
          onOpenSeries={onOpenSeries}
        />
      ))}
    </div>
  )
})

export default MediaGrid
