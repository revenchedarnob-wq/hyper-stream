import { describe, it, expect } from 'vitest'
import { isValidStreamUrl, normalizeStreamUrl } from './validation'

describe('normalizeStreamUrl', () => {
  it('keeps full links', () => {
    expect(normalizeStreamUrl(' https://www.youtube.com/watch?v=abc ')).toBe('https://www.youtube.com/watch?v=abc')
  })

  it('adds https to bare addresses', () => {
    expect(normalizeStreamUrl('youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(normalizeStreamUrl('vimeo.com/123')).toBe('https://vimeo.com/123')
  })

  it('rejects text, other schemes and hostless input', () => {
    expect(normalizeStreamUrl('hello world')).toBeNull()
    expect(normalizeStreamUrl('cats')).toBeNull()
    expect(normalizeStreamUrl('magnet:?xt=urn:btih:abc')).toBeNull()
    expect(normalizeStreamUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeStreamUrl('')).toBeNull()
    expect(isValidStreamUrl('ftp://x.com/a')).toBe(false)
  })
})
