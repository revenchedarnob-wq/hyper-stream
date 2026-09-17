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

/**
 * Query real system storage and hardware vitals from Rust backend.
 */
export async function getSystemVitals(): Promise<{
  throughput: number
  activeTransfers: number
  nvmeFreeTb: number
  nvmePercentage: number
  engineStatus: string
} | null> {
  if (isTauri()) {
    try {
      return await invoke('get_system_vitals')
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


