/** Display formatting shared by the Hub and the Library. */

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatSpeed(bytesPerSec?: number | null): string {
  if (!bytesPerSec || bytesPerSec <= 0) return ''
  return `${formatBytes(bytesPerSec)}/s`
}

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 45 -> "45s left", 600 -> "10m left", 5000 -> "1h 23m left" */
export function formatEta(seconds?: number | null): string {
  if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m left`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
}

export function timeAgo(timestampMs?: number | null, now = Date.now()): string {
  if (!timestampMs) return ''
  const diff = Math.max(0, now - timestampMs) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestampMs).toLocaleDateString()
}

const QUALITY_TIERS: [number, string][] = [
  [4320, '8K'],
  [2160, '4K'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p'],
  [480, '480p'],
  [360, '360p'],
  [240, '240p'],
  [144, '144p'],
]

/**
 * "1080p" from dimensions. Uses the short side so portrait 1080x1920 reads as 1080p,
 * and snaps near-standard sizes (1920x1088, 3840x2076) to the usual name.
 */
export function qualityLabel(width?: number | null, height?: number | null): string {
  if (!height) return ''
  const short = width ? Math.min(width, height) : height
  for (const [tier, label] of QUALITY_TIERS) {
    if (short >= tier * 0.93) return label
  }
  return `${short}p`
}

let languageNames: Intl.DisplayNames | null = null

/** "ja" -> "Japanese", "en-US" -> "American English"; falls back to the code. */
export function languageName(code: string): string {
  try {
    languageNames ??= new Intl.DisplayNames(undefined, { type: 'language' })
    return languageNames.of(code) || code
  } catch {
    return code
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
