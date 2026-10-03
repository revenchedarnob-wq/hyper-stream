import { describe, it, expect } from 'vitest'
import { formatBytes, formatDuration, formatEta, formatSpeed, hostnameOf, qualityLabel, timeAgo } from './format'

describe('format helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB')
  })

  it('formats speed only when moving', () => {
    expect(formatSpeed(0)).toBe('')
    expect(formatSpeed(2 * 1024 * 1024)).toBe('2.0 MB/s')
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('formats time left', () => {
    expect(formatEta(null)).toBe('')
    expect(formatEta(45)).toBe('45s left')
    expect(formatEta(600)).toBe('10m left')
    expect(formatEta(5000)).toBe('1h 23m left')
  })

  it('labels quality by the short side so portrait video is not "1920p"', () => {
    expect(qualityLabel(1920, 1080)).toBe('1080p')
    expect(qualityLabel(1080, 1920)).toBe('1080p')
    expect(qualityLabel(3840, 2160)).toBe('4K')
    expect(qualityLabel(2560, 1440)).toBe('1440p')
    expect(qualityLabel(1920, 1088)).toBe('1080p')
    expect(qualityLabel(3840, 2076)).toBe('4K')
    expect(qualityLabel(null, 720)).toBe('720p')
    expect(qualityLabel(160, 90)).toBe('90p')
    expect(qualityLabel(1280, null)).toBe('')
  })

  it('describes how long ago something happened', () => {
    const now = 1_000_000_000
    expect(timeAgo(now - 5_000, now)).toBe('Just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago')
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  it('extracts a readable host', () => {
    expect(hostnameOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(hostnameOf('not a url')).toBe('not a url')
  })
})
