/**
 * User preferences that affect downloads. Persisted in localStorage and
 * broadcast to every open view when changed.
 */

export type DefaultQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480' | 'audio'

/** 'auto': slow down while other apps use the internet. A number: MB/s for all downloads together. */
export type SpeedLimit = 'off' | 'auto' | number

export const SPEED_LIMITS_MBPS = [1, 2, 5, 10, 20, 50]

export interface AppSettings {
  /** Empty = the backend default (Videos\HyperStream). */
  downloadDir: string
  defaultQuality: DefaultQuality
  /** Prefer H.264/AAC in MP4 over newer codecs, for older players and editors. */
  preferCompatible: boolean
  maxConcurrent: number
  speedLimit: SpeedLimit
  clipboardDetect: boolean
  /** Videos sent from the browser extension start right away at the default quality. */
  extensionAutoDownload: boolean
  completionSound: boolean
  /** Built-in browser: block ads and trackers. */
  shieldsEnabled: boolean
  /** Sites (host without "www.") where Shields are off. */
  shieldsAllowedSites: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  defaultQuality: 'best',
  preferCompatible: false,
  maxConcurrent: 3,
  speedLimit: 'off',
  clipboardDetect: true,
  extensionAutoDownload: false,
  completionSound: true,
  shieldsEnabled: true,
  shieldsAllowedSites: [],
}

const STORAGE_KEY = 'hyperstream_settings_v1'
const CHANGE_EVENT = 'hyperstream:settings-changed'

const QUALITIES: DefaultQuality[] = ['best', '2160', '1440', '1080', '720', '480', 'audio']

/** Guards against hand-edited or outdated stored values. */
export function sanitize(s: AppSettings): AppSettings {
  const max = Math.round(Number(s.maxConcurrent))
  return {
    downloadDir: typeof s.downloadDir === 'string' ? s.downloadDir : '',
    defaultQuality: QUALITIES.includes(s.defaultQuality) ? s.defaultQuality : DEFAULT_SETTINGS.defaultQuality,
    preferCompatible: !!s.preferCompatible,
    maxConcurrent: Number.isFinite(max) ? Math.min(5, Math.max(1, max)) : DEFAULT_SETTINGS.maxConcurrent,
    speedLimit:
      s.speedLimit === 'auto' || (typeof s.speedLimit === 'number' && SPEED_LIMITS_MBPS.includes(s.speedLimit)) ? s.speedLimit : 'off',
    clipboardDetect: s.clipboardDetect !== false,
    extensionAutoDownload: s.extensionAutoDownload === true,
    completionSound: s.completionSound !== false,
    shieldsEnabled: s.shieldsEnabled !== false,
    shieldsAllowedSites: Array.isArray(s.shieldsAllowedSites)
      ? [...new Set(s.shieldsAllowedSites.filter((h): h is string => typeof h === 'string' && h.length > 0))]
      : [],
  }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return sanitize({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) })
    }
  } catch {
    // Corrupt or unavailable storage: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitize({ ...loadSettings(), ...patch })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: keep the in-memory value for this session.
  }
  window.dispatchEvent(new CustomEvent<AppSettings>(CHANGE_EVENT, { detail: next }))
  return next
}

export function subscribeSettings(listener: (s: AppSettings) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AppSettings>).detail)
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
