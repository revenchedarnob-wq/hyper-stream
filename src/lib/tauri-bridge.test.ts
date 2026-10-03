import { describe, it, expect, vi } from 'vitest'
import {
  isTauri,
  listenWindowMoved,
  listenWindowResized,
  getWindowPosition,
} from './tauri-bridge'

describe('Tauri Bridge Native Window & Move Listeners', () => {
  it('returns false for isTauri in standard browser environment', () => {
    expect(isTauri()).toBe(false)
  })

  it('safely handles listenWindowMoved in browser environment without throwing', async () => {
    const callback = vi.fn()
    const unlisten = await listenWindowMoved(callback)
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })

  it('safely handles listenWindowResized in browser environment without throwing', async () => {
    const callback = vi.fn()
    const unlisten = await listenWindowResized(callback)
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })

  it('returns null for getWindowPosition in browser environment without throwing', async () => {
    const pos = await getWindowPosition()
    expect(pos).toBeNull()
  })

  it('safely handles getSystemVitals in browser environment returning null', async () => {
    const vitals = await import('./tauri-bridge').then((m) => m.getSystemVitals())
    expect(vitals).toBeNull()
  })

  it('safely handles getActiveDownloads in browser environment returning empty array', async () => {
    const downloads = await import('./tauri-bridge').then((m) => m.getActiveDownloads())
    expect(Array.isArray(downloads)).toBe(true)
    expect(downloads.length).toBe(0)
  })
})

describe('taskbarProgressFor', () => {
  it('averages active downloads and ignores finished ones', async () => {
    const { taskbarProgressFor } = await import('./tauri-bridge')
    expect(taskbarProgressFor([])).toEqual({ status: 'none' })
    expect(taskbarProgressFor([{ state: 'completed', progress_percent: 100 }])).toEqual({ status: 'none' })
    expect(
      taskbarProgressFor([
        { state: 'downloading', progress_percent: 40 },
        { state: 'remuxing', progress_percent: 0 },
        { state: 'failed', progress_percent: 10 },
      ]),
    ).toEqual({ status: 'normal', percent: 70 })
  })

  it('shows paused and waiting states', async () => {
    const { taskbarProgressFor } = await import('./tauri-bridge')
    expect(taskbarProgressFor([{ state: 'paused', progress_percent: 30 }])).toEqual({ status: 'paused', percent: 30 })
    expect(taskbarProgressFor([{ state: 'queued', progress_percent: 0 }])).toEqual({ status: 'indeterminate', percent: 0 })
  })
})
