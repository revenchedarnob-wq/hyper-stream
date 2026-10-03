import type { LibraryItem } from '@/lib/tauri-bridge'
import { hostnameOf } from '@/lib/format'

export type LibrarySort = 'recent' | 'size' | 'duration' | 'title'
export type LibraryCategory = 'all' | 'video' | 'audio'

/** Category + text search over title, channel and site, then sort. */
export function filterLibrary(
  items: LibraryItem[],
  category: LibraryCategory,
  query: string,
  sort: LibrarySort,
): LibraryItem[] {
  const q = query.trim().toLowerCase()
  const result = items.filter((item) => {
    if (category !== 'all' && item.kind !== category) return false
    if (!q) return true
    return [item.title, item.uploader ?? '', item.extractor ?? '', hostnameOf(item.source_url)].some((field) =>
      field.toLowerCase().includes(q),
    )
  })
  const by: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
    recent: (a, b) => b.added_at - a.added_at,
    size: (a, b) => b.size_bytes - a.size_bytes,
    duration: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
    title: (a, b) => a.title.localeCompare(b.title),
  }
  return result.sort(by[sort])
}
