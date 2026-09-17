import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import {
  IconBraveLion,
  IconBraveShield,
  IconCompass,
  IconArrowLeft,
  IconArrowRight,
  IconReload,
  IconHome,
  IconLock,
  IconBolt,
  IconScissors,
  IconDownloadCloud,
  IconX,
} from './Icons'
import { BraveShieldsPopover } from './BraveShieldsPopover'
import { StreamDetectorPill } from './StreamDetectorPill'
import type { DetectedStream, ShieldsMetrics } from './types'

describe('Browser Vector Icons', () => {
  it('renders all icons with clean SVGs and currentColor without emojis', () => {
    const icons = [
      { component: IconBraveLion, name: 'IconBraveLion' },
      { component: IconBraveShield, name: 'IconBraveShield' },
      { component: IconCompass, name: 'IconCompass' },
      { component: IconArrowLeft, name: 'IconArrowLeft' },
      { component: IconArrowRight, name: 'IconArrowRight' },
      { component: IconReload, name: 'IconReload' },
      { component: IconHome, name: 'IconHome' },
      { component: IconLock, name: 'IconLock' },
      { component: IconBolt, name: 'IconBolt' },
      { component: IconScissors, name: 'IconScissors' },
      { component: IconDownloadCloud, name: 'IconDownloadCloud' },
      { component: IconX, name: 'IconX' },
    ]

    for (const { component: Icon, name } of icons) {
      const html = renderToString(<Icon size={24} className="custom-icon" />)
      expect(html, `${name} should render an svg`).toContain('<svg')
      expect(html, `${name} should have viewBox`).toContain('viewBox="0 0 24 24"')
      expect(html, `${name} should use currentColor`).toMatch(/(stroke|fill)="currentColor"/)
      expect(html, `${name} should apply size width`).toContain('width="24"')
      expect(html, `${name} should apply size height`).toContain('height="24"')
      expect(html, `${name} should apply className`).toContain('class="custom-icon"')
    }
  })

  it('verifies IconBraveLion renders authentic official Brave Lion vector path', () => {
    const html = renderToString(<IconBraveLion />)
    expect(html).toContain('M15.68 0l2.096 2.38')
  })

  it('verifies IconBraveShield renders shield with checkmark core', () => {
    const html = renderToString(<IconBraveShield />)
    expect(html).toContain('polyline points="9 12 11 14 15 9.5"')
  })
})

describe('BraveShieldsPopover', () => {
  const mockStatsUp: ShieldsMetrics = {
    adsBlocked: 142,
    trackersBlocked: 88,
    bandwidthSavedBytes: 15728640, // 15.0 MB
    fingerprintingBlocked: 14,
    isEnabled: true,
  }

  const mockStatsDown: ShieldsMetrics = {
    adsBlocked: 0,
    trackersBlocked: 0,
    bandwidthSavedBytes: 0,
    fingerprintingBlocked: 0,
    isEnabled: false,
  }

  it('renders shields up status and calculated telemetry metrics', () => {
    const html = renderToString(
      <BraveShieldsPopover
        stats={mockStatsUp}
        onToggleShields={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(html).toContain('Brave Shields')
    expect(html).toContain('Shields are UP for this site')
    expect(html).toContain('is-active')
    expect(html).toContain('230') // 142 + 88 = 230
    expect(html).toContain('15.0 MB')
    expect(html).toContain('Strict')
  })

  it('renders shields down status when protection is disabled', () => {
    const html = renderToString(
      <BraveShieldsPopover
        stats={mockStatsDown}
        onToggleShields={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(html).toContain('Shields are DOWN')
    expect(html).not.toContain('is-active')
    expect(html).toContain('0.0 MB')
    expect(html).toContain('Disabled')
  })
})

describe('StreamDetectorPill', () => {
  const mockStream: DetectedStream = {
    id: 'stream-1080',
    url: 'https://stream.example/live/master.m3u8',
    title: '4K Esports Finals',
    format: 'HLS',
    resolution: '1080p60',
    timestamp: Date.now(),
  }

  it('returns null when stream is null', () => {
    const html = renderToString(
      <StreamDetectorPill
        stream={null}
        onOpenInHub={vi.fn()}
        onOpenInStudio={vi.fn()}
      />
    )
    expect(html).toBe('')
  })

  it('renders floating pill with pulse, badge, and action chips with zero emojis', () => {
    const html = renderToString(
      <StreamDetectorPill
        stream={mockStream}
        onOpenInHub={vi.fn()}
        onOpenInStudio={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(html).toContain('stream-detector-pill')
    expect(html).toContain('stream-pulse-ring')
    expect(html).toContain('stream-pulse-dot')
    expect(html).toContain('1080p60 HLS')
    expect(html).toContain('Send to Hub')
    expect(html).toContain('Studio')
    expect(html).toContain('stream-dismiss-btn')
  })
})
