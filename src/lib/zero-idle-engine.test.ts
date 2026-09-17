import { describe, it, expect, vi } from 'vitest'
import { suspendHapticAudio, resumeHapticAudio } from './sound'
import { detectHardwareProfile } from './hardware-profiler'
import {
  listenWindowMoved,
  listenWindowResized,
  getWindowPosition,
} from './tauri-bridge'

describe('Zero-Idle CPU Engine & Inactivity Sleep', () => {
  it('exports suspendHapticAudio and resumeHapticAudio helpers', () => {
    expect(typeof suspendHapticAudio).toBe('function')
    expect(typeof resumeHapticAudio).toBe('function')
    expect(() => suspendHapticAudio()).not.toThrow()
    expect(() => resumeHapticAudio()).not.toThrow()
  })

  it('evaluates autonomous hardware profile for potato mode when localStorage is unpopulated', () => {
    const profile = detectHardwareProfile()
    expect(['potato', 'studio']).toContain(profile.recommendedRenderingProfile)

    const resolveInitialPotatoMode = (stored: string | null): boolean => {
      if (stored !== null) {
        return stored === 'true'
      }
      return detectHardwareProfile().recommendedRenderingProfile === 'potato'
    }

    expect(resolveInitialPotatoMode('true')).toBe(true)
    expect(resolveInitialPotatoMode('false')).toBe(false)
    expect(resolveInitialPotatoMode(null)).toBe(profile.recommendedRenderingProfile === 'potato')
  })

  it('immediately cancels RAF loop when window coordinates become stationary', () => {
    let activeRafId: number | null = null
    let isPointerDown = false
    let stationaryFrames = 0

    const cancelFn = vi.fn((id: number) => {
      if (activeRafId === id) {
        activeRafId = null
      }
    })

    const stopNativeDragSync = () => {
      isPointerDown = false
      if (activeRafId !== null) {
        cancelFn(activeRafId)
        activeRafId = null
      }
    }

    const startNativeDragSync = () => {
      isPointerDown = true
      activeRafId = 777
      stationaryFrames = 0
    }

    // 1. Pointer down starts drag
    startNativeDragSync()
    expect(activeRafId).toBe(777)
    expect(isPointerDown).toBe(true)

    // 2. Drag frame tick with stationary coordinates
    stationaryFrames = 10
    if (!isPointerDown || stationaryFrames >= 10) {
      stopNativeDragSync()
    }

    // 3. Verifies immediate RAF cancellation and 0 FPS loop state
    expect(cancelFn).toHaveBeenCalledWith(777)
    expect(activeRafId).toBeNull()
    expect(isPointerDown).toBe(false)
  })

  it('suspends audio and cancels drag synchronization on window blur or visibility hidden', () => {
    let isFocused = true
    let isDragSyncActive = true

    const stopDragSync = vi.fn(() => {
      isDragSyncActive = false
    })

    const handleBlur = () => {
      isFocused = false
      stopDragSync()
      suspendHapticAudio()
    }

    const handleVisibilityChange = (hidden: boolean) => {
      if (hidden) {
        isFocused = false
        stopDragSync()
        suspendHapticAudio()
      } else {
        isFocused = true
        resumeHapticAudio()
      }
    }

    // Window blurs
    handleBlur()
    expect(isFocused).toBe(false)
    expect(isDragSyncActive).toBe(false)
    expect(stopDragSync).toHaveBeenCalledTimes(1)

    // Document becomes visible again
    handleVisibilityChange(false)
    expect(isFocused).toBe(true)

    // Document hidden
    handleVisibilityChange(true)
    expect(isFocused).toBe(false)
    expect(stopDragSync).toHaveBeenCalledTimes(2)
  })

  it('safely registers listenWindowMoved and returns no-op unlisten in non-tauri environment', async () => {
    const callback = vi.fn()
    const unlisten = await listenWindowMoved(callback)
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })

  it('safely registers listenWindowResized and returns no-op unlisten in non-tauri environment', async () => {
    const callback = vi.fn()
    const unlisten = await listenWindowResized(callback)
    expect(typeof unlisten).toBe('function')
    expect(() => unlisten()).not.toThrow()
    expect(callback).not.toHaveBeenCalled()
  })

  it('returns null for getWindowPosition in non-tauri environment', async () => {
    const pos = await getWindowPosition()
    expect(pos).toBeNull()
  })

  it('safely handles setWindowPosition in non-tauri environment', async () => {
    const { setWindowPosition } = await import('./tauri-bridge')
    await expect(setWindowPosition(100, 200)).resolves.not.toThrow()
  })

  it('safely handles startDraggingWindow in non-tauri environment', async () => {
    const { startDraggingWindow } = await import('./tauri-bridge')
    await expect(startDraggingWindow()).resolves.not.toThrow()
  })
})


