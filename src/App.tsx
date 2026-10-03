import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { detectHardwareProfile } from './lib/hardware-profiler'
import { listen } from '@tauri-apps/api/event'
import './App.css'
import { StreamHub } from './components/stream-hub/StreamHub'

// Screens other than the Hub load on first use (smaller startup script on slow PCs) and are
// fetched quietly once the app is idle, so the first open is still instant.
const loadLibrary = () => import('./components/media-library/MediaLibrary')
const loadSettings = () => import('./components/settings/Settings')
const loadBrowser = () => import('./components/browser/InAppBrowser')
const MediaLibrary = lazy(() => loadLibrary().then((m) => ({ default: m.MediaLibrary })))
const Settings = lazy(() => loadSettings().then((m) => ({ default: m.Settings })))
const InAppBrowser = lazy(() => loadBrowser().then((m) => ({ default: m.InAppBrowser })))
import { IconCompass } from './components/browser/Icons'

import {
  IconSparkles,
  IconFilm,
  IconCpu,
} from './components/stream-hub/Icons'
import {
  playHapticClick,
  playHapticGlass,
  playHapticSwoosh,
  isHapticAudioMuted,
  toggleHapticAudio,
  subscribeHapticAudio,
  suspendHapticAudio,
  resumeHapticAudio,
} from '@/lib/sound'
import {
  isTauri,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  syncWindowsAccentColor,
  listenWindowMoved,
  listenWindowResized,
  getWindowPosition,
  isWindowMaximized,
  isAppForeground,
} from '@/lib/tauri-bridge'

import {
  SIMULATOR_WALLPAPERS,
  getAllWallpapers,
  saveCustomWallpaper,
  deleteCustomWallpaper,
  type WallpaperOption,
} from '@/lib/wallpapers'

const NAV_ITEMS = [
  { id: 'hub', label: 'Stream Hub', icon: IconSparkles },
  { id: 'browser', label: 'Browser', icon: IconCompass },
  { id: 'library', label: 'Media Library', icon: IconFilm },
  { id: 'settings', label: 'Settings', icon: IconCpu },
]

