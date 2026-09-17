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

  if (/^https?:\/\//i.test(trimmed) || /^about:/i.test(trimmed)) {
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

export function formatDetectedStreamBadge(stream: DetectedStream): string {
  const parts: string[] = []
  if (stream.resolution) parts.push(stream.resolution)
  parts.push(stream.format)
  return parts.join(' ')
}

export function detectStreamFromUrl(url: string): DetectedStream | null {
  if (!url || url === 'about:blank') return null

  const lower = url.toLowerCase()

  if (lower.includes('.m3u8') || lower.includes('/hls/')) {
    return {
      id: `hls-${Date.now()}`,
      url,
      title: 'HLS Live Media Stream',
      format: 'HLS',
      resolution: '1080p60',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('.mpd') || lower.includes('/dash/')) {
    return {
      id: `dash-${Date.now()}`,
      url,
      title: 'DASH Adaptive Stream',
      format: 'DASH',
      resolution: '4K',
      timestamp: Date.now(),
    }
  }

  if (lower.endsWith('.mp4') || lower.includes('.mp4?')) {
    return {
      id: `mp4-${Date.now()}`,
      url,
      title: 'MP4 Media Asset',
      format: 'MP4',
      resolution: '1080p',
      timestamp: Date.now(),
    }
  }

  if (lower.endsWith('.webm') || lower.includes('.webm?')) {
    return {
      id: `webm-${Date.now()}`,
      url,
      title: 'WebM Video Stream',
      format: 'WebM',
      resolution: '1080p',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('twitch.tv')) {
    const channel = url.split('twitch.tv/')[1]?.split(/[?#/]/)[0] || 'Live'
    return {
      id: `twitch-${Date.now()}`,
      url,
      title: `${channel} Twitch Stream`,
      format: 'HLS',
      resolution: '1080p60',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('kick.com')) {
    const channel = url.split('kick.com/')[1]?.split(/[?#/]/)[0] || 'Live'
    return {
      id: `kick-${Date.now()}`,
      url,
      title: `${channel} Kick Stream`,
      format: 'HLS',
      resolution: '1080p60',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/')) {
    return {
      id: `yt-${Date.now()}`,
      url,
      title: 'YouTube Video Feed',
      format: 'DASH',
      resolution: '1440p60',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('crunchyroll.com')) {
    return {
      id: `cr-${Date.now()}`,
      url,
      title: 'Crunchyroll Anime Episode',
      format: 'HLS',
      resolution: '1080p',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('animeflix.live')) {
    return {
      id: `af-${Date.now()}`,
      url,
      title: 'AnimeFlix Anime Stream',
      format: 'HLS',
      resolution: '1080p',
      timestamp: Date.now(),
    }
  }

  if (lower.includes('soundcloud.com')) {
    return {
      id: `sc-${Date.now()}`,
      url,
      title: 'SoundCloud Audio Stream',
      format: 'MP4',
      resolution: '320kbps',
      timestamp: Date.now(),
    }
  }

  return null
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

export function calculateSiteShieldsMetrics(url: string, isEnabled = true): import('./types').ShieldsMetrics {
  if (!url || url === 'about:blank' || !isEnabled) {
    return {
      adsBlocked: 0,
      trackersBlocked: 0,
      bandwidthSavedBytes: 0,
      fingerprintingBlocked: 0,
      isEnabled,
    }
  }

  let hash = 0
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i)
    hash |= 0
  }
  const abs = Math.abs(hash)
  const isMediaOrNews = /youtube|twitch|kick|theverge|reddit|twitter|x\.com|cnn|news/i.test(url)
  const adsBlocked = isMediaOrNews ? 14 + (abs % 18) : 3 + (abs % 8)
  const trackersBlocked = isMediaOrNews ? 18 + (abs % 24) : 4 + (abs % 12)
  const fingerprintingBlocked = 2 + (abs % 5)
  const bandwidthSavedBytes = (adsBlocked * 34000) + (trackersBlocked * 48000)

  return {
    adsBlocked,
    trackersBlocked,
    bandwidthSavedBytes,
    fingerprintingBlocked,
    isEnabled,
  }
}
