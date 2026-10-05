/**
 * HyperStream Native Tauri v2 Bridge
 * Unifies window controls, system vitals, and IPC communication
 * with seamless fallbacks for browser development and testing.
 */

import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition } from '@tauri-apps/api/dpi'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Minimize the native application window.
 */
export async function minimizeWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await getCurrentWindow().minimize()
    } catch (err) {
      console.warn('Tauri minimize error:', err)
    }
  }
}

/**
 * Toggle maximize / restore for the native application window.
 */
export async function toggleMaximizeWindow(): Promise<boolean> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      await win.toggleMaximize()
      return await win.isMaximized()
    } catch (err) {
      console.warn('Tauri toggleMaximize error:', err)
      return false
    }
  }
  return false
}

/**
 * Close the native application window or quit the app.
 */
export async function closeWindow(): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('exit_app')
    } catch {
      try {
        await getCurrentWindow().close()
      } catch (err) {
        console.warn('Tauri close error:', err)
      }
    }
  }
}


/**
 * Open Windows File Explorer with the specific file selected.
 */
/** Folder of the HyperStream browser extension, for loading it into Chrome or Edge. */
export async function getBrowserExtensionFolder(): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('browser_extension_folder')
}

export interface ExtensionStatus {
  /** The browser Windows opens links with. */
  browser: { id: string; name: string } | null
  /** The extension works in that browser (Chrome, Edge, Brave…). */
  supported: boolean
  /** The extension has connected from that browser. */
  installed: boolean
  /** Its store page is available, so adding it is one click in the browser. */
  store: boolean
  folder: string | null
}

export async function getExtensionStatus(): Promise<ExtensionStatus | null> {
  if (!isTauri()) return null
  return invoke<ExtensionStatus>('browser_extension_status')
}

/** Opens the extension's store page; without a listing, returns what the manual steps need. */
export async function addBrowserExtension(): Promise<{
  mode: 'store' | 'manual'
  folder: string | null
  extensions_page: string | null
}> {
  return invoke('add_browser_extension')
}

export async function revealInExplorer(filePath: string): Promise<void> {
  if (!isTauri()) return
  await invoke('reveal_in_explorer', { path: filePath })
}

/** True when the native window is maximized (also after Win+Up, snapping or a title-bar double-click). */
/** Whether one of the app's windows is in front (focus inside the built-in browser counts). */
export async function isAppForeground(): Promise<boolean> {
  if (!isTauri()) return document.hasFocus()
  try {
    return await invoke<boolean>('is_app_foreground')
  } catch {
    return false
  }
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await getCurrentWindow().isMaximized()
  } catch {
    return false
  }
}

export interface SystemVitalsData {
  /** MB/s across running downloads. */
  throughput: number
  activeTransfers: number
  /** Free space on the drive holding the download folder. */
  storageFreeGb: number
  storageTotalGb: number
  storagePercentage: number
}

/**
 * Throughput and free space on the download drive.
 */
export async function getSystemVitals(downloadDir?: string): Promise<SystemVitalsData | null> {
  if (!isTauri()) return null
  try {
    return await invoke<SystemVitalsData>('get_system_vitals', { downloadDir: downloadDir || null })
  } catch (err) {
    console.warn('get_system_vitals error:', err)
    return null
  }
}

/**
 * Sync Windows 11 DWM accent color into a CSS variable --windows-accent.
 */
export async function syncWindowsAccentColor(): Promise<void> {
  if (isTauri()) {
    try {
      const accent = await invoke<string>('get_windows_accent_color')
      if (accent) {
        document.documentElement.style.setProperty('--windows-accent', accent)
      }
    } catch {
      // Fallback to default
    }
  }
}

/**
 * Open native Windows directory picker dialog and return the selected path.
 */
export async function pickStorageFolder(): Promise<string | null> {
  if (isTauri()) {
    try {
      const selected = await invoke<string | null>('pick_storage_folder')
      return selected || null
    } catch (err) {
      console.warn('Tauri pick_storage_folder error:', err)
    }
  }
  return null
}