export default function App() {
  const isNative = isTauri()
  const [activeNav, setActiveNav] = useState('hub')
  const [browserHandoffUrl, setBrowserHandoffUrl] = useState('')
  const [browserRequest, setBrowserRequest] = useState<{ url: string; nonce: number } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('hyperstream_sidebar_open') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('hyperstream_sidebar_open', sidebarOpen ? '1' : '0')
    } catch {
      // Storage unavailable: the sidebar just opens next time.
    }
  }, [sidebarOpen])
  const [isMaximized, setIsMaximized] = useState(false)
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const [wallpapersList, setWallpapersList] = useState<WallpaperOption[]>(() => getAllWallpapers())
  const [browserWallpaper, setBrowserWallpaper] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('hyperstream_browser_wallpaper')
      const all = getAllWallpapers()
      if (saved && all.some((w) => w.url === saved)) {
        return saved
      }
      return '/wallpapers/bg-neon-waves.jpg'
    } catch {
      return '/wallpapers/bg-neon-waves.jpg'
    }
  })

  const [prevWallpaper, setPrevWallpaper] = useState<string | null>(null)
  const [isTransitioningWallpaper, setIsTransitioningWallpaper] = useState(false)
  const wallpaperTransitionTimerRef = useRef<number | null>(null)

  const handleSelectWallpaper = (newUrl: string) => {
    if (newUrl === browserWallpaper) return

    setPrevWallpaper(browserWallpaper)
    setIsTransitioningWallpaper(true)
    setBrowserWallpaper(newUrl)

    try {
      localStorage.setItem('hyperstream_browser_wallpaper', newUrl)
    } catch {}

    if (wallpaperTransitionTimerRef.current !== null) {
      clearTimeout(wallpaperTransitionTimerRef.current)
    }

    wallpaperTransitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioningWallpaper(false)
      setPrevWallpaper(null)
      wallpaperTransitionTimerRef.current = null
    }, 550)
  }

  const handleAddCustomWallpaper = (newWp: WallpaperOption) => {
    saveCustomWallpaper(newWp)
    setWallpapersList(getAllWallpapers())
  }

  const handleDeleteCustomWallpaper = (id: string) => {
    deleteCustomWallpaper(id)
    const updated = getAllWallpapers()
    setWallpapersList(updated)
    if (!updated.some((w) => w.url === browserWallpaper)) {
      handleSelectWallpaper(SIMULATOR_WALLPAPERS[0].url)
    }
  }

  useEffect(() => {
    return () => {
      if (wallpaperTransitionTimerRef.current !== null) {
        clearTimeout(wallpaperTransitionTimerRef.current)
      }
    }
  }, [])

  const [isPotatoMode, setIsPotatoMode] = useState(() => {
    try {
      const stored = localStorage.getItem('hyperstream_potato_mode_v3')
      if (stored !== null) {
        return stored === 'true'
      }
    } catch {
      // Storage unavailable: fall through to the hardware check.
    }
    // First launch: the same rule Settings recommends with, decided once and saved (the GPU is
    // probed this one time only). Switching in Settings replaces it.
    // Existing installs (any saved HyperStream setting) keep the Studio look they've been using.
    let existingInstall = false
    try {
      existingInstall = Object.keys(localStorage).some((k) => k.startsWith('hyperstream_'))
    } catch {
      // Treat as a new install.
    }
    const efficient = !existingInstall && detectHardwareProfile().recommendedRenderingProfile === 'potato'
    try {
      localStorage.setItem('hyperstream_potato_mode_v3', String(efficient))
    } catch {
      // Not saved: decided again next launch.
    }
    return efficient
  })
  const [isBloomEnabled, setIsBloomEnabled] = useState(() => {
    try {
      return localStorage.getItem('hyperstream_ambient_bloom') !== 'false'
    } catch {
      return true
    }
  })
  const [audioMuted, setAudioMuted] = useState(isHapticAudioMuted())

  const handleTogglePotatoMode = () => {
    setIsPotatoMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem('hyperstream_potato_mode_v3', String(next))
        localStorage.setItem('hyperstream_potato_mode_v2', String(next))
        localStorage.setItem('hyperstream_potato_mode', String(next))
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }

  const handleToggleBloom = () => {
    setIsBloomEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem('hyperstream_ambient_bloom', String(next))
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }

  const [windowPos, setWindowPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const windowContainerRef = useRef<HTMLDivElement>(null)
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  }>({ startX: 0, startY: 0, origX: 0, origY: 0 })

  const nativeIntervalIdRef = useRef<number | null>(null)
  const isPointerDownRef = useRef<boolean>(false)
  const lastNativeCoordsRef = useRef<{ x: number; y: number }>({ x: -9999, y: -9999 })

  const stopNativeDragSync = () => {
    isPointerDownRef.current = false
    if (nativeIntervalIdRef.current !== null) {
      clearInterval(nativeIntervalIdRef.current)
      nativeIntervalIdRef.current = null
    }
  }

  const startNativeDragSync = () => {
    stopNativeDragSync()
    isPointerDownRef.current = true

    const syncPos = () => {
      if (!windowContainerRef.current) return
      const curX = window.screenLeft ?? window.screenX ?? 0
      const curY = window.screenTop ?? window.screenY ?? 0

      if (curX !== lastNativeCoordsRef.current.x || curY !== lastNativeCoordsRef.current.y) {
        lastNativeCoordsRef.current = { x: curX, y: curY }
        const { parallaxX, parallaxY } = computeNormalizedParallax(curX, curY, false)
        windowContainerRef.current.style.setProperty('--bg-parallax-x', `${parallaxX}px`)
        windowContainerRef.current.style.setProperty('--bg-parallax-y', `${parallaxY}px`)
      }
    }

    syncPos()
    nativeIntervalIdRef.current = window.setInterval(syncPos, 16)
  }

  const computeNormalizedParallax = (currentX: number, currentY: number, isBrowserSim: boolean) => {
    if (isMaximized) {
      return { parallaxX: 0, parallaxY: 0 }
    }
    if (isBrowserSim) {
      const screenW = window.innerWidth || 1920
      const screenH = window.innerHeight || 1080
      const winW = windowContainerRef.current?.offsetWidth || 1240
      const winH = windowContainerRef.current?.offsetHeight || 780
      const maxMoveX = Math.max(0, screenW - winW)
      const maxMoveY = Math.max(0, screenH - winH)
      const curX = Math.round((screenW - winW) / 2 + currentX)
      const curY = Math.round((screenH - winH) / 2 + currentY)
      const clampedX = Math.max(0, Math.min(maxMoveX, curX))
      const clampedY = Math.max(0, Math.min(maxMoveY, curY))
      return {
        parallaxX: clampedX,
        parallaxY: clampedY,
      }
    } else {
      const screenW = window.screen.availWidth || window.screen.width || 1920
      const screenH = window.screen.availHeight || window.screen.height || 1080
      const winW = window.innerWidth
      const winH = window.innerHeight
      const maxMoveX = Math.max(0, screenW - winW)
      const maxMoveY = Math.max(0, screenH - winH)
      const clampedX = Math.max(0, Math.min(maxMoveX, currentX))
      const clampedY = Math.max(0, Math.min(maxMoveY, currentY))
      return {
        parallaxX: clampedX,
        parallaxY: clampedY,
      }
    }
  }

  // Data written by earlier versions that nothing reads any more.
  useEffect(() => {
    try {
      for (const key of ['hyperstream_media_items', 'hyperstream_browser_extensions_v1']) localStorage.removeItem(key)
    } catch {
      // Storage unavailable: nothing to clean.
    }
  }, [])

  useEffect(() => {
    syncWindowsAccentColor()

    const handleFocus = () => {
      setIsWindowFocused(true)
      resumeHapticAudio()
      if (isNative && windowContainerRef.current) {
        const currentX = window.screenLeft ?? window.screenX ?? 0
        const currentY = window.screenTop ?? window.screenY ?? 0
        const screenW = window.screen.availWidth || window.screen.width || 1920
        const screenH = window.screen.availHeight || window.screen.height || 1080
        windowContainerRef.current.style.setProperty('--screen-width', `${screenW}px`)
        windowContainerRef.current.style.setProperty('--screen-height', `${screenH}px`)
        const { parallaxX, parallaxY } = computeNormalizedParallax(currentX, currentY, false)
        windowContainerRef.current.style.setProperty('--bg-parallax-x', `${parallaxX}px`)
        windowContainerRef.current.style.setProperty('--bg-parallax-y', `${parallaxY}px`)
      }
    }

    // Clicking into the built-in browser's page moves focus out of this document while the
    // window stays active; only a real switch to another app counts as unfocused.
    let pageFocused = false
    let blurTimer: number | undefined
    const handleBlur = () => {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(async () => {
        if (pageFocused || document.hasFocus()) return
        if (isNative && (await isAppForeground())) return
        setIsWindowFocused(false)
        suspendHapticAudio()
      }, 150)
    }
    let unlistenPageFocus: (() => void) | undefined
    let disposed = false
    if (isNative) {
      listen<boolean>('browser-page-focus', (e) => {
        pageFocused = e.payload
        if (pageFocused) {
          window.clearTimeout(blurTimer)
          setIsWindowFocused(true)
        } else {
          handleBlur()
        }
      })
        .then((fn) => {
          if (disposed) fn()
          else unlistenPageFocus = fn
        })
        .catch(() => {})
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsWindowFocused(false)
        stopNativeDragSync()
        suspendHapticAudio()
      } else {
        handleFocus()
      }
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('pointerup', stopNativeDragSync)
    window.addEventListener('mouseup', stopNativeDragSync)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const unsubAudio = subscribeHapticAudio(setAudioMuted)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('pointerup', stopNativeDragSync)
      window.removeEventListener('mouseup', stopNativeDragSync)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopNativeDragSync()
      unsubAudio()
      disposed = true
      window.clearTimeout(blurTimer)
      unlistenPageFocus?.()
    }
  }, [isNative])

  // In native Windows, sync physical coordinates on initial mount, resize, and real-time drag
  useEffect(() => {
    if (!isNative) return

    let isMounted = true
    let unlistenMove: (() => void) | null = null
    let unlistenResize: (() => void) | null = null

    const updateDimensionsAndPosition = (posX?: number, posY?: number) => {
      if (!windowContainerRef.current) return

      const screenW = window.screen.availWidth || window.screen.width || 1920
      const screenH = window.screen.availHeight || window.screen.height || 1080
      const winW = window.innerWidth
      const winH = window.innerHeight

      windowContainerRef.current.style.setProperty('--screen-width', `${screenW}px`)
      windowContainerRef.current.style.setProperty('--screen-height', `${screenH}px`)

      const curX = posX ?? (window.screenLeft ?? window.screenX ?? (screenW - winW) / 2)
      const curY = posY ?? (window.screenTop ?? window.screenY ?? (screenH - winH) / 2)
      lastNativeCoordsRef.current = { x: curX, y: curY }

      const { parallaxX, parallaxY } = computeNormalizedParallax(curX, curY, false)
      windowContainerRef.current.style.setProperty('--bg-parallax-x', `${parallaxX}px`)
      windowContainerRef.current.style.setProperty('--bg-parallax-y', `${parallaxY}px`)
    }

    // Initial position setup from native window outer position
    getWindowPosition().then((pos) => {
      if (!isMounted) return
      if (pos) {
        updateDimensionsAndPosition(pos.x, pos.y)
      } else {
        updateDimensionsAndPosition()
      }
    })

    // Listen to real-time native window move events from Tauri (fires on every pixel during native drag)
    listenWindowMoved((x, y) => {
      if (!isMounted) return
      lastNativeCoordsRef.current = { x, y }
      if (windowContainerRef.current) {
        const { parallaxX, parallaxY } = computeNormalizedParallax(x, y, false)
        windowContainerRef.current.style.setProperty('--bg-parallax-x', `${parallaxX}px`)
        windowContainerRef.current.style.setProperty('--bg-parallax-y', `${parallaxY}px`)
      }
    }).then((unlisten) => {
      if (isMounted) {
        unlistenMove = unlisten
      } else {
        unlisten()
      }
    })

    // Maximize can also come from the OS (Win+Up, snap layouts), so read it back on every resize.
    const syncMaximized = () => {
      void isWindowMaximized().then((max) => {
        if (isMounted) setIsMaximized(max)
      })
    }
    syncMaximized()

    // Listen to native window resize events
    listenWindowResized(() => {
      if (!isMounted) return
      syncMaximized()
      updateDimensionsAndPosition(lastNativeCoordsRef.current.x, lastNativeCoordsRef.current.y)
    }).then((unlisten) => {
      if (isMounted) {
        unlistenResize = unlisten
      } else {
        unlisten()
      }
    })

    const handleWindowResize = () => updateDimensionsAndPosition()
    window.addEventListener('resize', handleWindowResize)

    return () => {
      isMounted = false
      if (unlistenMove) unlistenMove()
      if (unlistenResize) unlistenResize()
      window.removeEventListener('resize', handleWindowResize)
      stopNativeDragSync()
    }
  }, [isNative])

  useEffect(() => {
    if (!isNative) {
      document.documentElement.classList.add('is-browser-environment')
      document.body.classList.add('is-browser-environment')
      document.documentElement.classList.remove('is-tauri')
      document.body.classList.remove('is-tauri')
    } else {
      document.documentElement.classList.remove('is-browser-environment')
      document.body.classList.remove('is-browser-environment')
      document.documentElement.classList.add('is-tauri')
      document.body.classList.add('is-tauri')
    }
  }, [isNative])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey
      if (isCmdOrCtrl) {
        if (e.key === '1') {
          e.preventDefault()
          playHapticSwoosh()
          setActiveNav('hub')
        } else if (e.key === '2') {
          e.preventDefault()
          playHapticSwoosh()
          setActiveNav('browser')
        } else if (e.key === '3') {
          e.preventDefault()
          playHapticSwoosh()
          setActiveNav('library')
        } else if (e.key === '4') {
          e.preventDefault()
          playHapticSwoosh()
          setActiveNav('settings')
        } else if (e.key === 'l' || e.key === 'L') {
          e.preventDefault()
          setActiveNav('browser')
          setTimeout(() => {
            const input = document.getElementById('browser-url-input')
            input?.focus()
          }, 50)
        } else if (e.key === 'k' || e.key === 'K') {
          e.preventDefault()
          setActiveNav('hub')
          setTimeout(() => {
            const input = document.getElementById('stream-url-input')
            input?.focus()
          }, 50)
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault()
          playHapticClick()
          setSidebarOpen((prev) => !prev)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    // Suppress Chromium/Edge right-click browser menu on non-input UI elements
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (!isInput) {
        e.preventDefault()
      }
    }
    // Guard against unwanted webview navigation on drag-drop
    const handleDragOver = (e: DragEvent) => e.preventDefault()
    const handleDrop = (e: DragEvent) => e.preventDefault()

    window.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [])

  // Topbar unified 120 FPS pointer drag handlers (buttery smooth in both browser & native Windows)
  const handleTopBarPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (isMaximized || e.button !== 0) return

    const target = e.target as HTMLElement
    if (target.closest('button, a, input, [role="button"], .window-controls, .sidebar-toggle-btn')) {
      return
    }

    if (isNative) {
      // In native Tauri: data-tauri-drag-region invokes the OS window manager.
      // We start active 16ms parallax tracking to move the wallpaper in real-time with the window!
      startNativeDragSync()
      return
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}

    dragRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      origX: windowPos.x,
      origY: windowPos.y,
    }
    currentPosRef.current = { x: dragRef.current.origX, y: dragRef.current.origY }

    setIsDragging(true)
    document.body.classList.add('is-browser-dragging')
  }

  const handleTopBarPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (isNative) return
    if (!isDragging) return

    const deltaX = e.screenX - dragRef.current.startX
    const deltaY = e.screenY - dragRef.current.startY

    const maxClampX = Math.max(100, window.innerWidth / 2 - 120)
    const maxClampY = Math.max(80, window.innerHeight / 2 - 60)

    const nextX = Math.max(-maxClampX, Math.min(maxClampX, dragRef.current.origX + deltaX))
    const nextY = Math.max(-maxClampY, Math.min(maxClampY, dragRef.current.origY + deltaY))

    currentPosRef.current = { x: nextX, y: nextY }

    if (windowContainerRef.current) {
      windowContainerRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`
      const { parallaxX, parallaxY } = computeNormalizedParallax(nextX, nextY, true)
      windowContainerRef.current.style.setProperty('--bg-parallax-x', `${parallaxX}px`)
      windowContainerRef.current.style.setProperty('--bg-parallax-y', `${parallaxY}px`)
    }
  }

  const handleTopBarPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (isNative) {
      stopNativeDragSync()
      return
    }
    if (!isDragging) return
    setIsDragging(false)
    document.body.classList.remove('is-browser-dragging')

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    setWindowPos(currentPosRef.current)
  }

  const handleTopBarDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, [role="button"], .window-controls, .sidebar-toggle-btn')) {
      return
    }
    if (isNative) {
      toggleMaximizeWindow().then((max) => setIsMaximized(max))
    } else {
      setIsMaximized((prev) => !prev)
    }
  }

  const activeIndex = Math.max(0, NAV_ITEMS.findIndex((item) => item.id === activeNav))

  // The browser is built on its first visit and kept afterwards (its page survives tab switches).
  const [browserMounted, setBrowserMounted] = useState(false)
  if (activeNav === 'browser' && !browserMounted) setBrowserMounted(true)

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    const handle = idle(() => {
      void loadLibrary()
      void loadSettings()
      void loadBrowser()
    })
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle)
  }, [])

  const currentWallpaperObj = wallpapersList.find((w) => w.url === browserWallpaper) || SIMULATOR_WALLPAPERS[0]
  const prevWallpaperObj = prevWallpaper ? wallpapersList.find((w) => w.url === prevWallpaper) : null
  const frostedBgUrl = currentWallpaperObj?.frostedUrl || browserWallpaper
  const prevFrostedBgUrl = prevWallpaperObj?.frostedUrl || prevWallpaper

  useEffect(() => {
    const theme = currentWallpaperObj?.theme || 'dark'
    document.documentElement.setAttribute('data-wallpaper-theme', theme)
  }, [currentWallpaperObj])

  return (
    <div className="hyperstream-root-wrapper">
      {/* Desktop wallpaper simulation backdrop — strictly for browser preview */}
      {!isNative && (
        <div className="hyperstream-wallpaper-container" aria-hidden="true">
          {prevWallpaper && isTransitioningWallpaper && (
            <div
              className="hyperstream-wallpaper-backdrop prev"
              style={{
                backgroundImage: `url("${prevWallpaper}")`,
              }}
              aria-hidden="true"
            />
          )}
          <div
            key={browserWallpaper}
            className={`hyperstream-wallpaper-backdrop ${isTransitioningWallpaper ? 'wallpaper-fade-enter' : ''}`}
            style={{
              backgroundImage: `url("${browserWallpaper}")`,
            }}
            aria-hidden="true"
          />
        </div>
      )}

      <div
        ref={windowContainerRef}
        data-wallpaper-theme={currentWallpaperObj?.theme || 'dark'}
        data-wallpaper-id={currentWallpaperObj?.id || 'neon-waves'}
        className={`window-container ${isMaximized ? 'is-maximized' : ''} ${isPotatoMode ? 'potato-mode' : ''} ${isBloomEnabled ? '' : 'bloom-disabled'} ${isWindowFocused ? 'is-focused' : 'is-unfocused'} ${isDragging ? 'is-dragging' : ''}`}
        style={{
          transform: !isNative && !isMaximized && (windowPos.x !== 0 || windowPos.y !== 0)
            ? `translate3d(${windowPos.x}px, ${windowPos.y}px, 0)`
            : undefined,
          ['--potato-bg-url' as string]: `url("${frostedBgUrl}")`,
          ...(!isNative ? {
            ['--bg-parallax-x' as string]: `${computeNormalizedParallax(windowPos.x, windowPos.y, true).parallaxX}px`,
            ['--bg-parallax-y' as string]: `${computeNormalizedParallax(windowPos.x, windowPos.y, true).parallaxY}px`,
            ['--screen-width' as string]: '100vw',
            ['--screen-height' as string]: '100vh',
          } : {}),
        }}
      >
        {/* Optical Glass Base Layer with Interactive Drag Parallax & Unified Blur */}
        <div className="window-backdrop-layer" aria-hidden="true">
          {prevFrostedBgUrl && isTransitioningWallpaper && (
            <div
              className="wallpaper-parallax-bg prev"
              style={{
                backgroundImage: `url("${prevFrostedBgUrl}")`,
              }}
              aria-hidden="true"
            />
          )}
          <div
            key={browserWallpaper}
            className={`wallpaper-parallax-bg ${isTransitioningWallpaper ? 'wallpaper-fade-enter' : ''}`}
            style={{
              backgroundImage: `url("${frostedBgUrl}")`,
            }}
            aria-hidden="true"
          />
          {/* Unified, Window-Wide Beautiful Optical Frosted Glass Layer */}
          <div className="window-glass-frosted-overlay" aria-hidden="true" />
        </div>
      {(() => {
        const windowControlsElement = (
          <div className="window-controls">
            <button
              className="win-btn"
              aria-label="Minimize"
              type="button"
              tabIndex={-1}
              onClick={() => {
                playHapticClick()
                minimizeWindow()
              }}
            >
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              className="win-btn"
              aria-label={isMaximized ? 'Restore Down' : 'Maximize'}
              title={isMaximized ? 'Restore Down' : 'Maximize'}
              type="button"
              onClick={async () => {
                playHapticClick()
                if (isNative) {
                  const max = await toggleMaximizeWindow()
                  setIsMaximized(max)
                } else {
                  setIsMaximized((prev) => !prev)
                }
              }}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 1.5H8.5V7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                  <rect x="1.5" y="3" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>
            <button
              className="win-btn close"
              aria-label="Close"
              type="button"
              tabIndex={-1}
              onClick={() => {
                playHapticClick()
                closeWindow()
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )

        const sidebarAreaElement = (
          <div className={`topbar-sidebar-area ${sidebarOpen ? 'open' : 'closed'}`} data-tauri-drag-region>
            <div className="topbar-brand" data-tauri-drag-region>
              <span className="topbar-logo" data-tauri-drag-region>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm2 .5v8h8V4H4z" opacity="0.3"/>
                  <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h3A1.5 1.5 0 0 1 11 6.5v3A1.5 1.5 0 0 1 9.5 11h-3A1.5 1.5 0 0 1 5 9.5v-3z" />
                </svg>
              </span>
              <span className="app-title" data-tauri-drag-region>HyperStream</span>
            </div>

            <button
              type="button"
              className={`sidebar-toggle-btn ${sidebarOpen ? 'open' : 'closed'}`}
              onClick={() => {
                playHapticClick()
                setSidebarOpen((prev) => !prev)
              }}
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sidebar-toggle-svg">
                <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
                <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d={sidebarOpen ? 'M10.5 6L8.5 8L10.5 10' : 'M8.5 6L10.5 8L8.5 10'}
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )

        const isUnifiedBrowserMode = activeNav === 'browser' && !sidebarOpen

        return (
          <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${isUnifiedBrowserMode ? 'is-browser-full-mode' : ''}`}>
            {/* Topbar: Rendered in standard mode for Hub, Library, Settings, and browser when sidebar is open */}
            {!isUnifiedBrowserMode && (
              <header
                className="topbar"
                data-tauri-drag-region
                onPointerDown={handleTopBarPointerDown}
                onPointerMove={handleTopBarPointerMove}
                onPointerUp={handleTopBarPointerUp}
                onPointerCancel={handleTopBarPointerUp}
                onDoubleClick={handleTopBarDoubleClick}
              >
                {sidebarAreaElement}
                <div className="topbar-drag-spacer" data-tauri-drag-region />
                {windowControlsElement}
              </header>
            )}

        {/* Sidebar with jelly sliding glass pill & bottom utility dock */}
        <nav className="sidebar" aria-label="Main Navigation">
          <div className="sidebar-nav-items">
            <div
              className="nav-jelly-indicator"
              style={{
                transform: `translateY(${activeIndex * 40}px)`,
              }}
            />
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
                  onClick={() => {
                    playHapticSwoosh()
                    setActiveNav(item.id)
                  }}
                >
                  <span className="nav-item-icon">
                    <Icon size={15} />
                  </span>
                  <span className="nav-item-label">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content pane with jelly-smooth entrance on tab switch */}
        <main className="content-pane">
          {/* The Hub stays mounted so a pasted link, its options and messages survive tab switches. */}
          <div
            className="hub-view-container jelly-content"
            style={activeNav === 'hub' ? undefined : { display: 'none' }}
          >
              <StreamHub
                initialUrl={browserHandoffUrl}
                onUrlConsumed={() => setBrowserHandoffUrl('')}
                onOpenInBrowser={(url) => {
                  setBrowserRequest({ url, nonce: Date.now() })
                  setActiveNav('browser')
                }}
                onOpenLibrary={() => setActiveNav('library')}
              />
          </div>
          {activeNav === 'library' && (
            <div key="library" className="hub-view-container jelly-content">
              <Suspense fallback={null}>
                <MediaLibrary />
              </Suspense>
            </div>
          )}
          {activeNav === 'settings' && (
            <div key="settings" className="hub-view-container jelly-content">
              <Suspense fallback={null}>
              <Settings
                isPotatoMode={isPotatoMode}
                onTogglePotatoMode={handleTogglePotatoMode}
                isBloomEnabled={isBloomEnabled}
                onToggleBloom={handleToggleBloom}
                audioMuted={audioMuted}
                onToggleAudio={() => {
                  const next = toggleHapticAudio()
                  if (!next) playHapticGlass()
                }}
                currentWallpaper={browserWallpaper}
                onSelectWallpaper={handleSelectWallpaper}
                wallpapers={wallpapersList}
                onAddCustomWallpaper={handleAddCustomWallpaper}
                onDeleteCustomWallpaper={handleDeleteCustomWallpaper}
              />
              </Suspense>
            </div>
          )}
          {browserMounted && (
          <div
            className="hub-view-container browser-view-wrapper"
            style={{
              display: activeNav === 'browser' ? 'flex' : 'none',
              height: '100%',
              width: '100%',
            }}
          >
            <Suspense fallback={null}>
            <InAppBrowser
              navigateRequest={browserRequest}
              onOpenInHub={(url) => {
                setBrowserHandoffUrl(url)
                setActiveNav('hub')
              }}
              isWorkspaceActive={activeNav === 'browser'}
              isMaximized={isMaximized}
              isSidebarOpen={sidebarOpen}
              sidebarArea={isUnifiedBrowserMode ? sidebarAreaElement : undefined}
              windowControls={isUnifiedBrowserMode ? windowControlsElement : undefined}
              onTopBarPointerDown={isUnifiedBrowserMode ? handleTopBarPointerDown : undefined}
              onTopBarPointerMove={isUnifiedBrowserMode ? handleTopBarPointerMove : undefined}
              onTopBarPointerUp={isUnifiedBrowserMode ? handleTopBarPointerUp : undefined}
              onTopBarDoubleClick={isUnifiedBrowserMode ? handleTopBarDoubleClick : undefined}
            />
            </Suspense>
          </div>
          )}
        </main>
      </div>
    )
  })()}
    </div>

      {/* Browser-preview-only dev controls; the native app picks wallpapers in Settings. */}
      {!isNative && (
      <aside className="browser-simulator-dock" aria-label="Wallpaper and Display Controls">
        <span className="sim-tag">Wallpaper:</span>
        {wallpapersList.map((wp) => (
          <button
            key={wp.id}
            type="button"
            className={`sim-btn ${browserWallpaper === wp.url ? 'active' : ''}`}
            onClick={() => {
              playHapticClick()
              handleSelectWallpaper(wp.url)
            }}
          >
            {wp.name}
          </button>
        ))}
        {!isNative && (windowPos.x !== 0 || windowPos.y !== 0) && (
          <button
            type="button"
            className="sim-btn"
            title="Reset window position to center"
            onClick={() => {
              playHapticClick()
              setWindowPos({ x: 0, y: 0 })
            }}
          >
            Center
          </button>
        )}
        {!isNative && (
          <button
            type="button"
            className="sim-btn sim-btn-toggle"
            onClick={() => {
              playHapticClick()
              setIsMaximized((prev) => !prev)
            }}
          >
            {isMaximized ? 'Floating Window' : 'Full Screen'}
          </button>
        )}
      </aside>
      )}
  </div>
)
}
