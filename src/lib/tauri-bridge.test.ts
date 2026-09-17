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
})