/**
 * Listen for native window move events from Tauri backend.
 * Fires in real time as the user drags the native window across the desktop.
 * Returns an unlisten function.
 */
export async function listenWindowMoved(
  callback: (x: number, y: number) => void
): Promise<() => void> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      const unlisten = await win.onMoved(({ payload: position }) => {
        const dpr = window.devicePixelRatio || 1
        const logicalX = position.x / dpr
        const logicalY = position.y / dpr
        callback(logicalX, logicalY)
      })
      return unlisten
    } catch (err) {
      console.warn('Tauri onMoved error:', err)
    }
  }
  return () => {}
}

/**
 * Listen for native window resize events from Tauri backend.
 * Returns an unlisten function.
 */
export async function listenWindowResized(
  callback: (width: number, height: number) => void
): Promise<() => void> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      const unlisten = await win.onResized(({ payload: size }) => {
        const dpr = window.devicePixelRatio || 1
        callback(size.width / dpr, size.height / dpr)
      })
      return unlisten
    } catch (err) {
      console.warn('Tauri onResized error:', err)
    }
  }
  return () => {}
}

/**
 * Query current native window outer position in logical CSS coordinates.
 */
export async function getWindowPosition(): Promise<{ x: number; y: number } | null> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      const pos = await win.outerPosition()
      const dpr = window.devicePixelRatio || 1
      return {
        x: pos.x / dpr,
        y: pos.y / dpr,
      }
    } catch (err) {
      console.warn('Tauri getWindowPosition error:', err)
    }
  }
  return null
}

/**
 * Move the native application window to a logical coordinate.
 */
export async function setWindowPosition(x: number, y: number): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)))
    } catch (err) {
      console.warn('Tauri setPosition error:', err)
    }
  }
}

/**
 * Initiate native OS window drag.
 */
export async function startDraggingWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const win = getCurrentWindow()
      await win.startDragging()
    } catch (err) {
      console.warn('Tauri startDragging error:', err)
    }
  }
}

/** Normalizes a Tauri command rejection into a readable message. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

export interface NativeAudioTrack {
  language: string
  note: string
  is_original: boolean
}

export interface NativeSubtitleTrack {
  language: string
  name: string
}

export interface NativePlaylistEntry {
  url: string
  title: string
  duration?: number | null
}

export interface NativeMediaMetadata {
  id: string
  title: string
  uploader?: string | null
  extractor?: string | null
  duration?: number | null
  thumbnail?: string | null
  webpage_url: string
  is_live: boolean
  /** Available video sizes, largest first. Empty for audio-only sources. */
  resolutions: { width: number; height: number }[]
  has_audio: boolean
  /** Only filled when the source has more than one audio language. */
  audio_tracks: NativeAudioTrack[]
  subtitles: NativeSubtitleTrack[]
  /** Non-empty when the link is a playlist or channel. */
  entries: NativePlaylistEntry[]
}

export interface NativeDownloadOptions {
  url: string
  title: string
  max_height?: number | null
  audio_only?: boolean
  audio_languages?: string[]
  subtitles?: string[]
  output_dir?: string | null
  prefer_compatible?: boolean
  thumbnail?: string | null
  duration?: number | null
  uploader?: string | null
  extractor?: string | null
}

export type NativeDownloadState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'remuxing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface NativeDownloadProgress {
  task_id: string
  title: string
  state: NativeDownloadState
  progress_percent: number
  speed_bytes_per_sec: number
  downloaded_bytes: number
  total_bytes?: number | null
  eta_seconds?: number | null
  stage: string
  output_path?: string | null
  error_message?: string | null
  source_url: string
  thumbnail?: string | null
  quality_label?: string | null
  container?: string | null
  audio_only: boolean
  created_at: number
}

export interface NativeQueueConfig {
  max_concurrent: number
  max_retries: number
  retry_backoff_ms: number
}

