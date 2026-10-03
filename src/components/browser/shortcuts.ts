import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SpeedDialItem } from './types'
import { getSiteIcon } from '@/lib/tauri-bridge'

/* ------------------------------------------------------------------ */
/* Start-page shortcuts: one store shared by the start page and the    */
/* address bar star (Ctrl+D), persisted in localStorage.               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'hyperstream_speed_dial_custom'
const EMPTY: SpeedDialItem[] = []
const listeners = new Set<() => void>()
let cache: SpeedDialItem[] | null = null

function readStored(): SpeedDialItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    // Older builds saved a CSS variable as the accent; colours are derived from the logo now.
    return parsed.map((item: SpeedDialItem) =>
      item.accentColor?.startsWith('var(') ? { ...item, accentColor: undefined } : item,
    )
  } catch {
    return []
  }
}

export function getShortcuts(): SpeedDialItem[] {
  if (cache === null) cache = typeof window === 'undefined' ? EMPTY : readStored()
  return cache
}

export function setShortcuts(list: SpeedDialItem[]): void {
  cache = list
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable: keep the in-memory list for this session.
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useShortcuts(): SpeedDialItem[] {
  return useSyncExternalStore(subscribe, getShortcuts, () => EMPTY)
}

/* ------------------------------ URLs ------------------------------ */

export function withScheme(url: string): string {
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function hostOf(url: string): string {
  try {
    return new URL(withScheme(url)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return url.trim().toLowerCase()
  }
}

/** Same page, ignoring scheme, "www." and a trailing slash. */
function samePage(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const p = new URL(withScheme(u))
      return `${p.hostname.replace(/^www\./, '')}${p.pathname.replace(/\/$/, '')}${p.search}`.toLowerCase()
    } catch {
      return u.toLowerCase()
    }
  }
  return norm(a) === norm(b)
}

export function findShortcut(url: string): SpeedDialItem | undefined {
  return getShortcuts().find((s) => samePage(s.url, url))
}

/* --------------------------- Site names --------------------------- */

interface KnownSite {
  domains: string[]
  title: string
  iconKey: string
  accentColor: string
  category: SpeedDialItem['category']
}

const KNOWN_SITES: KnownSite[] = [
  { domains: ['youtube.com', 'youtu.be'], title: 'YouTube', iconKey: 'youtube', accentColor: '#FF0000', category: 'video' },
  { domains: ['facebook.com', 'fb.com'], title: 'Facebook', iconKey: 'facebook', accentColor: '#1877F2', category: 'social' },
  { domains: ['instagram.com'], title: 'Instagram', iconKey: 'instagram', accentColor: '#E1306C', category: 'social' },
  { domains: ['crunchyroll.com'], title: 'Crunchyroll', iconKey: 'crunchyroll', accentColor: '#F47521', category: 'anime' },
  { domains: ['x.com', 'twitter.com'], title: 'X', iconKey: 'x', accentColor: '#E7E9EA', category: 'social' },
  { domains: ['netflix.com'], title: 'Netflix', iconKey: 'netflix', accentColor: '#E50914', category: 'video' },
  { domains: ['twitch.tv'], title: 'Twitch', iconKey: 'twitch', accentColor: '#9146FF', category: 'streaming' },
  { domains: ['kick.com'], title: 'Kick', iconKey: 'kick', accentColor: '#53FC18', category: 'streaming' },
  { domains: ['vimeo.com'], title: 'Vimeo', iconKey: 'vimeo', accentColor: '#1AB7EA', category: 'video' },
  { domains: ['dailymotion.com'], title: 'Dailymotion', iconKey: 'dailymotion', accentColor: '#0066DC', category: 'video' },
  { domains: ['soundcloud.com'], title: 'SoundCloud', iconKey: 'soundcloud', accentColor: '#FF5500', category: 'music' },
  { domains: ['bilibili.com', 'bilibili.tv'], title: 'Bilibili', iconKey: 'bilibili', accentColor: '#00A1D6', category: 'video' },
  { domains: ['reddit.com'], title: 'Reddit', iconKey: 'reddit', accentColor: '#FF4500', category: 'social' },
  { domains: ['github.com'], title: 'GitHub', iconKey: 'github', accentColor: '#8B949E', category: 'custom' },
  { domains: ['spotify.com'], title: 'Spotify', iconKey: 'spotify', accentColor: '#1DB954', category: 'music' },
  { domains: ['tiktok.com'], title: 'TikTok', iconKey: 'tiktok', accentColor: '#25F4EE', category: 'social' },
  { domains: ['ycombinator.com'], title: 'Hacker News', iconKey: 'custom', accentColor: '#FF6600', category: 'custom' },
]

