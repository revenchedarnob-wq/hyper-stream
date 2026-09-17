import { describe, it, expect } from 'vitest'
import {
  BLOCKED_TRACKER_DOMAINS,
  SHIELDS_COSMETIC_CSS,
  SHIELDS_INJECTION_SCRIPT,
} from './shields-engine'
import { calculateSiteShieldsMetrics } from './url-utils'

describe('Brave Shields Engine & Ruleset', () => {
  it('contains essential high-profile tracker and telemetry domains from EasyPrivacy', () => {
    expect(BLOCKED_TRACKER_DOMAINS).toContain('google-analytics.com')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('doubleclick.net')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('facebook.net')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('taboola.com')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('outbrain.com')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('criteo.com')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('hotjar.com')
    expect(BLOCKED_TRACKER_DOMAINS).toContain('segment.io')
    expect(BLOCKED_TRACKER_DOMAINS.length).toBeGreaterThan(50)
  })

  it('provides zero-latency GPU-accelerated cosmetic ad-hiding CSS without hiding video elements', () => {
    expect(SHIELDS_COSMETIC_CSS).toContain('ins.adsbygoogle')
    expect(SHIELDS_COSMETIC_CSS).toContain('.ytp-ad-overlay-container')
    expect(SHIELDS_COSMETIC_CSS).toContain('ytd-ad-slot-renderer')
    expect(SHIELDS_COSMETIC_CSS).toContain('taboola')
    expect(SHIELDS_COSMETIC_CSS).toContain('display: none !important')
    // Ensure video elements are NEVER hidden so the player screen is never blacked out
    expect(SHIELDS_COSMETIC_CSS).not.toContain('.video-ads')
    expect(SHIELDS_COSMETIC_CSS).not.toContain('.ad-showing video')
  })

  it('compiles minified injection script with global hooks and bridge controls', () => {
    expect(SHIELDS_INJECTION_SCRIPT).toContain('__HYPERSTREAM_SET_SHIELDS__')
    expect(SHIELDS_INJECTION_SCRIPT).toContain('__HYPERSTREAM_GET_SHIELDS_METRICS__')
    expect(SHIELDS_INJECTION_SCRIPT).toContain('window.fetch')
    expect(SHIELDS_INJECTION_SCRIPT).toContain('XMLHttpRequest')
  })

  it('calculates dynamic site-specific shields metrics', () => {
    // Blank page has 0 blocked
    const blank = calculateSiteShieldsMetrics('about:blank', true)
    expect(blank.adsBlocked).toBe(0)
    expect(blank.trackersBlocked).toBe(0)
    expect(blank.bandwidthSavedBytes).toBe(0)
    expect(blank.isEnabled).toBe(true)

    // Disabled state has 0 blocked
    const disabled = calculateSiteShieldsMetrics('https://youtube.com', false)
    expect(disabled.adsBlocked).toBe(0)
    expect(disabled.trackersBlocked).toBe(0)
    expect(disabled.isEnabled).toBe(false)

    // Active web domain has realistic calculated blocked items and bandwidth saved
    const active = calculateSiteShieldsMetrics('https://youtube.com', true)
    expect(active.adsBlocked).toBeGreaterThan(0)
    expect(active.trackersBlocked).toBeGreaterThan(0)
    expect(active.bandwidthSavedBytes).toBeGreaterThan(0)
    expect(active.isEnabled).toBe(true)
  })
})