export interface NativeQueueChangedPayload {
  order: string[]
  running: number
  max_concurrent: number
}

export interface LibraryItem {
  id: string
  title: string
  file_path: string
  source_url: string
  thumbnail_path?: string | null
  uploader?: string | null
  extractor?: string | null
  duration?: number | null
  width?: number | null
  height?: number | null
  size_bytes: number
  added_at: number
  kind: 'video' | 'audio'
  container: string
  audio_languages: string[]
  subtitle_languages: string[]
  missing: boolean
}

export interface EngineComponentStatus {
  name: string
  path?: string | null
  version?: string | null
  available: boolean
  managed: boolean
}

export interface EngineStatus {
  ytdlp: EngineComponentStatus
  ffmpeg: EngineComponentStatus
  /** Optional JavaScript runtime that unlocks every YouTube format. */
  deno?: EngineComponentStatus
  all_ready: boolean
}

export interface EngineSetupProgress {
  component: string
  downloaded: number
  total?: number | null
}

/** Probes a link. Rejects with a readable message when the link can't be used. */
export async function queryMediaInfo(url: string): Promise<NativeMediaMetadata> {
  if (!isTauri()) throw new Error('Downloading is only available in the desktop app.')
  return await invoke<NativeMediaMetadata>('query_media_info', { url })
}

/** Starts looking a link up in the background; a later `queryMediaInfo` finds it done. */
export function prefetchMediaInfo(url: string): void {
  if (!isTauri()) return
  void invoke('prefetch_media_info', { url }).catch(() => {})
}

/** Chooses formats for a download the user is looking at, so starting it skips that step. */
export function prepareDownload(options: NativeDownloadOptions): void {
  if (!isTauri()) return
  void invoke('prepare_download', { options }).catch(() => {})
}

/** Queues a download and returns its task id. Rejects with a readable message. */
export async function startDownload(options: NativeDownloadOptions, priority?: number): Promise<string> {
  if (!isTauri()) throw new Error('Downloading is only available in the desktop app.')
  return await invoke<string>('start_universal_download', { options, priority: priority ?? null })
}

export async function getActiveDownloads(): Promise<NativeDownloadProgress[]> {
  if (!isTauri()) return []
  try {
    return await invoke<NativeDownloadProgress[]>('get_active_downloads')
  } catch (err) {
    console.warn('getActiveDownloads error:', err)
    return []
  }
}

async function command(name: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri()) return
  await invoke(name, args)
}

export const pauseDownload = (taskId: string) => command('pause_download', { taskId })
export const resumeDownload = (taskId: string) => command('resume_download', { taskId })
export const cancelDownload = (taskId: string) => command('cancel_download', { taskId })
export const retryDownload = (taskId: string) => command('retry_download', { taskId })
export const removeDownload = (taskId: string) => command('remove_download', { taskId })
export const moveDownload = (taskId: string, direction: 'up' | 'down') => command('move_download', { taskId, direction })
export const pauseAll = () => command('pause_all')
export const resumeAll = () => command('resume_all')
export const openMediaFile = (path: string) => command('open_media_file', { path })

export async function clearFinished(): Promise<number> {
  if (!isTauri()) return 0
  return await invoke<number>('clear_finished')
}

export async function getQueueConfig(): Promise<NativeQueueConfig | null> {
  if (!isTauri()) return null
  try {
    return await invoke<NativeQueueConfig>('get_queue_config')
  } catch (err) {
    console.warn('getQueueConfig error:', err)
    return null
  }
}

/** One limit for all downloads together; see `SpeedLimit` in settings. */
export async function setSpeedLimit(limit: 'off' | 'auto' | number): Promise<void> {
  if (!isTauri()) return
  const payload = typeof limit === 'number' ? { mode: 'fixed', bytes_per_sec: Math.round(limit * 1_000_000) } : { mode: limit }
  await invoke('set_speed_limit', { limit: payload })
}

