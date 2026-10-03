import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { InAppBrowser } from './InAppBrowser'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
  playHapticSwoosh: vi.fn(),
}))

describe('InAppBrowser Workspace Integration Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders correctly within the workspace container', () => {
    const onOpenInHub = vi.fn()

    const html = renderToString(
      <InAppBrowser
        initialUrl="about:blank"
        onOpenInHub={onOpenInHub}
        isWorkspaceActive={true}
      />
    )

    expect(html).toContain('in-app-browser')
    expect(html).toContain('browser-toolbar')
    expect(html).toContain('speed-dial-container')
    expect(html).toContain('speed-dial-add-tile')
  })

  it('contains zero emojis across all rendered markup', () => {
    const onOpenInHub = vi.fn()

    const html = renderToString(
      <InAppBrowser
        initialUrl="about:blank"
        onOpenInHub={onOpenInHub}
        isWorkspaceActive={true}
      />
    )

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(html)).toBe(false)
  })

  it('renders unified header with brand area and window controls when provided', () => {
    const onOpenInHub = vi.fn()

    const html = renderToString(
      <InAppBrowser
        initialUrl="https://example.com"
        onOpenInHub={onOpenInHub}
        isWorkspaceActive={true}
        isSidebarOpen={false}
        sidebarArea={<div data-testid="test-brand">HyperStream</div>}
        windowControls={<div data-testid="test-controls">Controls</div>}
      />
    )

    expect(html).toContain('is-unified-header')
    expect(html).toContain('test-brand')
    expect(html).toContain('test-controls')
  })
})
