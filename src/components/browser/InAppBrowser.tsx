import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  isTauri,
  browserSetBounds,
  browserSetShields,
  browserSetVisible,
  browserSnapshot,
  prewarmBrowser,
  type BrowserRect,
} from '@/lib/tauri-bridge'
import { useSettings } from '@/lib/hooks'
import { saveSettings } from '@/lib/settings'
import { BrowserToolbar } from './BrowserToolbar'
import { SpeedDial } from './SpeedDial'
import { ExtensionStoreModal } from './ExtensionStoreModal'
import { IconLock } from './Icons'
import { detectStreamFromUrl, extensionStoreListing, resolveWebEmbedUrl, siteKey } from './url-utils'
import { BLANK, useBrowserNavigation } from './use-browser-navigation'
import './browser.css'

export interface InAppBrowserProps {
  initialUrl?: string
  /** Opens a page from elsewhere in the app (e.g. "Open in Browser to sign in"). A new nonce re-triggers the same URL. */
  navigateRequest?: { url: string; nonce: number } | null
  onOpenInHub: (url: string) => void
  isWorkspaceActive?: boolean
  isMaximized?: boolean
  isSidebarOpen?: boolean
  sidebarArea?: React.ReactNode
  windowControls?: React.ReactNode
  onTopBarPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerMove?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerUp?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarDoubleClick?: (e: React.MouseEvent<HTMLElement>) => void
}

/** Longest the UI waits for a picture of the page before covering it anyway. */
const SNAPSHOT_TIMEOUT_MS = 700

