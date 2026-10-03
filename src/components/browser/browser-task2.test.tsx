import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import {
  IconShieldCheck,
  IconCompass,
  IconArrowLeft,
  IconArrowRight,
  IconReload,
  IconHome,
  IconLock,
  IconBolt,
  IconDownloadCloud,
  IconX,
} from './Icons'
import { ShieldsPopover } from './ShieldsPopover'
import { StreamDetectorPill } from './StreamDetectorPill'
import type { DetectedStream } from './types'

describe('Browser icons', () => {
  it('render SVGs that follow currentColor and the requested size', () => {
    const icons = {
      IconShieldCheck,
      IconCompass,
      IconArrowLeft,
      IconArrowRight,
      IconReload,
      IconHome,
      IconLock,
      IconBolt,
      IconDownloadCloud,
      IconX,
    }
    for (const [name, Icon] of Object.entries(icons)) {
      const html = renderToString(<Icon size={24} className="custom-icon" />)
      expect(html, name).toContain('<svg')
      expect(html, name).toContain('viewBox="0 0 24 24"')
      expect(html, name).toMatch(/(stroke|fill)="currentColor"/)
      expect(html, name).toContain('width="24"')
      expect(html, name).toContain('class="custom-icon"')
    }
  })
})

describe('ShieldsPopover', () => {
  it('shows the on state without made-up counters', () => {
    const html = renderToString(<ShieldsPopover enabled onToggleShields={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('Shields')
    expect(html).toContain('is-active')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toMatch(/MB|Brave/)
  })

  it('shows the off state', () => {
    const html = renderToString(<ShieldsPopover enabled={false} onToggleShields={vi.fn()} onClose={vi.fn()} />)
    expect(html).toContain('Off')
    expect(html).toContain('aria-checked="false"')
  })
})

describe('StreamDetectorPill', () => {
  const stream: DetectedStream = {
    id: 'page-1',
    url: 'https://www.youtube.com/watch?v=abc',
    title: 'YouTube',
    format: 'YouTube',
    timestamp: Date.now(),
  }

  it('renders nothing without a stream', () => {
    expect(renderToString(<StreamDetectorPill stream={null} onOpenInHub={vi.fn()} />)).toBe('')
  })

  it('offers a single Download action', () => {
    const html = renderToString(<StreamDetectorPill stream={stream} onOpenInHub={vi.fn()} onDismiss={vi.fn()} />)
    expect(html).toContain('stream-detector-pill')
    expect(html).toContain('YouTube')
    expect(html).toContain('Download')
    expect(html).not.toContain('Studio')
    expect(html).toContain('stream-dismiss-btn')
  })
})
