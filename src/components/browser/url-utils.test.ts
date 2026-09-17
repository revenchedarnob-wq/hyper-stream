import { describe, it, expect } from 'vitest'
import {
  resolveBrowserNavigation,
  formatDetectedStreamBadge,
  resolveWebEmbedUrl,
  normalizeUrl,
  isSameUrl,
} from './url-utils'
import type { DetectedStream } from './types'

describe('url-utils', () => {
  it('detects full http and https urls', () => {
    const res = resolveBrowserNavigation('https://twitch.tv')
    expect(res.isSearch).toBe(false)
    expect(res.url).toBe('https://twitch.tv')
    expect(res.searchEngine).toBe('brave')

    const httpRes = resolveBrowserNavigation('http://example.com')
    expect(httpRes.isSearch).toBe(false)
    expect(httpRes.url).toBe('http://example.com')
  })

  it('handles about: protocol urls', () => {
    const res = resolveBrowserNavigation('about:blank')
    expect(res.isSearch).toBe(false)
    expect(res.url).toBe('about:blank')
  })

  it('prepends https to standard domain names without protocol', () => {
    const res = resolveBrowserNavigation('youtube.com/watch?v=123')
    expect(res.isSearch).toBe(false)
    expect(res.url).toBe('https://youtube.com/watch?v=123')

    const simpleDomain = resolveBrowserNavigation('twitch.tv')
    expect(simpleDomain.isSearch).toBe(false)
    expect(simpleDomain.url).toBe('https://twitch.tv')
  })

  it('detects localhost and ip addresses with ports', () => {
    const res = resolveBrowserNavigation('localhost:3000')
    expect(res.isSearch).toBe(false)
    expect(res.url).toBe('http://localhost:3000')

    const ipRes = resolveBrowserNavigation('192.168.1.1:8080')
    expect(ipRes.isSearch).toBe(false)
    expect(ipRes.url).toBe('http://192.168.1.1:8080')

    const bareIpRes = resolveBrowserNavigation('127.0.0.1')
    expect(bareIpRes.isSearch).toBe(false)
    expect(bareIpRes.url).toBe('http://127.0.0.1')
  })

  it('routes search queries to privacy-respecting Brave Search', () => {
    const res = resolveBrowserNavigation('frieren anime live stream')
    expect(res.isSearch).toBe(true)
    expect(res.searchEngine).toBe('brave')
    expect(res.url).toContain('https://search.brave.com/search?q=')
    expect(res.url).toContain('frieren+anime+live+stream')
  })

  it('handles empty string by returning about:blank', () => {
    const res = resolveBrowserNavigation('   ')
    expect(res.isSearch).toBe(false)
    expect(res.url).toBe('about:blank')
    expect(res.searchEngine).toBe('brave')
  })

  it('formats detected stream badges cleanly', () => {
    const streamWithRes: DetectedStream = {
      id: 'stream-1',
      url: 'https://video.example/master.m3u8',
      title: 'Anime Livestream',
      format: 'HLS',
      resolution: '1080p60',
      timestamp: Date.now()
    }
    expect(formatDetectedStreamBadge(streamWithRes)).toBe('1080p60 HLS')

    const streamWithoutRes: DetectedStream = {
      id: 'stream-2',
      url: 'https://video.example/stream.mpd',
      title: 'DASH Stream',
      format: 'DASH',
      timestamp: Date.now()
    }
    expect(formatDetectedStreamBadge(streamWithoutRes)).toBe('DASH')
  })

  it('resolves YouTube URLs to embed player', () => {
    const ytWatch = resolveWebEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(ytWatch.type).toBe('youtube')
    expect(ytWatch.isEmbeddable).toBe(true)
    expect(ytWatch.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')

    const ytHome = resolveWebEmbedUrl('https://youtube.com')
    expect(ytHome.type).toBe('youtube')
    expect(ytHome.isEmbeddable).toBe(true)
  })

  it('resolves Twitch URLs to player embed', () => {
    const twitchRes = resolveWebEmbedUrl('https://www.twitch.tv/shroud')
    expect(twitchRes.type).toBe('twitch')
    expect(twitchRes.isEmbeddable).toBe(true)
    expect(twitchRes.embedUrl).toContain('player.twitch.tv/?channel=shroud')
  })

  it('resolves direct video URLs', () => {
    const videoRes = resolveWebEmbedUrl('https://example.com/stream.mp4')
    expect(videoRes.type).toBe('video')
    expect(videoRes.isEmbeddable).toBe(true)
    expect(videoRes.embedUrl).toBe('https://example.com/stream.mp4')
  })

  it('normalizes URLs correctly ignoring www and trailing slashes', () => {
    expect(normalizeUrl('https://youtube.com')).toBe('https://youtube.com')
    expect(normalizeUrl('https://www.youtube.com/')).toBe('https://youtube.com')
    expect(normalizeUrl('https://www.youtube.com/feed/explore')).toBe('https://youtube.com/feed/explore')
    expect(normalizeUrl('about:blank')).toBe('about:blank')
  })

  it('identifies identical URLs across canonical redirects and protocols', () => {
    expect(isSameUrl('https://youtube.com', 'https://www.youtube.com/')).toBe(true)
    expect(isSameUrl('https://twitch.tv/', 'https://twitch.tv')).toBe(true)
    expect(isSameUrl('https://www.youtube.com/', 'https://www.youtube.com/watch?v=123')).toBe(false)
  })
})

