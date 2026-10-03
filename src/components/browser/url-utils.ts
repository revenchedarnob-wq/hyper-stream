import type { DetectedStream } from './types'
import { playHapticClick } from '@/lib/sound'

const DOMAIN_PATTERN = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/?#].*)?$/
const LOCALHOST_PATTERN = /^localhost(:\d+)?([/?#].*)?$/i
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?([/?#].*)?$/

export function resolveBrowserNavigation(queryOrUrl: string): { url: string; isSearch: boolean; searchEngine: string } {
  const trimmed = queryOrUrl.trim()
  if (!trimmed) {
    return { url: 'about:blank', isSearch: false, searchEngine: 'brave' }
  }

  if (/^(https?|chrome-extension):\/\//i.test(trimmed) || /^about:/i.test(trimmed)) {
    return { url: trimmed, isSearch: false, searchEngine: 'brave' }
  }

  if (LOCALHOST_PATTERN.test(trimmed) || IP_PATTERN.test(trimmed)) {
    return { url: `http://${trimmed}`, isSearch: false, searchEngine: 'brave' }
  }

  if (DOMAIN_PATTERN.test(trimmed) && !trimmed.includes(' ')) {
    return { url: `https://${trimmed}`, isSearch: false, searchEngine: 'brave' }
  }

  const encodedQuery = encodeURIComponent(trimmed).replace(/%20/g, '+')
  return {
    url: `https://search.brave.com/search?q=${encodedQuery}`,
    isSearch: true,
    searchEngine: 'brave'
  }
}

/** Host without "www.", used to remember per-site choices. Empty for non-web addresses. */
export function siteKey(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return parsed.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export interface ExtensionStoreListing {
  store: 'chrome' | 'edge'
  id: string
}

const EXTENSION_ID = /^[a-p]{32}$/

/** A Chrome Web Store or Edge Add-ons page for one extension. */
export function extensionStoreListing(url: string): ExtensionStoreListing | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const store =
    host === 'chromewebstore.google.com' || host === 'chrome.google.com'
      ? 'chrome'
      : host === 'microsoftedge.microsoft.com'
        ? 'edge'
        : null
  if (!store || !/\/detail\//.test(parsed.pathname)) return null
  const id = parsed.pathname.split('/').find((segment) => EXTENSION_ID.test(segment))
  return id ? { store, id } : null
}

export function formatDetectedStreamBadge(stream: DetectedStream): string {
  return stream.format
}

interface VideoPagePattern {
  site: string
  test: (host: string, path: string) => boolean
  live?: boolean
}

// Pages that hold a single video or track. The Hub probes the link, so this only decides when to offer Download.
const VIDEO_PAGES: VideoPagePattern[] = [
  { site: 'YouTube', test: (h, p) => /(^|\.)youtube\.com$/.test(h) && /^\/(watch|shorts\/|live\/|playlist)/.test(p) },
  { site: 'YouTube', test: (h, p) => h === 'youtu.be' && p.length > 1 },
  { site: 'Twitch', test: (h, p) => /(^|\.)twitch\.tv$/.test(h) && /^\/(videos\/\d+|[^/]+\/clip\/|[a-z0-9_]{3,}\/?$)/i.test(p) && !/^\/(directory|search|settings|downloads|p)\b/.test(p), live: true },
  { site: 'Kick', test: (h, p) => /(^|\.)kick\.com$/.test(h) && /^\/[a-z0-9_-]{3,}(\/videos\/[^/]+|\/clips\/[^/]+)?\/?$/i.test(p) && !/^\/(categories|browse|search)\b/.test(p), live: true },
  { site: 'Vimeo', test: (h, p) => /(^|\.)vimeo\.com$/.test(h) && /\/\d{5,}/.test(p) },
  { site: 'Dailymotion', test: (h, p) => /(^|\.)dailymotion\.com$/.test(h) && p.startsWith('/video/') },
  { site: 'SoundCloud', test: (h, p) => /(^|\.)soundcloud\.com$/.test(h) && /^\/[^/]+\/[^/]+/.test(p) && !/^\/(discover|search|you)\b/.test(p) },
  { site: 'TikTok', test: (h, p) => /(^|\.)tiktok\.com$/.test(h) && /\/video\/\d+/.test(p) },
  { site: 'Instagram', test: (h, p) => /(^|\.)instagram\.com$/.test(h) && /^\/(reels?|p|tv)\/[^/]+/.test(p) },
  { site: 'X', test: (h, p) => /(^|\.)(x|twitter)\.com$/.test(h) && /\/status\/\d+/.test(p) },
  { site: 'Facebook', test: (h, p) => /(^|\.)facebook\.com$/.test(h) && /(\/videos\/|\/watch|\/reel\/)/.test(p) },
  { site: 'Reddit', test: (h, p) => /(^|\.)reddit\.com$/.test(h) && /\/comments\//.test(p) },
  { site: 'Bilibili', test: (h, p) => /(^|\.)bilibili\.com$/.test(h) && p.startsWith('/video/') },
]

const DIRECT_MEDIA = /\.(m3u8|mpd|mp4|webm|mkv|mov|mp3|m4a|ogg|opus|flac|wav)(\?|#|$)/i

export function detectStreamFromUrl(url: string): DetectedStream | null {
  if (!url || url === 'about:blank') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.replace(/^www\.|^m\./, '').toLowerCase()
  const path = parsed.pathname

  const direct = path.match(DIRECT_MEDIA)
  if (direct) {
    const ext = direct[1].toUpperCase()
    const format = ext === 'M3U8' ? 'HLS' : ext === 'MPD' ? 'DASH' : ext
    return { id: `media-${url}`, url, title: format, format, timestamp: Date.now() }
  }

  const match = VIDEO_PAGES.find((pattern) => pattern.test(host, path))
  if (!match) return null
  return { id: `page-${url}`, url, title: match.site, format: match.site, live: match.live, timestamp: Date.now() }
}

export function handleBrowserSubmit(
  query: string,
  onNavigate: (url: string) => void
): { url: string; isSearch: boolean; searchEngine: string } {
  const trimmed = query.trim()
  if (!trimmed) {
    return { url: 'about:blank', isSearch: false, searchEngine: 'brave' }
  }
  const resolved = resolveBrowserNavigation(trimmed)
  playHapticClick()
  onNavigate(resolved.url)
  return resolved
}

export interface BrowserHistoryState {
  historyStack: string[]
  historyIndex: number
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * Pure state manager for browser navigation history.
 * Coordinates stack push, back, forward, home, and history truncation.
 */
export function createBrowserHistory(initialUrl = 'about:blank') {
  let stack = [initialUrl || 'about:blank']
  let index = 0

  const getState = (): BrowserHistoryState => ({
    historyStack: [...stack],
    historyIndex: index,
    currentUrl: stack[index] || 'about:blank',
    canGoBack: index > 0,
    canGoForward: index < stack.length - 1,
  })

  const navigate = (url: string) => {
    const target = url.trim() || 'about:blank'
    if (target === stack[index]) return getState()
    stack = stack.slice(0, index + 1)
    stack.push(target)
    index = stack.length - 1
    return getState()
  }

  const goBack = () => {
    if (index > 0) {
      index -= 1
    }
    return getState()
  }

  const goForward = () => {
    if (index < stack.length - 1) {
      index += 1
    }
    return getState()
  }

  const goHome = () => {
    return navigate('about:blank')
  }

  return {
    getState,
    navigate,
    goBack,
    goForward,
    goHome,
  }
}

export interface EmbedResolution {
  embedUrl: string
  isEmbeddable: boolean
  type: 'youtube' | 'twitch' | 'video' | 'iframe'
}

export function resolveWebEmbedUrl(url: string): EmbedResolution {
  if (!url || url === 'about:blank') {
    return { embedUrl: 'about:blank', isEmbeddable: true, type: 'iframe' }
  }

  const lower = url.toLowerCase()

  // 1. YouTube
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    let videoId = ''
    if (url.includes('v=')) {
      videoId = url.split('v=')[1]?.split('&')[0] || ''
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split(/[?#]/)[0] || ''
    } else if (url.includes('embed/')) {
      videoId = url.split('embed/')[1]?.split(/[?#]/)[0] || ''
    }

    const embed = videoId
      ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&modestbranding=1&rel=0`
      : 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&modestbranding=1&rel=0'
    return { embedUrl: embed, isEmbeddable: true, type: 'youtube' }
  }

  // 2. Twitch
  if (lower.includes('twitch.tv')) {
    const channel = url.split('twitch.tv/')[1]?.split(/[?#/]/)[0]
    const parentHost =
      typeof window !== 'undefined' && window.location ? window.location.hostname || 'localhost' : 'localhost'
    return {
      embedUrl: `https://player.twitch.tv/?channel=${channel || 'shroud'}&parent=${parentHost}&muted=false`,
      isEmbeddable: true,
      type: 'twitch',
    }
  }

  // 3. Direct video
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.includes('.mp4?') ||
    lower.includes('.webm?')
  ) {
    return { embedUrl: url, isEmbeddable: true, type: 'video' }
  }

  return { embedUrl: url, isEmbeddable: false, type: 'iframe' }
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed || trimmed === 'about:blank') return 'about:blank'
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    let pathname = parsed.pathname
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1)
    }
    return `${parsed.protocol}//${host}${pathname === '/' ? '' : pathname}${parsed.search}${parsed.hash}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function isSameUrl(urlA: string, urlB: string): boolean {
  if (urlA === urlB) return true
  const normA = normalizeUrl(urlA)
  const normB = normalizeUrl(urlB)
  if (normA === normB) return true
  try {
    const a = new URL(normA)
    const b = new URL(normB)
    return a.origin === b.origin && (a.pathname === b.pathname || (a.pathname === '' && b.pathname === '/'))
  } catch {
    return false
  }
}