/** Second-level labels used under a country code ("bbc.co.uk", "prothomalo.com.bd"). */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go'])

/** "news.ycombinator.com" → "Ycombinator", "bbc.co.uk" → "Bbc". */
export function siteName(host: string): string {
  const labels = host.replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length === 0) return ''
  let i = Math.max(0, labels.length - 2)
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[i])) i -= 1
  const name = labels[i]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function detectSite(
  inputUrl: string,
): { title: string; iconKey: string; accentColor?: string; category: SpeedDialItem['category'] } | null {
  if (!inputUrl.trim()) return null
  const host = hostOf(inputUrl)
  const known = KNOWN_SITES.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`)))
  if (known) return { title: known.title, iconKey: known.iconKey, accentColor: known.accentColor, category: known.category }
  if (!host.includes('.') || /\s/.test(host)) return null
  const title = siteName(host)
  return title.length > 1 ? { title, iconKey: 'custom', category: 'custom' } : null
}

/** Tile-friendly name for a page: the site's name, or a short page title for deeper pages. */
export function shortcutTitle(url: string, pageTitle?: string): string {
  const site = detectSite(url)?.title ?? hostOf(url)
  let path = '/'
  try {
    path = new URL(withScheme(url)).pathname
  } catch {
    // keep "/"
  }
  const title = (pageTitle ?? '').trim()
  if (path === '/' || !title) return site
  // "Video name - YouTube" → "Video name"
  const cleaned = title.split(/\s[-|–·]\s/)[0].trim()
  return cleaned.length > 40 ? `${cleaned.slice(0, 38).trim()}…` : cleaned || site
}

/** Translucent version of any CSS colour (hex, rgb or a variable). */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/* ------------------------------ Logos ------------------------------ */

export interface SiteLogo {
  src: string
  /** Most characteristic colour of the logo, for the tile glow. */
  accent?: string
  /** Logo is a full square image (app-icon style) rather than a mark on transparency. */
  fullBleed: boolean
}

const logoCache = new Map<string, Promise<SiteLogo | null>>()

function analyse(src: string): Promise<SiteLogo> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const n = 24
        const canvas = document.createElement('canvas')
        canvas.width = n
        canvas.height = n
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve({ src, fullBleed: false })
        ctx.drawImage(img, 0, 0, n, n)
        const { data } = ctx.getImageData(0, 0, n, n)
        const alphaAt = (x: number, y: number) => data[(y * n + x) * 4 + 3]
        const fullBleed = [alphaAt(1, 1), alphaAt(n - 2, 1), alphaAt(1, n - 2), alphaAt(n - 2, n - 2)].every((a) => a > 240)

        // Average the most saturated visible pixels; grey logos get no accent.
        let r = 0
        let g = 0
        let b = 0
        let weight = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 160) continue
          const max = Math.max(data[i], data[i + 1], data[i + 2])
          const min = Math.min(data[i], data[i + 1], data[i + 2])
          const sat = max === 0 ? 0 : (max - min) / max
          if (sat < 0.25 || max < 50) continue
          const w = sat * sat
          r += data[i] * w
          g += data[i + 1] * w
          b += data[i + 2] * w
          weight += w
        }
        const hex = (v: number) => Math.round(v / weight).toString(16).padStart(2, '0')
        resolve({ src, fullBleed, accent: weight > 2 ? `#${hex(r)}${hex(g)}${hex(b)}` : undefined })
      } catch {
        resolve({ src, fullBleed: false })
      }
    }
    img.onerror = () => resolve({ src, fullBleed: false })
    img.src = src
  })
}

export function loadSiteLogo(url: string): Promise<SiteLogo | null> {
  const host = hostOf(url)
  if (!host.includes('.')) return Promise.resolve(null)
  let pending = logoCache.get(host)
  if (!pending) {
    pending = getSiteIcon(withScheme(url)).then((src) => {
      // No logo yet: ask again next time (visiting the site in the browser may supply one).
      if (!src) logoCache.delete(host)
      return src ? analyse(src) : null
    })
    logoCache.set(host, pending)
  }
  return pending
}

/** The site's real logo once it has loaded; null while loading, offline, or when the site has none. */
export function useSiteLogo(url: string | null | undefined): SiteLogo | null {
  const host = url ? hostOf(url) : ''
  const [state, setState] = useState<{ host: string; logo: SiteLogo | null }>({ host: '', logo: null })
  useEffect(() => {
    if (!url || !host.includes('.')) return
    let alive = true
    void loadSiteLogo(url).then((logo) => {
      if (alive) setState({ host, logo })
    })
    return () => {
      alive = false
    }
  }, [url, host])
  return state.host === host ? state.logo : null
}

/** `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}
