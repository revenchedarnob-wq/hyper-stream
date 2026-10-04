import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, sanitize, type AppSettings } from './settings'

describe('settings sanitize', () => {
  it('keeps valid settings as they are', () => {
    const s: AppSettings = { ...DEFAULT_SETTINGS, downloadDir: 'D:\\Media', defaultQuality: '720', maxConcurrent: 5 }
    expect(sanitize(s)).toEqual(s)
  })

  it('repairs out-of-range or corrupt values', () => {
    const broken = {
      downloadDir: 42,
      defaultQuality: '8k',
      preferCompatible: 'yes',
      maxConcurrent: 99,
      clipboardDetect: undefined,
      completionSound: false,
      shieldsAllowedSites: ['youtube.com', 7, 'youtube.com'],
    } as unknown as AppSettings
    expect(sanitize(broken)).toEqual({
      downloadDir: '',
      defaultQuality: 'best',
      preferCompatible: true,
      maxConcurrent: 5,
      clipboardDetect: true,
      extensionAutoDownload: false,
      completionSound: false,
      shieldsEnabled: true,
      shieldsAllowedSites: ['youtube.com'],
    })
    expect(sanitize({ ...DEFAULT_SETTINGS, maxConcurrent: 0 }).maxConcurrent).toBe(1)
    expect(sanitize({ ...DEFAULT_SETTINGS, maxConcurrent: Number.NaN }).maxConcurrent).toBe(3)
  })
})
