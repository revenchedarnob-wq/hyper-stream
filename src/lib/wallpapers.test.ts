import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SIMULATOR_WALLPAPERS,
  getAllWallpapers,
  saveCustomWallpaper,
  deleteCustomWallpaper,
  getCustomWallpapers,
  analyzeImageTheme,
  type WallpaperOption,
} from './wallpapers'

const mockStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key]
    }
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('wallpapers module', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.restoreAllMocks()
  })

  it('contains exactly 8 unique built-in wallpapers with no duplicates', () => {
    const ids = SIMULATOR_WALLPAPERS.map((w) => w.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(8)
    expect(uniqueIds.size).toBe(8)

    // Specifically verify coral-dusk duplicate is removed
    expect(ids).not.toContain('coral-dusk')
    expect(ids).toContain('rose-petals')
  })

  it('saves and retrieves custom wallpapers from localStorage', () => {
    expect(getCustomWallpapers()).toEqual([])
    expect(getAllWallpapers().length).toBe(8)

    const custom: WallpaperOption = {
      id: 'custom-12345',
      name: 'Aurora Borealis',
      url: 'data:image/jpeg;base64,mockdata',
      theme: 'dark',
      isCustom: true,
    }

    saveCustomWallpaper(custom)

    const stored = getCustomWallpapers()
    expect(stored.length).toBe(1)
    expect(stored[0].name).toBe('Aurora Borealis')
    expect(stored[0].isCustom).toBe(true)

    const all = getAllWallpapers()
    expect(all.length).toBe(9)
    expect(all.some((w) => w.id === 'custom-12345')).toBe(true)
  })

  it('deletes custom wallpapers cleanly', () => {
    const custom: WallpaperOption = {
      id: 'custom-to-delete',
      name: 'Temporary BG',
      url: 'data:image/jpeg;base64,mockdata2',
      theme: 'light',
      isCustom: true,
    }

    saveCustomWallpaper(custom)
    expect(getCustomWallpapers().length).toBe(1)

    deleteCustomWallpaper('custom-to-delete')
    expect(getCustomWallpapers().length).toBe(0)
    expect(getAllWallpapers().length).toBe(8)
  })

  it('correctly defaults theme analysis safely in non-browser or test environments', async () => {
    const theme = await analyzeImageTheme('data:image/png;base64,test')
    expect(['light', 'dark']).toContain(theme)
  })
})
