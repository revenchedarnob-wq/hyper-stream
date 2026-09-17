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
    const onOpenInStudio = vi.fn()

    const html = renderToString(
      <InAppBrowser
        initialUrl="about:blank"
        onOpenInHub={onOpenInHub}
        onOpenInStudio={onOpenInStudio}
        isWorkspaceActive={true}
      />
    )

    expect(html).toContain('in-app-browser')
    expect(html).toContain('browser-toolbar')
    expect(html).toContain('speed-dial-container')
    expect(html).toContain('Twitch')
    expect(html).toContain('YouTube')
    expect(html).toContain('Kick')
    expect(html).toContain('Crunchyroll')
  })

  it('contains zero emojis across all rendered markup', () => {
    const onOpenInHub = vi.fn()
    const onOpenInStudio = vi.fn()

    const html = renderToString(
      <InAppBrowser
        initialUrl="about:blank"
        onOpenInHub={onOpenInHub}
        onOpenInStudio={onOpenInStudio}
        isWorkspaceActive={true}
      />
    )

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(html)).toBe(false)
  })
})