export function InAppBrowser({
  initialUrl = BLANK,
  navigateRequest = null,
  onOpenInHub,
  isWorkspaceActive = true,
  isMaximized = false,
  isSidebarOpen = true,
  sidebarArea,
  windowControls,
  onTopBarPointerDown,
  onTopBarPointerMove,
  onTopBarPointerUp,
  onTopBarDoubleClick,
}: InAppBrowserProps) {
  const inTauri = isTauri()
  const viewportRef = useRef<HTMLDivElement>(null)

  const getBounds = useCallback((): BrowserRect | undefined => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 10 || rect.height < 10) return undefined
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }, [])

  const nav = useBrowserNavigation(initialUrl, getBounds)
  const { currentUrl } = nav
  const isHome = currentUrl === BLANK

  const settings = useSettings()
  const site = siteKey(currentUrl)
  const shieldsOnForSite = settings.shieldsEnabled && !(site && settings.shieldsAllowedSites.includes(site))

  const [dismissedStreamUrl, setDismissedStreamUrl] = useState<string | null>(null)
  const detectedStream = useMemo(
    () => (dismissedStreamUrl === currentUrl ? null : detectStreamFromUrl(currentUrl)),
    [currentUrl, dismissedStreamUrl],
  )
  const storeListing = useMemo(() => extensionStoreListing(currentUrl), [currentUrl])

  const [iframeError, setIframeError] = useState(false)
  const [isExtensionStoreOpen, setIsExtensionStoreOpen] = useState(false)
  const [isShieldsPanelOpen, setIsShieldsPanelOpen] = useState(false)
  const [focusAddressNonce, setFocusAddressNonce] = useState(0)
  const isPanelOpen = isExtensionStoreOpen || isShieldsPanelOpen

  // The page is a native layer drawn above the app. While an app panel is open it is replaced by a
  // picture of itself, so the panel can sit on top.
  const [pageCovered, setPageCovered] = useState(false)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  useEffect(() => {
    if (!isPanelOpen) {
      setPageCovered(false)
      return
    }
    if (!inTauri || isHome) {
      setPageCovered(true)
      return
    }
    let cancelled = false
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS))
    void Promise.race([browserSnapshot(), timeout]).then((image) => {
      if (cancelled) return
      setSnapshot(image)
      setPageCovered(true)
    })
    return () => {
      cancelled = true
    }
  }, [isPanelOpen, inTauri, isHome])

  useEffect(() => {
    setSnapshot(null)
    setIframeError(false)
  }, [currentUrl])

  // Opening the Browser tab starts the engine while the start page shows, so sites open instantly.
  // (Not at app launch: people who never use the browser don't pay for it.)
  useEffect(() => {
    if (inTauri && isWorkspaceActive) void prewarmBrowser().catch(() => {})
  }, [inTauri, isWorkspaceActive])

  // Show the page only when the Browser tab is active, not on the start page and not covered.
  useEffect(() => {
    if (!inTauri) return
    const visible = isWorkspaceActive && !pageCovered && !isHome
    void browserSetVisible(visible, isHome).catch(() => {})
  }, [inTauri, isWorkspaceActive, pageCovered, isHome])

  useEffect(() => {
    if (!inTauri) return
    return () => {
      void browserSetVisible(false).catch(() => {})
    }
  }, [inTauri])

  // Keep the native page aligned with the viewport through resizes and layout animations.
  useEffect(() => {
    if (!inTauri || isHome || !viewportRef.current) return
    const element = viewportRef.current
    const update = () => {
      const bounds = getBounds()
      if (bounds) void browserSetBounds(bounds).catch(() => {})
    }
    const timers: number[] = []
    const settle = () => {
      update()
      for (const delay of [40, 120, 250, 450]) timers.push(window.setTimeout(update, delay))
    }
    settle()
    window.addEventListener('resize', settle)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(settle) : null
    observer?.observe(element)
    let unlistenResize: (() => void) | undefined
    let disposed = false
    listen('window-resized', settle)
      .then((fn) => {
        if (disposed) fn()
        else unlistenResize = fn
      })
      .catch(() => {})
    return () => {
      disposed = true
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('resize', settle)
      observer?.disconnect()
      unlistenResize?.()
    }
  }, [inTauri, isHome, isWorkspaceActive, isMaximized, isSidebarOpen, getBounds])

  // Shields settings live in app settings; the page follows them.
  const allowedSitesKey = settings.shieldsAllowedSites.join('|')
  useEffect(() => {
    if (!inTauri) return
    void browserSetShields(settings.shieldsEnabled, allowedSitesKey ? allowedSitesKey.split('|') : []).catch(() => {})
  }, [inTauri, settings.shieldsEnabled, allowedSitesKey])

  const handleToggleShieldsGlobal = () => saveSettings({ shieldsEnabled: !settings.shieldsEnabled })
  const handleToggleShieldsForSite = () => {
    if (!site) return
    const allowed = settings.shieldsAllowedSites
    saveSettings({
      shieldsAllowedSites: allowed.includes(site) ? allowed.filter((s) => s !== site) : [...allowed, site],
    })
  }

  // Page shortcuts (Ctrl+L) and right-click "Download with HyperStream".
  const onOpenInHubRef = useRef(onOpenInHub)
  onOpenInHubRef.current = onOpenInHub
  useEffect(() => {
    if (!inTauri) return
    const unlisteners: (() => void)[] = []
    let disposed = false
    const keep = (p: Promise<() => void>) =>
      p
        .then((fn) => {
          if (disposed) fn()
          else unlisteners.push(fn)
        })
        .catch(() => {})
    keep(listen('browser-shortcut', () => setFocusAddressNonce((n) => n + 1)))
    keep(listen<string>('browser-download-request', (e) => e.payload && onOpenInHubRef.current(e.payload)))
    return () => {
      disposed = true
      unlisteners.forEach((fn) => fn())
    }
  }, [inTauri])

  // Browser shortcuts while the toolbar (not the page) has focus. The page handles its own.
  const navRef = useRef(nav)
  navRef.current = nav
  useEffect(() => {
    // Panels (Extensions, Shields) own the keyboard while open.
    if (!isWorkspaceActive || isPanelOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const typing = e.target instanceof HTMLElement && /^(input|textarea|select)$/i.test(e.target.tagName)
      if ((e.ctrlKey && key === 'l') || (e.altKey && key === 'd') || e.key === 'F6') {
        e.preventDefault()
        setFocusAddressNonce((n) => n + 1)
      } else if (e.key === 'F5' || (e.ctrlKey && key === 'r')) {
        e.preventDefault()
        if (!navRef.current.isLoading) navRef.current.reloadOrStop()
      } else if (e.altKey && e.key === 'ArrowLeft' && !typing) {
        e.preventDefault()
        if (navRef.current.canGoBack) navRef.current.back()
      } else if (e.altKey && e.key === 'ArrowRight' && !typing) {
        e.preventDefault()
        if (navRef.current.canGoForward) navRef.current.forward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isWorkspaceActive, isPanelOpen])

  // Requests from other views (Stream Hub's "Open in Browser").
  const navigateRef = useRef(nav.navigate)
  navigateRef.current = nav.navigate
  useEffect(() => {
    if (navigateRequest?.url) navigateRef.current(navigateRequest.url)
  }, [navigateRequest])

  const handleNavigate = (url: string) => {
    if (url === currentUrl && !isHome) nav.reloadOrStop()
    else nav.navigate(url)
  }

  const openExtensionPage = (url: string) => {
    setIsExtensionStoreOpen(false)
    nav.navigate(url)
  }

  const embedInfo = !inTauri && !isHome ? resolveWebEmbedUrl(currentUrl) : null

  return (
    <div className="in-app-browser" data-testid="in-app-browser">
      <BrowserToolbar
        currentUrl={currentUrl}
        pageTitle={nav.title}
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        isLoading={nav.isLoading}
        onBack={nav.back}
        onForward={nav.forward}
        onReload={nav.reloadOrStop}
        onHome={nav.home}
        onNavigate={handleNavigate}
        shieldsEnabled={shieldsOnForSite}
        shieldsGlobalEnabled={settings.shieldsEnabled}
        shieldsSite={site}
        onToggleShields={handleToggleShieldsGlobal}
        onToggleShieldsForSite={handleToggleShieldsForSite}
        onOpenExtensions={() => setIsExtensionStoreOpen(true)}
        onShieldsPanelChange={setIsShieldsPanelOpen}
        detectedStream={detectedStream}
        storeListing={storeListing}
        onOpenInHub={onOpenInHub}
        onDismissStream={() => setDismissedStreamUrl(currentUrl)}
        focusAddressNonce={focusAddressNonce}
        sidebarArea={sidebarArea}
        windowControls={windowControls}
        onTopBarPointerDown={onTopBarPointerDown}
        onTopBarPointerMove={onTopBarPointerMove}
        onTopBarPointerUp={onTopBarPointerUp}
        onTopBarDoubleClick={onTopBarDoubleClick}
      />

      <main className="browser-content-area">
        {/* Always mounted so the native page can be aligned to it. */}
        <div
          id="browser-viewport"
          ref={viewportRef}
          className={`browser-viewport ${inTauri ? 'browser-viewport-native' : ''} ${isHome ? 'is-hidden' : ''}`}
          data-testid="browser-viewport"
        >
          {inTauri && !isHome && pageCovered && (
            <div className="browser-viewport-paused" data-testid="browser-viewport-paused">
              {snapshot ? (
                <img className="browser-viewport-snapshot" src={snapshot} alt="" draggable={false} />
              ) : (
                <span>{site || currentUrl}</span>
              )}
            </div>
          )}
          {!inTauri && !isHome && (
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
                  <video src={embedInfo.embedUrl} controls autoPlay className="browser-dev-video" title="Direct Media Stream" />
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
                          <h4 className="browser-fallback-title">Preview not available</h4>
                          <p className="browser-fallback-desc">
                            This site can’t be shown in the web preview. It works in the desktop app.
                          </p>
                          <div className="browser-fallback-actions">
                            <a
                              href={currentUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="speed-dial-btn speed-dial-btn-submit"
                            >
                              Open in a new window
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

        {isHome && (
          <div className="browser-speed-dial-overlay" data-testid="browser-speed-dial-overlay">
            <SpeedDial onSelectUrl={handleNavigate} />
          </div>
        )}
      </main>

      <ExtensionStoreModal
        isOpen={isExtensionStoreOpen}
        onClose={() => setIsExtensionStoreOpen(false)}
        onOpenPage={openExtensionPage}
      />
    </div>
  )
}
