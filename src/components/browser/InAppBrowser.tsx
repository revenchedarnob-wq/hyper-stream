import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/lib/tauri-bridge'
import type { DetectedStream, ShieldsMetrics } from './types'
import { BrowserToolbar } from './BrowserToolbar'
import { SpeedDial } from './SpeedDial'
import { ExtensionStoreModal } from './ExtensionStoreModal'
import { IconLock } from './Icons'
import { detectStreamFromUrl, resolveWebEmbedUrl, isSameUrl, calculateSiteShieldsMetrics } from './url-utils'
import './browser.css'

export interface InAppBrowserProps {
  initialUrl?: string
  onOpenInHub: (url: string) => void
  onOpenInStudio: (url: string) => void
  isWorkspaceActive?: boolean
  isMaximized?: boolean
  isSidebarOpen?: boolean
}

interface BrowserHistoryState {
  stack: string[]
  index: number
}

export function InAppBrowser({
  initialUrl = 'about:blank',
  onOpenInHub,
  onOpenInStudio,
  isWorkspaceActive = true,
  isMaximized = false,
  isSidebarOpen = true,
}: InAppBrowserProps) {
  const [history, setHistory] = useState<BrowserHistoryState>({
    stack: [initialUrl || 'about:blank'],
    index: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [detectedStream, setDetectedStream] = useState<DetectedStream | null>(() =>
    detectStreamFromUrl(initialUrl || '')
  )

  const [shieldsStats, setShieldsStats] = useState<ShieldsMetrics>(() =>
    calculateSiteShieldsMetrics(initialUrl || 'about:blank', true)
  )
  const [isExtensionStoreOpen, setIsExtensionStoreOpen] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)

  const safeIndex = Math.min(Math.max(0, history.index), history.stack.length - 1)
  const currentUrl = history.stack[safeIndex] || 'about:blank'
  const canGoBack = safeIndex > 0
  const canGoForward = safeIndex < history.stack.length - 1
  const inTauri = isTauri()

  // Synchronize stream detection with custom window events
  useEffect(() => {
    function handleStreamDetectedEvent(event: Event) {
      const custom = event as CustomEvent<DetectedStream>
      if (custom.detail) {
        setDetectedStream(custom.detail)
      }
    }

    window.addEventListener('hyperstream:stream-detected', handleStreamDetectedEvent)
    return () => {
      window.removeEventListener('hyperstream:stream-detected', handleStreamDetectedEvent)
    }
  }, [])

  // Listen for native Tauri browser navigation events
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined

    listen<string>('browser-page-loaded', (event) => {
      if (event.payload && event.payload !== 'about:blank') {
        const loadedUrl = event.payload
        setHistory((prev) => {
          const safeIdx = Math.min(Math.max(0, prev.index), prev.stack.length - 1)
          const activeUrl = prev.stack[safeIdx] || ''

          // If the loaded URL is canonical / redirect of the current active URL, update in place
          if (isSameUrl(activeUrl, loadedUrl)) {
            const nextStack = [...prev.stack]
            nextStack[safeIdx] = loadedUrl
            return { stack: nextStack, index: safeIdx }
          }

          // If it's a new navigation inside the webview (e.g. user clicked a link)
          const nextStack = prev.stack.slice(0, safeIdx + 1)
          if (nextStack[nextStack.length - 1] !== loadedUrl) {
            nextStack.push(loadedUrl)
          }
          return {
            stack: nextStack,
            index: nextStack.length - 1,
          }
        })

        const detected = detectStreamFromUrl(loadedUrl)
        if (detected) setDetectedStream(detected)
        setShieldsStats((prev) => calculateSiteShieldsMetrics(loadedUrl, prev.isEnabled))

        // Ensure webview bounds and rounded corners are synchronized after page load
        if (viewportRef.current) {
          const rect = viewportRef.current.getBoundingClientRect()
          if (rect.width >= 10 && rect.height >= 10) {
            invoke('update_browser_bounds', {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }).catch(() => {})
          }
        }
      }
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => {})

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // Coordinate viewport bounds with native Tauri child webview
  useEffect(() => {
    if (!viewportRef.current || currentUrl === 'about:blank' || !currentUrl) return

    const element = viewportRef.current
    const updateBounds = () => {
      if (!element) return
      const rect = element.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return

      if (isTauri()) {
        invoke('update_browser_bounds', {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }).catch(() => {})
      }
    }

    // Schedule progressive bounds updates to sync with CSS transitions and window animations
    updateBounds()
    const timers = [
      setTimeout(updateBounds, 30),
      setTimeout(updateBounds, 80),
      setTimeout(updateBounds, 160),
      setTimeout(updateBounds, 280),
      setTimeout(updateBounds, 420),
      setTimeout(updateBounds, 600),
    ]

    const handleResize = () => {
      updateBounds()
      setTimeout(updateBounds, 40)
      setTimeout(updateBounds, 120)
      setTimeout(updateBounds, 250)
      setTimeout(updateBounds, 450)
    }

    window.addEventListener('resize', handleResize)

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        handleResize()
      })
      observer.observe(element)
    }

    let unlistenResize: (() => void) | null = null
    if (isTauri()) {
      listen('window-resized', () => {
        handleResize()
      }).then((fn) => {
        unlistenResize = fn
      }).catch(() => {})
    }

    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', handleResize)
      if (observer) observer.disconnect()
      if (unlistenResize) unlistenResize()
    }
  }, [currentUrl, isWorkspaceActive, isMaximized, isSidebarOpen])

  // Coordinate native webview visibility and memory trimming
  useEffect(() => {
    if (isTauri()) {
      const visible = isWorkspaceActive && currentUrl !== 'about:blank' && !!currentUrl
      invoke('set_browser_visibility', { visible }).catch(() => {})
    }
    return () => {
      if (isTauri()) {
        invoke('set_browser_visibility', { visible: false }).catch(() => {})
      }
    }
  }, [isWorkspaceActive, currentUrl])

  const getBoundsParam = () => {
    if (!viewportRef.current) return undefined
    const rect = viewportRef.current.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return undefined
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  const handleNavigate = (targetUrl: string) => {
    const trimmed = targetUrl.trim() || 'about:blank'
    setIframeError(false)

    if (trimmed === currentUrl) {
      handleReload()
      return
    }

    setHistory((prev) => {
      const safeIdx = Math.min(Math.max(0, prev.index), prev.stack.length - 1)
      const nextStack = prev.stack.slice(0, safeIdx + 1)
      nextStack.push(trimmed)
      return {
        stack: nextStack,
        index: nextStack.length - 1,
      }
    })
    setIsLoading(true)
    setTimeout(() => setIsLoading(false), 200)

    const detected = detectStreamFromUrl(trimmed)
    setDetectedStream(detected)
    setShieldsStats((prev) => calculateSiteShieldsMetrics(trimmed, prev.isEnabled))

    if (isTauri()) {
      if (trimmed === 'about:blank') {
        invoke('navigate_browser', { url: 'about:blank' }).catch(() => {})
        invoke('set_browser_visibility', { visible: false }).catch(() => {})
        return
      }

      const bounds = getBoundsParam()
      if (bounds) {
        invoke('update_browser_bounds', bounds).catch(() => {})
      }
      invoke('navigate_browser', { url: trimmed, bounds }).catch(() => {})
      invoke('set_browser_visibility', { visible: true }).catch(() => {})
    }
  }

  const handleBack = () => {
    if (safeIndex > 0) {
      const newIndex = safeIndex - 1
      const prevUrl = history.stack[newIndex]
      setHistory((prev) => ({ ...prev, index: newIndex }))
      setIframeError(false)
      setDetectedStream(detectStreamFromUrl(prevUrl))
      setShieldsStats((prev) => calculateSiteShieldsMetrics(prevUrl, prev.isEnabled))

      if (isTauri()) {
        if (prevUrl === 'about:blank') {
          invoke('navigate_browser', { url: 'about:blank' }).catch(() => {})
          invoke('set_browser_visibility', { visible: false }).catch(() => {})
        } else {
          const bounds = getBoundsParam()
          invoke('navigate_browser', { url: prevUrl, bounds }).catch(() => {})
          invoke('set_browser_visibility', { visible: true }).catch(() => {})
        }
      }
    }
  }

  const handleForward = () => {
    if (safeIndex < history.stack.length - 1) {
      const newIndex = safeIndex + 1
      const nextUrl = history.stack[newIndex]
      setHistory((prev) => ({ ...prev, index: newIndex }))
      setIframeError(false)
      setDetectedStream(detectStreamFromUrl(nextUrl))
      setShieldsStats((prev) => calculateSiteShieldsMetrics(nextUrl, prev.isEnabled))

      if (isTauri()) {
        if (nextUrl === 'about:blank') {
          invoke('navigate_browser', { url: 'about:blank' }).catch(() => {})
          invoke('set_browser_visibility', { visible: false }).catch(() => {})
        } else {
          const bounds = getBoundsParam()
          invoke('navigate_browser', { url: nextUrl, bounds }).catch(() => {})
          invoke('set_browser_visibility', { visible: true }).catch(() => {})
        }
      }
    }
  }

  const handleReload = () => {
    setIsLoading(true)
    setIframeError(false)
    setTimeout(() => setIsLoading(false), 250)

    if (isTauri()) {
      const bounds = getBoundsParam()
      invoke('browser_reload').catch(() => {
        invoke('navigate_browser', { url: currentUrl, bounds }).catch(() => {})
      })
    }
  }

  const handleHome = () => {
    setIframeError(false)
    setDetectedStream(null)
    setShieldsStats((prev) => calculateSiteShieldsMetrics('about:blank', prev.isEnabled))
    setHistory((prev) => {
      const safeIdx = Math.min(Math.max(0, prev.index), prev.stack.length - 1)
      const nextStack = prev.stack.slice(0, safeIdx + 1)
      nextStack.push('about:blank')
      return {
        stack: nextStack,
        index: nextStack.length - 1,
      }
    })
    if (isTauri()) {
      invoke('navigate_browser', { url: 'about:blank' }).catch(() => {})
      invoke('set_browser_visibility', { visible: false }).catch(() => {})
    }
  }

  const handleToggleShields = () => {
    setShieldsStats((prev) => {
      const nextEnabled = !prev.isEnabled
      if (isTauri()) {
        invoke('browser_set_shields_enabled', { enabled: nextEnabled }).catch(() => {})
      }
      return calculateSiteShieldsMetrics(currentUrl, nextEnabled)
    })
  }

  const handleDismissStream = () => {
    setDetectedStream(null)
  }

  const isSpeedDialView = currentUrl === 'about:blank' || !currentUrl
  const embedInfo = !inTauri && !isSpeedDialView ? resolveWebEmbedUrl(currentUrl) : null

  return (
    <div className="in-app-browser" data-testid="in-app-browser">
      <BrowserToolbar
        currentUrl={currentUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={isLoading}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onHome={handleHome}
        onNavigate={handleNavigate}
        shieldsStats={shieldsStats}
        onToggleShields={handleToggleShields}
        onOpenExtensions={() => setIsExtensionStoreOpen(true)}
        detectedStream={detectedStream}
        onOpenInHub={onOpenInHub}
        onOpenInStudio={onOpenInStudio}
        onDismissStream={handleDismissStream}
      />

      <main className="browser-content-area">
        {/* Viewport container is ALWAYS mounted so bounds and refs are always stable and non-null */}
        <div
          id="browser-viewport"
          ref={viewportRef}
          className={`browser-viewport ${inTauri ? 'browser-viewport-native' : ''} ${isSpeedDialView ? 'is-hidden' : ''}`}
          data-testid="browser-viewport"
        >
          {/* When running in Tauri desktop, native Webview renders directly over this viewport */}
          {!inTauri && !isSpeedDialView && (
              <div className="browser-dev-preview">
                <div className="browser-dev-bar">
                  <div className="browser-dev-badge">
                    <IconLock size={12} />
                    <span>Dev Preview</span>
                  </div>
                  <span className="browser-dev-url" title={currentUrl}>
                    {currentUrl}
                  </span>
                  <div className="browser-dev-actions">
                    <button
                      type="button"
                      className="browser-dev-simulate-btn"
                      onClick={() =>
                        setDetectedStream({
                          id: `sim-${Date.now()}`,
                          url: currentUrl,
                          title: 'Simulated Stream',
                          format: 'HLS',
                          resolution: '1080p60',
                          timestamp: Date.now(),
                        })
                      }
                      title="Simulate live stream detection"
                      data-testid="browser-dev-simulate-btn"
                    >
                      Simulate Stream
                    </button>
                    <a
                      href={currentUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="browser-dev-external-btn"
                      title="Open in external browser window"
                    >
                      External
                    </a>
                  </div>
                </div>

                <div className="browser-dev-iframe-container">
                  {embedInfo?.type === 'video' ? (
                    <video
                      src={embedInfo.embedUrl}
                      controls
                      autoPlay
                      className="browser-dev-video"
                      title="Direct Media Stream"
                    />
                  ) : embedInfo?.type === 'youtube' || embedInfo?.type === 'twitch' ? (
                    <iframe
                      id="browser-dev-iframe"
                      src={embedInfo.embedUrl}
                      className="browser-dev-iframe"
                      title="Embedded Media Stream"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <>
                      <iframe
                        id="browser-dev-iframe"
                        src={currentUrl}
                        className="browser-dev-iframe"
                        title="In-App Browser Web View"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                        onError={() => setIframeError(true)}
                      />

                      {iframeError && (
                        <div className="browser-fallback-overlay">
                          <div className="browser-fallback-card">
                            <h4 className="browser-fallback-title">External Site Security Restriction</h4>
                            <p className="browser-fallback-desc">
                              This site restricts embedded iframes via <code>X-Frame-Options: SAMEORIGIN</code>. In HyperStream’s native Tauri desktop runtime, this renders inside the hardware-accelerated Webview2 engine with Brave Shields active.
                            </p>
                            <div className="browser-fallback-actions">
                              <a
                                href={currentUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="speed-dial-btn speed-dial-btn-submit"
                              >
                                Open in Dedicated Window
                              </a>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

        {isSpeedDialView && (
          <div className="browser-speed-dial-overlay" data-testid="browser-speed-dial-overlay">
            <SpeedDial shieldsStats={shieldsStats} onSelectUrl={handleNavigate} />
          </div>
        )}
      </main>

      <ExtensionStoreModal
        isOpen={isExtensionStoreOpen}
        onClose={() => setIsExtensionStoreOpen(false)}
      />
    </div>
  )
}

