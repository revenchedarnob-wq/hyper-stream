/**
 * HyperStream Native Tauri v2 Bridge
 * Unifies window controls, system vitals, and IPC communication
 * with seamless fallbacks for browser development and testing.
 */

import { getCurrentWindow } from '@tauri-apps/api/window'
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
export async function revealInExplorer(filePath: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('reveal_in_explorer', { path: filePath })
    } catch (err) {
      console.warn('Tauri reveal_in_explorer error:', err)
    }
  }
}

export interface SystemVitalsData {
  throughput: number
  activeTransfers: number
  storageFreeGb: number
  storageTotalGb: number
  storagePercentage: number
  engineStatus: string
  nvmeFreeTb?: number
  nvmePercentage?: number
}

/**
 * Query real system storage and hardware vitals from Rust backend.
 */
export async function getSystemVitals(): Promise<SystemVitalsData | null> {
  if (isTauri()) {
    try {
      const raw = await invoke<any>('get_system_vitals')
      if (raw) {
        const freeGb = typeof raw.storageFreeGb === 'number'
          ? raw.storageFreeGb
          : (typeof raw.storage_free_gb === 'number'
              ? raw.storage_free_gb
              : ((raw.nvmeFreeTb ?? raw.nvme_free_tb ?? 0) * 1024))
        const totalGb = typeof raw.storageTotalGb === 'number'
          ? raw.storageTotalGb
          : (typeof raw.storage_total_gb === 'number' ? raw.storage_total_gb : 0)
        const percentage = typeof raw.storagePercentage === 'number'
          ? raw.storagePercentage
          : (raw.storage_percentage ?? raw.nvmePercentage ?? raw.nvme_percentage ?? 0)

        return {
          throughput: typeof raw.throughput === 'number' ? raw.throughput : Number(raw.throughput || 0),
          activeTransfers: typeof raw.activeTransfers === 'number' ? raw.activeTransfers : Number(raw.active_transfers || 0),
          storageFreeGb: Math.round(freeGb * 10) / 10,
          storageTotalGb: Math.round(totalGb * 10) / 10,
          storagePercentage: percentage,
          engineStatus: raw.engineStatus || raw.engine_status || 'Hardware Acceleration',
          nvmeFreeTb: Math.round((freeGb / 1024) * 100) / 100,
          nvmePercentage: percentage,
        }
      }
    } catch (err) {
      console.warn('Tauri get_system_vitals error:', err)
    }
  }
  return null
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

export interface NativeMediaFormat {
  format_id: string
  extension: string
  resolution?: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  tbr?: number
  is_video: boolean
  is_audio: boolean
}

export interface NativeSubtitleTrack {
  language: string
  url?: string
  ext: string
}

export interface NativeMediaMetadata {
  id: string
  title: string
  duration?: number
  thumbnail?: string
  webpage_url: string
  formats: NativeMediaFormat[]
  subtitles: NativeSubtitleTrack[]
  is_live: boolean
}

export interface NativeDownloadOptions {
  url: string
  title: string
  format_id?: string
  output_dir?: string
  audio_formats?: string[]
  subtitles?: string[]
  cookies?: string
}

export interface NativeDownloadProgress {
  task_id: string
  title: string
  state: 'queued' | 'downloading' | 'paused' | 'remuxing' | 'completed' | 'failed' | 'cancelled'
  progress_percent: number
  speed_bytes_per_sec: number
  downloaded_bytes: number
  total_bytes?: number
  eta_seconds?: number
  stage: string
  output_path?: string
  error_message?: string
}

export async function queryMediaInfo(url: string, cookies?: string): Promise<NativeMediaMetadata | null> {
  if (isTauri()) {
    try {
      return await invoke<NativeMediaMetadata>('query_media_info', { url, cookies })
    } catch (err) {
      console.warn('queryMediaInfo error:', err)
      return null
    }
  }
  return null
}

export async function startUniversalDownload(options: NativeDownloadOptions): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>('start_universal_download', { options })
    } catch (err) {
      console.warn('startUniversalDownload error:', err)
      return null
    }
  }
  return null
}

export async function cancelDownload(taskId: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('cancel_download', { taskId })
    } catch (err) {
      console.warn('cancelDownload error:', err)
    }
  }
}

export async function getActiveDownloads(): Promise<NativeDownloadProgress[]> {
  if (isTauri()) {
    try {
      return await invoke<NativeDownloadProgress[]>('get_active_downloads')
    } catch (err) {
      console.warn('getActiveDownloads error:', err)
      return []
    }
  }
  return []
}


