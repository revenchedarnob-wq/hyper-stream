import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { detectSite, siteName, shortcutTitle, tint } from './shortcuts'

describe('site detection', () => {
  it('matches brands by domain, not by substring', () => {
    expect(detectSite('kick.com')?.title).toBe('Kick')
    expect(detectSite('kickstarter.com')?.title).toBe('Kickstarter')
    expect(detectSite('m.youtube.com/watch?v=1')?.title).toBe('YouTube')
    expect(detectSite('twitter.com')?.title).toBe('X')
  })

  it('names unknown sites after their registrable domain', () => {
    expect(siteName('news.ycombinator.com')).toBe('Ycombinator')
    expect(siteName('www.bbc.co.uk')).toBe('Bbc')
    expect(siteName('blog.example.org')).toBe('Example')
    expect(detectSite('news.ycombinator.com')?.title).toBe('Hacker News')
  })

  it('rejects input that is not an address', () => {
    expect(detectSite('')).toBeNull()
    expect(detectSite('hello')).toBeNull()
  })

  it('unknown sites carry no accent so the logo colour can be used', () => {
    expect(detectSite('example.com')?.accentColor).toBeUndefined()
  })
})

describe('shortcutTitle', () => {
  it('uses the site name for home pages and a short page title for deeper pages', () => {
    expect(shortcutTitle('https://www.youtube.com/', 'YouTube')).toBe('YouTube')
    expect(shortcutTitle('https://www.youtube.com/watch?v=1', 'Lo-fi beats - YouTube')).toBe('Lo-fi beats')
    expect(shortcutTitle('https://example.com/a', '')).toBe('Example')
  })
})

describe('tint', () => {
  it('works with hex colours and CSS variables alike', () => {
    expect(tint('#ff0000', 10)).toBe('color-mix(in srgb, #ff0000 10%, transparent)')
    expect(tint('var(--x, #fff)', 20)).toContain('var(--x, #fff) 20%')
  })
})

describe('shortcut store', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    })
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops accents saved as CSS variables by older builds', async () => {
    localStorage.setItem(
      'hyperstream_speed_dial_custom',
      JSON.stringify([{ id: 'a', title: 'A', url: 'https://a.com', category: 'custom', iconKey: 'custom', accentColor: 'var(--c)' }]),
    )
    const { getShortcuts } = await import('./shortcuts')
    expect(getShortcuts()[0].accentColor).toBeUndefined()
  })

  it('finds a saved page regardless of scheme, www and trailing slash', async () => {
    const { setShortcuts, findShortcut } = await import('./shortcuts')
    setShortcuts([{ id: 'y', title: 'YouTube', url: 'https://youtube.com', category: 'video', iconKey: 'youtube' }])
    expect(findShortcut('http://www.youtube.com/')?.id).toBe('y')
    expect(findShortcut('https://youtube.com/watch?v=1')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('hyperstream_speed_dial_custom') ?? '[]')).toHaveLength(1)
  })
})