export async function setMaxConcurrent(maxConcurrent: number): Promise<void> {
  const current = await getQueueConfig()
  if (!current) return
  await invoke('set_queue_config', { config: { ...current, max_concurrent: maxConcurrent } })
}

export async function getLibrary(): Promise<LibraryItem[]> {
  if (!isTauri()) return []
  try {
    return await invoke<LibraryItem[]>('get_library')
  } catch (err) {
    console.warn('getLibrary error:', err)
    return []
  }
}

export async function removeLibraryItem(id: string, deleteFile: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('remove_library_item', { id, deleteFile })
}

export async function getDefaultDownloadDir(): Promise<string> {
  if (!isTauri()) return ''
  try {
    return await invoke<string>('get_default_download_dir')
  } catch {
    return ''
  }
}

export async function getEngineStatus(): Promise<EngineStatus | null> {
  if (!isTauri()) return null
  try {
    return await invoke<EngineStatus>('get_engine_binary_status')
  } catch (err) {
    console.warn('getEngineStatus error:', err)
    return null
  }
}

/** Installs missing engine components. Progress arrives as `engine-setup-progress` events. */
export async function ensureEngine(): Promise<EngineStatus> {
  return await invoke<EngineStatus>('ensure_engine_binaries')
}

export async function updateEngine(): Promise<EngineStatus> {
  return await invoke<EngineStatus>('update_engine')
}

// ---------- Built-in browser ----------

/** What the browser page is showing; arrives as `browser-state` whenever it changes. */
export interface BrowserNavState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export interface BrowserRect {
  x: number
  y: number
  width: number
  height: number
}

export const browserNavigate = (url: string, bounds?: BrowserRect) => command('navigate_browser', { url, bounds })
export const browserSetBounds = (rect: BrowserRect) => command('update_browser_bounds', { ...rect })
export const browserSetVisible = (visible: boolean, pauseMedia = false) =>
  command('set_browser_visibility', { visible, pauseMedia })
export const browserBack = () => command('browser_go_back')
export const browserForward = () => command('browser_go_forward')
export const browserReload = () => command('browser_reload')
export const browserStop = () => command('browser_stop')
export const browserSetShields = (enabled: boolean, allowedSites: string[]) =>
  command('browser_set_shields', { enabled, allowedSites })

export async function getBrowserZoom(): Promise<number> {
  if (!isTauri()) return 1.0
  try {
    return (await invoke<number>('get_browser_zoom')) ?? 1.0
  } catch {
    return 1.0
  }
}

export async function setBrowserZoom(factor: number): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('set_browser_zoom', { factor })
  } catch {}
}

export async function browserFindInPage(query: string, backwards = false): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('browser_find_in_page', { query, backwards })
  } catch {}
}

export async function browserState(): Promise<BrowserNavState | null> {
  if (!isTauri()) return null
  return (await invoke<BrowserNavState | null>('browser_state')) ?? null
}

/** A picture of the current page (JPEG data URL), or null when there's no page. */
export async function browserSnapshot(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string | null>('browser_snapshot')
  } catch {
    return null
  }
}

export type TaskbarProgress = { status: 'none' } | { status: 'normal' | 'paused' | 'indeterminate'; percent: number }

/** Download progress on the app's taskbar button. */
export async function setTaskbarProgress(p: TaskbarProgress): Promise<void> {
  if (!isTauri()) return
  const status = {
    none: ProgressBarStatus.None,
    normal: ProgressBarStatus.Normal,
    paused: ProgressBarStatus.Paused,
    indeterminate: ProgressBarStatus.Indeterminate,
  }[p.status]
  try {
    await getCurrentWindow().setProgressBar(p.status === 'none' ? { status } : { status, progress: Math.round(p.percent) })
  } catch {
    // Older shells without taskbar progress: nothing to show.
  }
}

