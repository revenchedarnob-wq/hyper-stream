/**
 * HyperStream Web Audio Micro-Haptics Engine
 * Zero external audio assets, zero network latency, pure Web Audio API synthesis.
 */

let audioCtx: AudioContext | null = null
let isMuted = false
const subscribers = new Set<(muted: boolean) => void>()

// Initialize mute state from localStorage if available
try {
  const saved = localStorage.getItem('hyperstream_haptics_muted')
  if (saved !== null) {
    isMuted = saved === 'true'
  }
} catch {
  // Ignore storage access errors in restricted contexts
}

let idleSuspendTimer: ReturnType<typeof setTimeout> | null = null

export function suspendHapticAudio(): void {
  if (idleSuspendTimer) {
    clearTimeout(idleSuspendTimer)
    idleSuspendTimer = null
  }
  if (audioCtx && audioCtx.state === 'running') {
    audioCtx.suspend().catch(() => {})
  }
}

export function resumeHapticAudio(): void {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
}

function scheduleIdleSuspend(): void {
  if (idleSuspendTimer) clearTimeout(idleSuspendTimer)
  idleSuspendTimer = setTimeout(() => {
    if (audioCtx && audioCtx.state === 'running') {
      audioCtx.suspend().catch(() => {})
    }
  }, 2500)
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  scheduleIdleSuspend()
  return audioCtx
}

export function isHapticAudioMuted(): boolean {
  return isMuted
}

export function setHapticAudioMuted(muted: boolean): void {
  isMuted = muted
  try {
    localStorage.setItem('hyperstream_haptics_muted', String(muted))
  } catch {
    // Ignore storage errors
  }
  subscribers.forEach((fn) => fn(muted))
}

export function toggleHapticAudio(): boolean {
  setHapticAudioMuted(!isMuted)
  return isMuted
}

export function subscribeHapticAudio(callback: (muted: boolean) => void): () => void {
  subscribers.add(callback)
  callback(isMuted)
  return () => {
    subscribers.delete(callback)
  }
}

/**
 * Crisp mechanical tick (Leica shutter / micro tactile click)
 * Used on primary buttons, play buttons, and window controls.
 */
export function playHapticClick(volume = 1): void {
  if (isMuted) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(880, now)
  osc.frequency.exponentialRampToValueAtTime(160, now + 0.014)

  filter.type = 'highpass'
  filter.frequency.setValueAtTime(140, now)

  const peak = Math.min(0.20, 0.20 * volume)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.0015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.014)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.016)
}

/**
 * Delicate crystalline chime (Dual harmonic glass tap)
 * Used on view toggles, modal triggers, and audio track switches.
 */
export function playHapticGlass(volume = 1): void {
  if (isMuted) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()

  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(2640, now)
  osc1.frequency.exponentialRampToValueAtTime(2400, now + 0.045)

  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(3960, now)
  osc2.frequency.exponentialRampToValueAtTime(3600, now + 0.035)

  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(3200, now)
  filter.Q.setValueAtTime(3.0, now)

  const peak = Math.min(0.12, 0.12 * volume)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.001)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.050)

  osc1.connect(filter)
  osc2.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)

  osc1.start(now)
  osc2.start(now)
  osc1.stop(now + 0.052)
  osc2.stop(now + 0.052)
}

/**
 * Organic bubble chirp (Upward pitch flick)
 * Used on filter pills, badges, and toggle switches.
 */
export function playHapticPop(volume = 1): void {
  if (isMuted) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(420, now)
  osc.frequency.exponentialRampToValueAtTime(740, now + 0.022)

  const peak = Math.min(0.14, 0.14 * volume)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.026)
}

/**
 * Aerodynamic air glide (Filtered acoustic breath)
 * Used on navigation item changes and large panel transitions.
 */
export function playHapticSwoosh(volume = 1): void {
  if (isMuted) return
  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const filter = ctx.createBiquadFilter()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(600, now)
  osc.frequency.exponentialRampToValueAtTime(240, now + 0.075)

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1400, now)
  filter.frequency.exponentialRampToValueAtTime(400, now + 0.075)

  const peak = Math.min(0.08, 0.08 * volume)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.080)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.085)
}

// Throttled scrub micro-tick
let lastScrubTime = 0

/**
 * Mechanical micro-tick for timeline scrubbers
 * Rate-limited to max 25 calls/sec to maintain pleasant acoustic cadence.
 */
export function playHapticScrub(volume = 1): void {
  if (isMuted) return
  const nowMs = performance.now()
  if (nowMs - lastScrubTime < 40) return
  lastScrubTime = nowMs

  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1200, now)
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.008)

  const peak = Math.min(0.07, 0.07 * volume)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + 0.001)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.010)
}
