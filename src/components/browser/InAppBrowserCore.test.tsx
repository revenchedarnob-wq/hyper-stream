import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { InAppBrowser } from './InAppBrowser'
import { BrowserToolbar, BrowserNavControls } from './BrowserToolbar'
import { detectStreamFromUrl, handleBrowserSubmit, createBrowserHistory } from './url-utils'
import type { DetectedStream, ShieldsMetrics } from './types'
import * as soundModule from '@/lib/sound'

vi.mock('@/lib/sound', () => ({
  playHapticClick: vi.fn(),
  playHapticGlass: vi.fn(),
  playHapticPop: vi.fn(),
}))

describe('InAppBrowserCore Component Suite', () => {
  const defaultShieldsStats: ShieldsMetrics = {
    adsBlocked: 250,
    trackersBlocked: 150,
    bandwidthSavedBytes: 31457280, // 30.0 MB
    fingerprintingBlocked: 40,
    isEnabled: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Mount & Speed Dial Rendering', () => {
    it('renders toolbar and speed dial on initial mount when URL is about:blank', () => {
      const onOpenInHub = vi.fn()
      const onOpenInStudio = vi.fn()

      const html = renderToString(
        <InAppBrowser
          onOpenInHub={onOpenInHub}
          onOpenInStudio={onOpenInStudio}
          isWorkspaceActive={true}
        />
      )

      // Container checks
      expect(html).toContain('in-app-browser')
      expect(html).toContain('browser-toolbar')
      expect(html).toContain('id="browser-url-input"')
      expect(html).toContain('placeholder="Search with Brave or enter URL..."')

      // Navigation controls
      expect(html).toContain('data-testid="browser-btn-back"')
      expect(html).toContain('data-testid="browser-btn-forward"')
      expect(html).toContain('data-testid="browser-btn-reload"')
      expect(html).toContain('data-testid="browser-btn-home"')

      // Initial state has no back/forward history
      expect(html).toContain('disabled=""')

      // Brave Shields button with badge
      expect(html).toContain('data-testid="browser-shields-button"')
      expect(html).toContain('data-testid="browser-shields-badge"')

      // SpeedDial is mounted when currentUrl is about:blank
      expect(html).toContain('speed-dial-container')
      expect(html).toContain('Decentralized Streaming Gateway')
      expect(html).toContain('Brave Privacy Workspace')

      // Viewport container is stably mounted with is-hidden while on speed dial to ensure ref coordinates are valid
      expect(html).toContain('id="browser-viewport"')
      expect(html).toContain('is-hidden')
      expect(html).toContain('browser-speed-dial-overlay')
    })
  })

  describe('Address Omnibar Navigation & URL Submission', () => {
    it('submitting a search or URL navigates and triggers onNavigate with resolved query', () => {
      const onNavigate = vi.fn()

      const res = handleBrowserSubmit('twitch.tv', onNavigate)
      expect(soundModule.playHapticClick).toHaveBeenCalledTimes(1)
      expect(onNavigate).toHaveBeenCalledTimes(1)
      expect(onNavigate).toHaveBeenCalledWith('https://twitch.tv')
      expect(res.url).toBe('https://twitch.tv')
      expect(res.isSearch).toBe(false)

      const searchRes = handleBrowserSubmit('frieren live stream', onNavigate)
      expect(onNavigate).toHaveBeenCalledWith('https://search.brave.com/search?q=frieren+live+stream')
      expect(searchRes.isSearch).toBe(true)
    })

    it('renders BrowserToolbar with omnibar, lock icon, clear button and shields', () => {
      const html = renderToString(
        <BrowserToolbar
          currentUrl="https://twitch.tv"
          canGoBack={true}
          canGoForward={false}
          onBack={vi.fn()}
          onForward={vi.fn()}
          onReload={vi.fn()}
          onHome={vi.fn()}
          onNavigate={vi.fn()}
          shieldsStats={defaultShieldsStats}
          onOpenInHub={vi.fn()}
          onOpenInStudio={vi.fn()}
        />
      )

      expect(html).toContain('browser-toolbar')
      expect(html).toContain('value="https://twitch.tv"')
      expect(html).toContain('browser-omnibar-clear-btn')
      expect(html).toContain('data-testid="browser-shields-button"')
      expect(html).toContain('400') // 250 + 150 = 400
    })

    it('renders #browser-viewport and dev preview when a URL is active', () => {
      const html = renderToString(
        <InAppBrowser
          initialUrl="https://twitch.tv"
          onOpenInHub={vi.fn()}
          onOpenInStudio={vi.fn()}
          isWorkspaceActive={true}
        />
      )

      // Address bar displays active URL
      expect(html).toContain('value="https://twitch.tv"')

      // Viewport container is mounted
      expect(html).toContain('id="browser-viewport"')
      expect(html).toContain('browser-viewport')
      expect(html).toContain('browser-dev-preview')
      expect(html).toContain('Dev Preview')
      expect(html).toContain('https://twitch.tv')

      // SpeedDial is not mounted
      expect(html).not.toContain('speed-dial-container')
    })
  })

  describe('Stream Detection Coordinator', () => {
    it('stream detection pill appears when a stream is detected', () => {
      const mockStream: DetectedStream = {
        id: 'stream-test-1',
        url: 'https://video.example.com/hls/live.m3u8',
        title: 'Championship Live Stream',
        format: 'HLS',
        resolution: '1080p60',
        timestamp: 1710000000000,
      }

      const onOpenInHub = vi.fn()
      const onOpenInStudio = vi.fn()
      const onDismissStream = vi.fn()

      const html = renderToString(
        <BrowserToolbar
          currentUrl="https://video.example.com/hls/live.m3u8"
          canGoBack={true}
          canGoForward={false}
          onBack={vi.fn()}
          onForward={vi.fn()}
          onReload={vi.fn()}
          onHome={vi.fn()}
          onNavigate={vi.fn()}
          detectedStream={mockStream}
          onOpenInHub={onOpenInHub}
          onOpenInStudio={onOpenInStudio}
          onDismissStream={onDismissStream}
        />
      )

      expect(html).toContain('browser-stream-slot')
      expect(html).toContain('stream-detector-pill')
      expect(html).toContain('1080p60 HLS')
      expect(html).toContain('Send to Hub')
      expect(html).toContain('Studio')
    })

    it('auto-detects live stream formats from streaming URLs in InAppBrowser', () => {
      const html = renderToString(
        <InAppBrowser
          initialUrl="https://stream.provider.net/live/master.m3u8"
          onOpenInHub={vi.fn()}
          onOpenInStudio={vi.fn()}
        />
      )

      expect(html).toContain('stream-detector-pill')
      expect(html).toContain('1080p60 HLS')
      expect(html).toContain('Send to Hub')
      expect(html).toContain('Studio')
    })

    it('detectStreamFromUrl accurately identifies streaming protocols and domains', () => {
      expect(detectStreamFromUrl('about:blank')).toBeNull()
      expect(detectStreamFromUrl('')).toBeNull()

      const hls = detectStreamFromUrl('https://edge.cdn/channel.m3u8')
      expect(hls?.format).toBe('HLS')
      expect(hls?.resolution).toBe('1080p60')

      const dash = detectStreamFromUrl('https://edge.cdn/manifest.mpd')
      expect(dash?.format).toBe('DASH')
      expect(dash?.resolution).toBe('4K')

      const mp4 = detectStreamFromUrl('https://edge.cdn/clip.mp4')
      expect(mp4?.format).toBe('MP4')

      const twitch = detectStreamFromUrl('https://twitch.tv/riotgames')
      expect(twitch?.format).toBe('HLS')
      expect(twitch?.title).toContain('riotgames')

      const kick = detectStreamFromUrl('https://kick.com/xqc')
      expect(kick?.format).toBe('HLS')
      expect(kick?.title).toContain('xqc')

      const yt = detectStreamFromUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')
      expect(yt?.format).toBe('DASH')

      const anime = detectStreamFromUrl('https://crunchyroll.com/series/frieren')
      expect(anime?.format).toBe('HLS')
    })
  })

  describe('History Coordination & Navigation', () => {
    it('manages history stack, index, canGoBack, and canGoForward transitions', () => {
      const history = createBrowserHistory('about:blank')

      // Initial state
      let state = history.getState()
      expect(state.currentUrl).toBe('about:blank')
      expect(state.canGoBack).toBe(false)
      expect(state.canGoForward).toBe(false)
      expect(state.historyIndex).toBe(0)
      expect(state.historyStack).toEqual(['about:blank'])

      // Navigate to first URL
      state = history.navigate('https://twitch.tv')
      expect(state.currentUrl).toBe('https://twitch.tv')
      expect(state.canGoBack).toBe(true)
      expect(state.canGoForward).toBe(false)
      expect(state.historyIndex).toBe(1)
      expect(state.historyStack).toEqual(['about:blank', 'https://twitch.tv'])

      // Navigate to second URL
      state = history.navigate('https://youtube.com')
      expect(state.currentUrl).toBe('https://youtube.com')
      expect(state.canGoBack).toBe(true)
      expect(state.canGoForward).toBe(false)
      expect(state.historyIndex).toBe(2)

      // Go back to twitch.tv
      state = history.goBack()
      expect(state.currentUrl).toBe('https://twitch.tv')
      expect(state.canGoBack).toBe(true)
      expect(state.canGoForward).toBe(true)
      expect(state.historyIndex).toBe(1)

      // Go back to about:blank
      state = history.goBack()
      expect(state.currentUrl).toBe('about:blank')
      expect(state.canGoBack).toBe(false)
      expect(state.canGoForward).toBe(true)
      expect(state.historyIndex).toBe(0)

      // Go forward to twitch.tv
      state = history.goForward()
      expect(state.currentUrl).toBe('https://twitch.tv')
      expect(state.canGoBack).toBe(true)
      expect(state.canGoForward).toBe(true)
      expect(state.historyIndex).toBe(1)

      // Branch navigation from middle of stack
      state = history.navigate('https://kick.com')
      expect(state.currentUrl).toBe('https://kick.com')
      expect(state.canGoBack).toBe(true)
      expect(state.canGoForward).toBe(false)
      expect(state.historyIndex).toBe(2)
      // Discarded youtube.com
      expect(state.historyStack).toEqual(['about:blank', 'https://twitch.tv', 'https://kick.com'])

      // Go home
      state = history.goHome()
      expect(state.currentUrl).toBe('about:blank')
      expect(state.historyIndex).toBe(3)
    })

    it('triggers playHapticClick when toolbar navigation buttons are clicked', () => {
      const onBack = vi.fn()
      const onForward = vi.fn()
      const onReload = vi.fn()
      const onHome = vi.fn()

      const navControls = BrowserNavControls({
        canGoBack: true,
        canGoForward: true,
        onBack,
        onForward,
        onReload,
        onHome,
      })

      const buttons = navControls.props.children
      const backBtn = buttons[0]
      const forwardBtn = buttons[1]
      const reloadBtn = buttons[2]
      const homeBtn = buttons[3]

      backBtn.props.onClick()
      expect(soundModule.playHapticClick).toHaveBeenCalledTimes(1)
      expect(onBack).toHaveBeenCalledTimes(1)

      forwardBtn.props.onClick()
      expect(soundModule.playHapticClick).toHaveBeenCalledTimes(2)
      expect(onForward).toHaveBeenCalledTimes(1)

      reloadBtn.props.onClick()
      expect(soundModule.playHapticClick).toHaveBeenCalledTimes(3)
      expect(onReload).toHaveBeenCalledTimes(1)

      homeBtn.props.onClick()
      expect(soundModule.playHapticClick).toHaveBeenCalledTimes(4)
      expect(onHome).toHaveBeenCalledTimes(1)
    })
  })

  describe('Zero Emojis Audit', () => {
    it('verifies zero emojis anywhere in rendered InAppBrowser HTML', () => {
      const htmlInitial = renderToString(
        <InAppBrowser
          onOpenInHub={vi.fn()}
          onOpenInStudio={vi.fn()}
          isWorkspaceActive={true}
        />
      )

      const htmlActive = renderToString(
        <InAppBrowser
          initialUrl="https://twitch.tv"
          onOpenInHub={vi.fn()}
          onOpenInStudio={vi.fn()}
          isWorkspaceActive={true}
        />
      )

      const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u

      expect(emojiRegex.test(htmlInitial)).toBe(false)
      expect(emojiRegex.test(htmlActive)).toBe(false)
    })
  })
})
