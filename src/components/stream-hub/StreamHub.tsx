import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './stream-hub.css'
import { listen } from '@tauri-apps/api/event'
import { playHapticGlass } from '@/lib/sound'
import { TelemetryVitals } from './TelemetryVitals'
import { ActivePipeline } from './ActivePipeline'
import { RecentCaptures } from './RecentCaptures'
import { ManifestDropzone } from './ManifestDropzone'
import { Omnibar } from './Omnibar'
import { IconAlertCircle, IconLoader } from './Icons'
import {
  clearFinished,
  errorMessage,
  getActiveDownloads,
  getQueueConfig,
  getSystemVitals,
  isTauri,
  openMediaFile,
  pauseAll,
  pauseDownload,
  removeDownload,
  moveDownload,
  resumeAll,
  resumeDownload,
  retryDownload,
  revealInExplorer,
  setMaxConcurrent,
  setTaskbarProgress,
  startDownload,
  taskbarProgressFor,
  type LibraryItem,
  type NativeDownloadOptions,
  type NativeDownloadProgress,
  type NativeQueueChangedPayload,
  type SystemVitalsData,
} from '@/lib/tauri-bridge'
import { saveSettings } from '@/lib/settings'
import { formatBytes } from '@/lib/format'
import { useEngine, useLibrary, useSettings } from '@/lib/hooks'

export interface StreamHubProps {
  initialUrl?: string
  /** Queue `initialUrl` at the default quality as soon as it's looked up (single videos). */
  autoCaptureInitial?: boolean
  onUrlConsumed?: () => void
  onOpenInBrowser?: (url: string) => void
  onOpenLibrary?: () => void
}

const FINISHED = new Set(['completed', 'failed', 'cancelled'])

