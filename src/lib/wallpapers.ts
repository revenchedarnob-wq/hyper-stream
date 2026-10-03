export interface WallpaperOption {
  id: string
  name: string
  url: string
  frostedUrl?: string
  /** Small preview for the Settings picker (the full image is only used by the browser preview). */
  thumbUrl?: string
  theme?: 'light' | 'dark'
  isCustom?: boolean
}

export const SIMULATOR_WALLPAPERS: WallpaperOption[] = [
  {
    id: 'neon-waves',
    name: 'Neon Waves',
    url: '/wallpapers/bg-neon-waves.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-neon-waves.webp',
    frostedUrl: '/wallpapers/bg-neon-waves-frosted.webp',
    theme: 'dark',
  },
  {
    id: 'ghibli-meadow',
    name: 'Ghibli Meadow',
    url: '/wallpapers/bg-ghibli.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-ghibli.webp',
    frostedUrl: '/wallpapers/bg-ghibli-frosted.webp',
    theme: 'light',
  },
  {
    id: 'silk-loop',
    name: 'Silk Loop',
    url: '/wallpapers/bg-silk-loop.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-silk-loop.webp',
    frostedUrl: '/wallpapers/bg-silk-loop-frosted.webp',
    theme: 'light',
  },
  {
    id: 'amber-flow',
    name: 'Amber Flow',
    url: '/wallpapers/bg-amber-flow.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-amber-flow.webp',
    frostedUrl: '/wallpapers/bg-amber-flow-frosted.webp',
    theme: 'light',
  },
  {
    id: 'rose-petals',
    name: 'Rose Petals',
    url: '/wallpapers/bg-rose-petals.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-rose-petals.webp',
    frostedUrl: '/wallpapers/bg-rose-petals-frosted.webp',
    theme: 'light',
  },
  {
    id: 'prism-wave',
    name: 'Prism Wave',
    url: '/wallpapers/bg-prism-wave.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-prism-wave.webp',
    frostedUrl: '/wallpapers/bg-prism-wave-frosted.webp',
    theme: 'light',
  },
  {
    id: 'violet-discs',
    name: 'Violet Discs',
    url: '/wallpapers/bg-violet-discs.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-violet-discs.webp',
    frostedUrl: '/wallpapers/bg-violet-discs-frosted.webp',
    theme: 'light',
  },
  {
    id: 'unsplash-nocturne',
    name: 'Nocturne Horizon',
    url: '/wallpapers/bg-unsplash.jpg',
    thumbUrl: '/wallpapers/thumbs/bg-unsplash.webp',
    frostedUrl: '/wallpapers/bg-unsplash-frosted.webp',
    theme: 'dark',
  },
]

const CUSTOM_WALLPAPERS_KEY = 'hyperstream_custom_wallpapers'

export function getCustomWallpapers(): WallpaperOption[] {
  try {
    const raw = localStorage.getItem(CUSTOM_WALLPAPERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
    }
    return []
  } catch {
    return []
  }
}

export function saveCustomWallpaper(wallpaper: WallpaperOption): void {
  try {
    const existing = getCustomWallpapers()
    const filtered = existing.filter((w) => w.id !== wallpaper.id)
    localStorage.setItem(CUSTOM_WALLPAPERS_KEY, JSON.stringify([wallpaper, ...filtered]))
  } catch (err) {
    console.warn('Failed to save custom wallpaper:', err)
  }
}

export function deleteCustomWallpaper(id: string): void {
  try {
    const existing = getCustomWallpapers()
    const filtered = existing.filter((w) => w.id !== id)
    localStorage.setItem(CUSTOM_WALLPAPERS_KEY, JSON.stringify(filtered))
  } catch (err) {
    console.warn('Failed to delete custom wallpaper:', err)
  }
}

export function getAllWallpapers(): WallpaperOption[] {
  const custom = getCustomWallpapers()
  return [...SIMULATOR_WALLPAPERS, ...custom]
}

/**
 * Analyzes an image and automatically calculates its average perceived luminance.
 * If average luminance > 135 -> 'light' theme
 * Otherwise -> 'dark' theme
 */
export function analyzeImageTheme(dataUrl: string): Promise<'light' | 'dark'> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      return resolve('dark')
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve('dark')
        ctx.drawImage(img, 0, 0, 32, 32)
        const data = ctx.getImageData(0, 0, 32, 32).data
        let totalBrightness = 0
        const sampleCount = 32 * 32
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          // Relative perceptual luminance (Rec. 601 standard)
          totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b
        }
        const avg = totalBrightness / sampleCount
        resolve(avg > 135 ? 'light' : 'dark')
      } catch {
        resolve('dark')
      }
    }
    img.onerror = () => resolve('dark')
    img.src = dataUrl
  })
}

/**
 * Optimizes an uploaded user image:
 * Scales down ultra-large images to max 2560px on longest side,
 * encodes to high-quality JPEG (0.90) to fit cleanly in local storage.
 */
export function optimizeUploadedImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = () => {
      const result = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.onload = () => {
        try {
          const maxDim = 2560
          let width = img.width
          let height = img.height
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(result)
          ctx.drawImage(img, 0, 0, width, height)
          const optimized = canvas.toDataURL('image/jpeg', 0.90)
          resolve(optimized)
        } catch {
          resolve(result)
        }
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  })
}
