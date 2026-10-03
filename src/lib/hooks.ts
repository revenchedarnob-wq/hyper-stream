import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { loadSettings, subscribeSettings, type AppSettings } from './settings'
import {
  ensureEngine,
  errorMessage,
  getEngineStatus,
  getLibrary,
  isTauri,
  updateEngine,
  type EngineSetupProgress,
  type EngineStatus,
  type LibraryItem,
} from './tauri-bridge'

export function useSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  useEffect(() => subscribeSettings(setSettings), [])
  return settings
}

/** Library items, refreshed whenever the backend reports a change. */
export function useLibrary(): { items: LibraryItem[]; loaded: boolean; refresh: () => Promise<void> } {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    setItems(await getLibrary())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    listen('library-changed', () => void refresh()).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [refresh])

  return { items, loaded, refresh }
}

export interface EngineState {
  status: EngineStatus | null
  /** True while installing or updating components. */
  busy: boolean
  progress: EngineSetupProgress | null
  error: string | null
  install: () => Promise<void>
  update: () => Promise<void>
}

// One install per app session, shared by every view that asks for it.
let installPromise: Promise<EngineStatus> | null = null

export function useEngine({ autoInstall = false } = {}): EngineState {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<EngineSetupProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (task: () => Promise<EngineStatus>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await task())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [])

  const install = useCallback(async () => {
    installPromise ??= ensureEngine().finally(() => {
      installPromise = null
    })
    await run(() => installPromise!)
  }, [run])

  const update = useCallback(() => run(updateEngine), [run])

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    listen<EngineSetupProgress>('engine-setup-progress', (e) => setProgress(e.payload)).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })

    getEngineStatus().then((s) => {
      if (disposed) return
      setStatus(s)
      if (s && !s.all_ready && autoInstall) void install()
      else if (installPromise) void run(() => installPromise!)
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [autoInstall, install, run])

  return { status, busy, progress, error, install, update }
}