function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setToast({ text, tone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 5000 : 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { toast, show }
}

export const StreamHub: React.FC<StreamHubProps> = ({ initialUrl, autoCaptureInitial, onUrlConsumed, onOpenInBrowser, onOpenLibrary }) => {
  const settings = useSettings()
  const engine = useEngine({ autoInstall: true })
  const library = useLibrary()
  const { toast, show } = useToast()

  const [tasks, setTasks] = useState<NativeDownloadProgress[]>([])
  const [queueOrder, setQueueOrder] = useState<string[]>([])
  const [maxConcurrent, setMaxConcurrentState] = useState(settings.maxConcurrent)
  const [vitals, setVitals] = useState<SystemVitalsData | null>(null)

  const completionSoundRef = useRef(settings.completionSound)
  completionSoundRef.current = settings.completionSound

  // Removed tasks can still emit one last "cancelled" event; never let it re-add the card.
  const removedRef = useRef(new Set<string>())

  const upsert = useCallback((p: NativeDownloadProgress) => {
    if (removedRef.current.has(p.task_id)) return
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.task_id === p.task_id)
      if (idx === -1) return [...prev, p]
      const next = prev.slice()
      next[idx] = p
      return next
    })
  }, [])

  // Hydrate from the backend and subscribe to live updates.
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const unlisteners: Array<() => void> = []
    const track = (p: Promise<() => void>) =>
      p.then((fn) => {
        if (disposed) fn()
        else unlisteners.push(fn)
      })

    getActiveDownloads().then((list) => !disposed && setTasks(list))
    getQueueConfig().then((cfg) => {
      // Settings are the source of truth; the backend starts with its default after a restart.
      if (cfg && cfg.max_concurrent !== settings.maxConcurrent) {
        void setMaxConcurrent(settings.maxConcurrent)
      }
    })

    track(listen<NativeDownloadProgress>('download-progress', (e) => upsert(e.payload)))
    track(
      listen<NativeDownloadProgress>('download-complete', (e) => {
        upsert(e.payload)
        if (completionSoundRef.current) playHapticGlass()
      }),
    )
    track(listen<NativeDownloadProgress>('download-error', (e) => upsert(e.payload)))
    track(
      listen<NativeQueueChangedPayload>('download-queue-changed', (e) => {
        setQueueOrder(e.payload.order)
        setMaxConcurrentState(e.payload.max_concurrent)
      }),
    )

    return () => {
      disposed = true
      unlisteners.forEach((fn) => fn())
    }
    // Hydration runs once; settings.maxConcurrent is read at mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsert])

  // Free space on the download drive (cheap call; refresh occasionally).
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const refresh = () => getSystemVitals(settings.downloadDir).then((v) => !disposed && v && setVitals(v))
    void refresh()
    // Minimized or hidden: no wake-ups; catch up as soon as the window shows again.
    const timer = window.setInterval(() => !document.hidden && void refresh(), 15000)
    const onVisible = () => !document.hidden && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [settings.downloadDir, library.items.length])

  const act = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      try {
        await action()
        if (success) show(success)
      } catch (err) {
        show(errorMessage(err), 'error')
      }
    },
    [show],
  )

  const handleCapture = useCallback(
    async (requests: NativeDownloadOptions[]) => {
      for (const request of requests) {
        await startDownload(request)
      }
      show(requests.length === 1 ? `Added: ${requests[0].title}` : `Added ${requests.length} downloads`)
    },
    [show],
  )

  const handleLinks = useCallback(
    (urls: string[]) =>
      act(async () => {
        for (const url of urls) {
          await startDownload({
            url,
            title: '',
            max_height: /^\d+$/.test(settings.defaultQuality) ? Number(settings.defaultQuality) : null,
            audio_only: settings.defaultQuality === 'audio',
            output_dir: settings.downloadDir || null,
            prefer_compatible: settings.preferCompatible,
          })
        }
      }, `Added ${urls.length} link${urls.length === 1 ? '' : 's'}`),
    [act, settings.defaultQuality, settings.downloadDir, settings.preferCompatible],
  )

  const handleRemove = useCallback(
    (id: string) =>
      act(async () => {
        removedRef.current.add(id)
        setTasks((prev) => prev.filter((t) => t.task_id !== id))
        await removeDownload(id)
      }),
    [act],
  )

  const handleReorder = useCallback(
    (id: string, direction: 'up' | 'down') => void act(() => moveDownload(id, direction)),
    [act],
  )

  const handleMaxConcurrent = useCallback(
    (limit: number) => {
      setMaxConcurrentState(limit)
      saveSettings({ maxConcurrent: limit })
      void act(() => setMaxConcurrent(limit))
    },
    [act],
  )

  const handleClearFinished = useCallback(
    () =>
      act(async () => {
        await clearFinished()
        setTasks((prev) => {
          prev.filter((t) => FINISHED.has(t.state)).forEach((t) => removedRef.current.add(t.task_id))
          return prev.filter((t) => !FINISHED.has(t.state))
        })
      }),
    [act],
  )

  const openFile = useCallback((path?: string | null) => (path ? act(() => openMediaFile(path)) : undefined), [act])
  const revealFile = useCallback((path?: string | null) => (path ? act(() => revealInExplorer(path)) : undefined), [act])

  // Newest first; tasks from the backend carry their creation time.
  const orderedTasks = useMemo(() => tasks.slice().sort((a, b) => b.created_at - a.created_at), [tasks])
  const speed = tasks.reduce((sum, t) => sum + (t.state === 'downloading' ? t.speed_bytes_per_sec : 0), 0)
  const activeCount = tasks.filter((t) => t.state === 'downloading' || t.state === 'remuxing').length
  const queuedCount = tasks.filter((t) => t.state === 'queued').length
  const recent = library.items.slice(0, 5)

  // Mirror overall progress on the taskbar button; only whole-percent changes reach Windows.
  const taskbar = taskbarProgressFor(tasks)
  const taskbarKey = taskbar.status === 'none' ? 'none' : `${taskbar.status}:${Math.round(taskbar.percent)}`
  const taskbarRef = useRef(taskbar)
  taskbarRef.current = taskbar
  useEffect(() => {
    void setTaskbarProgress(taskbarRef.current)
  }, [taskbarKey])

  const engineReady = !!engine.status?.all_ready
  const engineLabel = !engine.status
    ? isTauri() ? 'Checking…' : 'Desktop only'
    : engineReady
      ? 'Ready'
      : engine.busy
        ? 'Setting up'
        : 'Not installed'

  const setupPercent =
    engine.progress?.total && engine.progress.total > 0
      ? Math.round((engine.progress.downloaded / engine.progress.total) * 100)
      : null

  return (
    <div className="stream-hub-container">
      {toast && (
        <div className={`hub-toast ${toast.tone === 'error' ? 'is-error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}

      <div className="stream-hub-content">
        <div className="stream-hub-header">
          <h1 className="stream-hub-title">Stream Hub</h1>
        </div>

        {isTauri() && engine.status && !engineReady && (
          <div className={`engine-setup-banner ${engine.error ? 'is-error' : ''}`} role="status">
            {engine.error ? (
              <>
                <IconAlertCircle size={14} />
                <span className="engine-setup-text">
                  Couldn’t install the download engine: {engine.error}
                </span>
                <button type="button" className="engine-setup-btn" onClick={() => void engine.install()}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <IconLoader size={14} className="omnibar-spin-icon" />
                <span className="engine-setup-text">
                  Setting up the download engine (one time)
                  {engine.progress
                    ? ` — ${engine.progress.component} ${setupPercent !== null ? `${setupPercent}%` : formatBytes(engine.progress.downloaded)}`
                    : '…'}
                </span>
                {setupPercent !== null && (
                  <div className="engine-setup-track" aria-hidden="true">
                    <div className="engine-setup-bar" style={{ width: `${setupPercent}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <Omnibar
          settings={settings}
          engineReady={engineReady || !isTauri()}
          onCapture={handleCapture}
          onOpenInBrowser={onOpenInBrowser}
          initialUrl={initialUrl}
          autoCaptureInitial={autoCaptureInitial}
          onUrlConsumed={onUrlConsumed}
        />

        <TelemetryVitals
          speedBytesPerSec={speed}
          activeCount={activeCount}
          queuedCount={queuedCount}
          storageFreeGb={vitals?.storageFreeGb}
          storagePercentage={vitals?.storagePercentage}
          engineLabel={engineLabel}
          engineDetail={engine.status ? `yt-dlp ${engine.status.ytdlp.version ?? 'missing'} · FFmpeg ${engine.status.ffmpeg.version ?? 'missing'}` : undefined}
        />

        <div className="hub-bento-split">
          <ActivePipeline
            tasks={orderedTasks}
            queueOrder={queueOrder}
            maxConcurrent={maxConcurrent}
            onMaxConcurrentChange={handleMaxConcurrent}
            onPauseAll={() => void act(pauseAll)}
            onResumeAll={() => void act(resumeAll)}
            onClearFinished={() => void handleClearFinished()}
            onPause={(id) => void act(() => pauseDownload(id))}
            onResume={(id) => void act(() => resumeDownload(id))}
            onRetry={(id) => void act(() => retryDownload(id))}
            onRemove={(id) => void handleRemove(id)}
            onOpen={(t) => void openFile(t.output_path)}
            onReveal={(t) => void revealFile(t.output_path)}
            onReorder={handleReorder}
          />

          <div className="hub-sidebar-aux">
            <RecentCaptures
              items={recent}
              onPlay={(item: LibraryItem) => void openFile(item.file_path)}
              onReveal={(item: LibraryItem) => void revealFile(item.file_path)}
              onShowAll={() => onOpenLibrary?.()}
            />
            <ManifestDropzone
              onLinks={(urls) => void handleLinks(urls)}
              onNoLinks={() => show('No links found. Use a text file with one link per line.', 'error')}
              disabled={isTauri() && !engineReady}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default StreamHub
