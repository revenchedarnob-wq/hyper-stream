import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './media-library.css'
import { MediaGrid } from './MediaGrid'
import { MediaList } from './MediaList'
import {
  errorMessage,
  getDefaultDownloadDir,
  getSystemVitals,
  isTauri,
  openMediaFile,
  removeLibraryItem,
  revealInExplorer,
  type LibraryItem,
  type SystemVitalsData,
} from '@/lib/tauri-bridge'
import { IconSearch, IconX, IconGrid, IconList, IconHardDrive, IconFolder, IconFilm, IconTrash } from '../stream-hub/Icons'
import { GlassSelect } from '../common/GlassSelect'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { useLibrary, useSettings } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'
import { filterLibrary, type LibraryCategory, type LibrarySort } from './library-filter'


const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'size', label: 'Size' },
  { value: 'duration', label: 'Duration' },
  { value: 'title', label: 'Title' },
]

const VIEW_KEY = 'hyperstream_library_view'

function loadView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export const MediaLibrary: React.FC = () => {
  const settings = useSettings()
  const { items, loaded } = useLibrary()
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState<LibraryCategory>('all')
  const [sortBy, setSortBy] = useState<LibrarySort>('recent')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(loadView)
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null)
  const [vitals, setVitals] = useState<SystemVitalsData | null>(null)
  const [defaultDir, setDefaultDir] = useState('')
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const show = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setToast({ text, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 5000 : 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  useEffect(() => {
    void getDefaultDownloadDir().then(setDefaultDir)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void getSystemVitals(settings.downloadDir).then((v) => {
      if (!disposed && v) setVitals(v)
    })
    return () => {
      disposed = true
    }
  }, [settings.downloadDir, items.length])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, viewMode)
    } catch {
      // Not critical.
    }
  }, [viewMode])

  // Close the delete dialog with Escape.
  useEffect(() => {
    if (!pendingDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDelete(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingDelete])

  const counts = useMemo(
    () => ({
      all: items.length,
      video: items.filter((i) => i.kind === 'video').length,
      audio: items.filter((i) => i.kind === 'audio').length,
    }),
    [items],
  )

  const usedBytes = useMemo(() => items.reduce((sum, i) => sum + (i.missing ? 0 : i.size_bytes), 0), [items])
  const displayedItems = useMemo(
    () => filterLibrary(items, category, searchQuery, sortBy),
    [items, category, searchQuery, sortBy],
  )

  const downloadDir = settings.downloadDir || defaultDir

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      try {
        await action()
        if (success) show(success)
      } catch (err) {
        show(errorMessage(err), 'error')
      }
    },
    [show],
  )

  const handlePlay = useCallback((item: LibraryItem) => void run(() => openMediaFile(item.file_path)), [run])
  const handleReveal = useCallback((item: LibraryItem) => void run(() => revealInExplorer(item.file_path)), [run])
  const handleDelete = useCallback((item: LibraryItem) => setPendingDelete(item), [])

  const confirmDelete = (deleteFile: boolean) => {
    const item = pendingDelete
    setPendingDelete(null)
    if (!item) return
    playHapticGlass()
    void run(
      () => removeLibraryItem(item.id, deleteFile),
      deleteFile ? `Moved to Recycle Bin: ${item.title}` : `Removed from library: ${item.title}`,
    )
  }

  const resetFilters = () => {
    playHapticClick()
    setSearchQuery('')
    setCategory('all')
  }

  const categories: { id: LibraryCategory; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'video', label: 'Video', count: counts.video },
    { id: 'audio', label: 'Audio', count: counts.audio },
  ]

  const libraryEmpty = loaded && items.length === 0

  return (
    <div className="media-library-container">
      {toast && (
        <div
          className={`hub-toast library-toast ${toast.tone === 'error' ? 'is-error' : ''}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          {toast.text}
        </div>
      )}

      <div className="media-library-content animate-fade-in">
        <div className="media-library-header">
          <h1 className="media-library-title">Media Library</h1>

          <div className="media-library-header-actions">
            <div className="library-search-card">
              <div className="library-search-icon">
                <IconSearch size={14} />
              </div>
              <input
                id="library-search-input"
                name="librarySearch"
                type="text"
                className="library-search-input"
                placeholder="Search by title, channel or site…"
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
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>

            <GlassSelect
              id="library-sort-select"
              value={sortBy}
              options={SORT_OPTIONS}
              onChange={(v) => setSortBy(v as LibrarySort)}
              ariaLabel="Sort library"
            />

            <div className="view-mode-pill">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => {
                  playHapticGlass()
                  setViewMode('grid')
                }}
                title="Grid view"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
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
                title="List view"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
              >
                <IconList size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="media-library-subnav">
          <div className="library-category-pills">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`library-cat-pill ${category === cat.id ? 'active' : ''}`}
                onClick={() => {
                  playHapticPop()
                  setCategory(cat.id)
                }}
              >
                <span>{cat.label}</span>
                <span className="cat-pill-count">{cat.count}</span>
              </button>
            ))}
          </div>

          <div className="library-storage-pill" title={downloadDir || undefined}>
            <IconHardDrive size={13} className="storage-pill-icon" />
            <span className="storage-pill-text">
              {usedBytes > 0 ? `${formatBytes(usedBytes)} in library` : 'Library empty'}
              {vitals && vitals.storageFreeGb > 0 && (
                <>
                  {' '}
                  <span className="meta-dot">·</span> {vitals.storageFreeGb.toFixed(1)} GB free
                </>
              )}
            </span>
            {downloadDir && (
              <button
                type="button"
                className="storage-pill-folder-btn"
                onClick={() => {
                  playHapticClick()
                  void run(() => revealInExplorer(downloadDir))
                }}
                title={`Open ${downloadDir}`}
              >
                <IconFolder size={11} />
                <span>Folder</span>
              </button>
            )}
          </div>
        </div>

        {!loaded ? null : displayedItems.length === 0 ? (
          <div className="library-empty-state">
            <div className="library-empty-icon-circle">
              {libraryEmpty ? <IconFilm size={26} /> : <IconSearch size={24} />}
            </div>
            <p className="empty-title">{libraryEmpty ? 'Nothing downloaded yet' : 'No matches'}</p>
            <p className="empty-sub">
              {libraryEmpty
                ? 'Finished downloads from Stream Hub show up here.'
                : searchQuery
                  ? `Nothing matches "${searchQuery}".`
                  : `No ${category} files yet.`}
            </p>
            {!libraryEmpty && (
              <button type="button" className="empty-reset-btn" onClick={resetFilters}>
                <span>Reset filters</span>
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <MediaGrid items={displayedItems} onPlay={handlePlay} onReveal={handleReveal} onDelete={handleDelete} />
        ) : (
          <MediaList items={displayedItems} onPlay={handlePlay} onReveal={handleReveal} onDelete={handleDelete} />
        )}
      </div>

      {pendingDelete &&
        (typeof document !== 'undefined'
          ? createPortal(
              <div className="library-dialog-backdrop" onClick={() => setPendingDelete(null)}>
                <div
                  className="library-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="library-dialog-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="library-dialog-icon">
                    <IconTrash size={18} />
                  </div>
                  <h2 id="library-dialog-title" className="library-dialog-title">
                    Delete “{pendingDelete.title}”?
                  </h2>
                  <p className="library-dialog-text">
                    {pendingDelete.missing
                      ? 'The file is already gone. This removes it from your library.'
                      : 'Remove it from the library only, or also move the file to the Recycle Bin.'}
                  </p>
                  <div className="library-dialog-actions">
                    <button type="button" className="library-dialog-btn" onClick={() => setPendingDelete(null)} autoFocus>
                      Cancel
                    </button>
                    <button type="button" className="library-dialog-btn" onClick={() => confirmDelete(false)}>
                      Remove from library
                    </button>
                    {!pendingDelete.missing && (
                      <button type="button" className="library-dialog-btn is-danger" onClick={() => confirmDelete(true)}>
                        Move to Recycle Bin
                      </button>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null)}
    </div>
  )
}

export default MediaLibrary