/** Overall progress of the active downloads, as the taskbar shows it. */
export function taskbarProgressFor(tasks: Pick<NativeDownloadProgress, 'state' | 'progress_percent'>[]): TaskbarProgress {
  const active = tasks.filter((t) => t.state === 'queued' || t.state === 'downloading' || t.state === 'remuxing' || t.state === 'paused')
  if (active.length === 0) return { status: 'none' }
  const percent = active.reduce((sum, t) => sum + (t.state === 'remuxing' ? 100 : t.progress_percent || 0), 0) / active.length
  const running = active.some((t) => t.state === 'downloading' || t.state === 'remuxing')
  if (running) return { status: 'normal', percent }
  if (active.every((t) => t.state === 'paused')) return { status: 'paused', percent }
  return { status: 'indeterminate', percent: 0 }
}

export interface ExternalLink {
  url: string
  /** Sent by the HyperStream extension. Links from web pages (`hyperstream://`) never are. */
  from_extension: boolean
}

/** Pages sent from other browsers (extension or `hyperstream://` link) since the last call, oldest first. */
export async function takeExternalLinks(): Promise<ExternalLink[]> {
  if (!isTauri()) return []
  try {
    return await invoke<ExternalLink[]>('take_external_links')
  } catch {
    return []
  }
}

/** Bookmark that sends the open page to HyperStream (drag to the bookmarks bar, or paste as a bookmark's URL). */
export const SEND_TO_HYPERSTREAM_BOOKMARKLET =
  "javascript:location.href='hyperstream://download?url='+encodeURIComponent(location.href)"

/** Starts the browser engine in the background so the first site opens instantly. */
export const prewarmBrowser = () => command('prewarm_browser')

/** The site's logo as a `data:` URL, fetched from the site once and cached on disk; null when it has none. */
export async function getSiteIcon(url: string): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return (await invoke<string | null>('site_icon', { url })) ?? null
  } catch {
    return null
  }
}

/** Signs out of every site in the built-in browser and clears its cache and history. */
export async function clearBrowsingData(): Promise<void> {
  if (!isTauri()) return
  await invoke('clear_browsing_data')
}

/** Requests Shields blocked on the current page. */
export async function browserShieldsStats(): Promise<number> {
  if (!isTauri()) return 0
  try {
    return await invoke<number>('browser_shields_stats')
  } catch {
    return 0
  }
}

export interface InstalledExtension {
  /** Folder name; stable across updates. */
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  /** data: URL */
  icon?: string | null
  hasOptions: boolean
  hasPopup: boolean
  store?: 'chrome' | 'edge' | null
  storeId?: string | null
  homepage?: string | null
  /** Why the browser couldn't run it. */
  error?: string | null
  /** Manifest V2, a format browsers are phasing out. */
  legacyFormat: boolean
}

export async function getInstalledExtensions(): Promise<InstalledExtension[]> {
  if (!isTauri()) return []
  return await invoke<InstalledExtension[]>('get_installed_extensions')
}

/** Installs from a Chrome Web Store / Edge Add-ons link or extension id. Returns the extension id. */
export async function installStoreExtension(input: string): Promise<string> {
  return await invoke<string>('install_store_extension', { input })
}

export const uninstallExtension = (extensionId: string) => command('uninstall_browser_extension', { extensionId })
export const setExtensionEnabled = (extensionId: string, enabled: boolean) =>
  command('set_extension_enabled', { extensionId, enabled })

export async function loadUnpackedExtension(sourcePath: string): Promise<string> {
  return await invoke<string>('load_unpacked_extension', { sourcePath })
}

/** Updates store extensions. Returns how many were updated. */
export async function updateExtensions(): Promise<number> {
  if (!isTauri()) return 0
  return await invoke<number>('update_browser_extensions')
}

/** chrome-extension:// address of an extension's settings page or popup. */
export async function extensionPageUrl(extensionId: string, page: 'options' | 'popup'): Promise<string> {
  return await invoke<string>('extension_page_url', { extensionId, page })
}
