import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { BrowserTabStrip, type BrowserTab } from './BrowserTabStrip'
import { FindInPageBar } from './FindInPageBar'
import { ZoomHud } from './ZoomHud'
import { OmnibarDropdown, SEARCH_ENGINES } from './OmnibarDropdown'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
  playHapticSwoosh: vi.fn(),
}))

describe('BrowserTabStrip Component Suite', () => {
  const sampleTabs: BrowserTab[] = [
    {
      id: 'tab-1',
      url: 'https://example.com',
      title: 'Example Domain',
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
    },
    {
      id: 'tab-2',
      url: 'about:blank',
      title: 'New Tab',
      canGoBack: false,
      canGoForward: false,
      isLoading: true,
    },
  ]

  it('renders tab strip with tabs and new tab button', () => {
    const html = renderToString(
      <BrowserTabStrip
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />
    )

    expect(html).toContain('browser-tab-strip')
    expect(html).toContain('browser-tab-list')
    expect(html).toContain('Example Domain')
    expect(html).toContain('New Tab')
    expect(html).toContain('is-active')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('browser-tab-new-btn')
  })

  it('shows loading spinner when tab isLoading is true', () => {
    const html = renderToString(
      <BrowserTabStrip
        tabs={sampleTabs}
        activeTabId="tab-2"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />
    )

    expect(html).toContain('browser-tab-spinner')
  })
})

describe('FindInPageBar Component Suite', () => {
  it('renders when isOpen is true', () => {
    const html = renderToString(
      <FindInPageBar
        isOpen={true}
        onClose={vi.fn()}
        onFind={vi.fn()}
        matchCount={3}
        currentMatch={1}
      />
    )

    expect(html).toContain('find-in-page-bar')
    expect(html).toContain('Find in page...')
    expect(html).toContain('data-testid="find-in-page-input"')
  })

  it('returns null when isOpen is false', () => {
    const html = renderToString(
      <FindInPageBar
        isOpen={false}
        onClose={vi.fn()}
        onFind={vi.fn()}
      />
    )

    expect(html).toBe('')
  })
})

describe('ZoomHud Component Suite', () => {
  it('renders zoom factor as percentage', () => {
    const html = renderToString(
      <ZoomHud
        zoom={1.25}
        visible={true}
        onReset={vi.fn()}
      />
    )

    expect(html).toContain('browser-zoom-hud')
    expect(html).toContain('is-visible')
    expect(html).toContain('125')
    expect(html).toContain('browser-zoom-hud-reset')
  })

  it('omits reset button when zoom is exactly 100%', () => {
    const html = renderToString(
      <ZoomHud
        zoom={1.0}
        visible={true}
        onReset={vi.fn()}
      />
    )

    expect(html).toContain('100')
    expect(html).not.toContain('browser-zoom-hud-reset')
  })
})

describe('OmnibarDropdown Component Suite', () => {
  it('renders search engine suggestions when query is entered', () => {
    const html = renderToString(
      <OmnibarDropdown
        isOpen={true}
        query="react hooks"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        shortcuts={[]}
      />
    )

    expect(html).toContain('omnibar-dropdown')
    for (const engine of SEARCH_ENGINES) {
      expect(html).toContain(engine.name)
    }
    expect(html).toContain('Search with Brave')
    expect(html).toContain('react hooks')
  })

  it('does not render when isOpen is false', () => {
    const html = renderToString(
      <OmnibarDropdown
        isOpen={false}
        query="hello"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        shortcuts={[]}
      />
    )

    expect(html).toBe('')
  })
})
