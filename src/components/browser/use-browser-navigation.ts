import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  isTauri,
  browserBack,
  browserForward,
  browserNavigate,
  browserReload,
  browserState,
  browserStop,
  type BrowserNavState,
  type BrowserRect,
} from '@/lib/tauri-bridge'

export const BLANK = 'about:blank'

export interface BrowserNavigation {
  /** about:blank while the start page shows. */
  currentUrl: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  navigate: (url: string) => void
  back: () => void
  forward: () => void
  /** Reloads, or stops a page that is still loading. */
  reloadOrStop: () => void
  home: () => void
}

interface Pending {
  url: string
  /** Address shown when the navigation was requested; a change means it took effect. */
  from: string
}

const normalize = (url: string | undefined) => (url && url.length > 0 ? url : BLANK)

/**
 * Desktop: the page's real history, address, title and loading state, pushed by the backend.
 * The start page is shown over the page (which stays loaded), so Back from it returns there.
 * Browser preview (no native page): a simple in-memory history.
 */
export function useBrowserNavigation(
  initialUrl: string,
  getBounds: () => BrowserRect | undefined,
): BrowserNavigation {
  const native = isTauri()
  const initial = normalize(initialUrl)

  // ----- Desktop -----
  const [nav, setNav] = useState<BrowserNavState>({
    url: BLANK,
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: false,
  })
  const [pending, setPending] = useState<Pending | null>(null)
  const [atHome, setAtHome] = useState(true)
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending

  useEffect(() => {
    if (!native) return
    let disposed = false
    let unlisten: (() => void) | undefined
    const apply = (state: BrowserNavState) => {
      const next = { ...state, url: normalize(state.url) }
      setNav(next)
      const p = pendingRef.current
      // Settled once the address changed, or the attempt finished (it may have been cancelled).
      if (p && next.url !== BLANK && (next.url !== p.from || !next.loading)) setPending(null)
    }
    listen<BrowserNavState>('browser-state', (e) => apply(e.payload))
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch(() => {})
    browserState()
      .then((state) => {
        if (!disposed && state && !pendingRef.current) apply(state)
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [native])

  // ----- Browser preview -----
  const [local, setLocal] = useState({ stack: [initial], index: 0 })
  const localUrl = local.stack[Math.min(local.index, local.stack.length - 1)] ?? BLANK

  const hasPage = nav.url !== BLANK
  const currentUrl = native ? (pending?.url ?? (atHome || !hasPage ? BLANK : nav.url)) : localUrl

  const navigate = useCallback(
    (target: string) => {
      const url = normalize(target.trim())
      if (!native) {
        setLocal((prev) => {
          if (prev.stack[prev.index] === url) return prev
          const stack = [...prev.stack.slice(0, prev.index + 1), url]
          return { stack, index: stack.length - 1 }
        })
        return
      }
      if (url === BLANK) {
        setPending(null)
        setAtHome(true)
        return
      }
      setAtHome(false)
      setPending({ url, from: nav.url })
      browserNavigate(url, getBounds()).catch(() => setPending(null))
    },
    [native, nav.url, getBounds],
  )

  // A page opened from elsewhere (e.g. "Open in Browser") before this view existed.
  const openedInitial = useRef(false)
  useEffect(() => {
    if (!native || openedInitial.current || initial === BLANK) return
    openedInitial.current = true
    navigate(initial)
  }, [native, initial, navigate])

  const home = useCallback(() => navigate(BLANK), [navigate])

  const back = useCallback(() => {
    if (!native) {
      setLocal((prev) => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev))
      return
    }
    if (currentUrl === BLANK) {
      if (hasPage) setAtHome(false)
    } else if (nav.canGoBack) {
      void browserBack()
    } else {
      setPending(null)
      setAtHome(true)
    }
  }, [native, currentUrl, hasPage, nav.canGoBack])

  const forward = useCallback(() => {
    if (!native) {
      setLocal((prev) => (prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev))
      return
    }
    if (currentUrl !== BLANK) void browserForward()
  }, [native, currentUrl])

  const isLoading = native && currentUrl !== BLANK && (nav.loading || pending !== null)

  const reloadOrStop = useCallback(() => {
    if (!native || currentUrl === BLANK) return
    if (isLoading) {
      void browserStop()
      setPending(null)
    } else {
      void browserReload()
    }
  }, [native, currentUrl, isLoading])

  if (!native) {
    return {
      currentUrl: localUrl,
      title: '',
      canGoBack: local.index > 0,
      canGoForward: local.index < local.stack.length - 1,
      isLoading: false,
      navigate,
      back,
      forward,
      reloadOrStop,
      home,
    }
  }

  const onHome = currentUrl === BLANK
  return {
    currentUrl,
    title: !onHome && currentUrl === nav.url ? nav.title : '',
    canGoBack: onHome ? hasPage : true,
    canGoForward: !onHome && nav.canGoForward,
    isLoading,
    navigate,
    back,
    forward,
    reloadOrStop,
    home,
  }
}
