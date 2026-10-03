import { describe, it, expect } from 'vitest'
import { filterLibrary } from './library-filter'
import type { LibraryItem } from '@/lib/tauri-bridge'

function item(patch: Partial<LibraryItem>): LibraryItem {
  return {
    id: 'x',
    title: 'Untitled',
    file_path: 'C:/media/x.mp4',
    source_url: 'https://www.youtube.com/watch?v=1',
    size_bytes: 0,
    added_at: 0,
    kind: 'video',
    container: 'mp4',
    audio_languages: [],
    subtitle_languages: [],
    missing: false,
    ...patch,
  }
}

const items = [
  item({ id: 'a', title: 'Alpha talk', added_at: 3, size_bytes: 10, duration: 60, uploader: 'Conf' }),
  item({ id: 'b', title: 'Beta song', added_at: 1, size_bytes: 30, duration: 200, kind: 'audio', source_url: 'https://soundcloud.com/a/b' }),
  item({ id: 'c', title: 'Gamma clip', added_at: 2, size_bytes: 20, duration: null }),
]

const ids = (list: LibraryItem[]) => list.map((i) => i.id)

describe('filterLibrary', () => {
  it('sorts newest first by default', () => {
    expect(ids(filterLibrary(items, 'all', '', 'recent'))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by size, duration and title', () => {
    expect(ids(filterLibrary(items, 'all', '', 'size'))).toEqual(['b', 'c', 'a'])
    expect(ids(filterLibrary(items, 'all', '', 'duration'))).toEqual(['b', 'a', 'c'])
    expect(ids(filterLibrary(items, 'all', '', 'title'))).toEqual(['a', 'b', 'c'])
  })

  it('filters by kind', () => {
    expect(ids(filterLibrary(items, 'audio', '', 'recent'))).toEqual(['b'])
    expect(ids(filterLibrary(items, 'video', '', 'recent'))).toEqual(['a', 'c'])
  })

  it('searches title, channel and site', () => {
    expect(ids(filterLibrary(items, 'all', 'gamma', 'recent'))).toEqual(['c'])
    expect(ids(filterLibrary(items, 'all', 'conf', 'recent'))).toEqual(['a'])
    expect(ids(filterLibrary(items, 'all', 'soundcloud', 'recent'))).toEqual(['b'])
  })

  it('does not mutate the input', () => {
    const copy = items.slice()
    filterLibrary(items, 'all', '', 'title')
    expect(items).toEqual(copy)
  })
})
