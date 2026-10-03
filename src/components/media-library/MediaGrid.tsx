import React from 'react'
import type { LibraryItem } from '@/lib/tauri-bridge'
import { MediaCard, type MediaItemActions } from './MediaCard'

export const MediaGrid: React.FC<{ items: LibraryItem[] } & MediaItemActions> = React.memo(
  ({ items, onPlay, onReveal, onDelete }) => (
    <div className="media-grid-container">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} onPlay={onPlay} onReveal={onReveal} onDelete={onDelete} />
      ))}
    </div>
  ),
)

export default MediaGrid
