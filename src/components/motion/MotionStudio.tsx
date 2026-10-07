import React, { useState, useEffect, useRef, useCallback } from 'react'
import './MotionStudio.css'
import {
  playHapticClick,
  playHapticGlass,
  playHapticPop,
  playHapticSwoosh,
  playHapticScrub,
  isHapticAudioMuted,
  toggleHapticAudio,
} from '@/lib/sound'

interface MotionStudioProps {
  onClose?: () => void
}

export const MotionStudio: React.FC<MotionStudioProps> = ({ onClose }) => {
  // Playback state (duration is strictly 10.00 seconds)
  const DURATION = 10.00
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState<boolean>(true)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [aspectMode, setAspectMode] = useState<'9:16' | '16:9'>('9:16')
  const [showPromptModal, setShowPromptModal] = useState<boolean>(false)
  const [showLogoModal, setShowLogoModal] = useState<boolean>(false)
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false)
  const [isMuted, setIsMuted] = useState<boolean>(isHapticAudioMuted())

  // Custom Logo and Brand State
  const DEFAULT_GLYPH =
    'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'
  const [logoPath, setLogoPath] = useState<string>(DEFAULT_GLYPH)
  const [brandName, setBrandName] = useState<string>('HyperStream')
  const [logoInputText, setLogoInputText] = useState<string>('')
  const [brandInputText, setBrandInputText] = useState<string>('HyperStream')

  const animFrameRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const scrubTrackRef = useRef<HTMLDivElement | null>(null)

  // Track haptic triggers so they fire once per playback cycle
  const firedCuesRef = useRef<Set<string>>(new Set())

  // Full typed text string for the Omnibar
  const TARGET_INPUT = 'hyper://live/ultra-low-latency'

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      lastTimestampRef.current = null
      return
    }

    const step = (timestamp: number) => {
      if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp
      }
      const delta = (timestamp - lastTimestampRef.current) / 1000
      lastTimestampRef.current = timestamp

      setCurrentTime((prev) => {
        const next = prev + delta * playbackSpeed
        if (next >= DURATION) {
          setIsPlaying(false)
          return DURATION
        }
        return next
      })

      animFrameRef.current = requestAnimationFrame(step)
    }

    animFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying, playbackSpeed])

  // Reset cue triggers on loop/seek
  const resetCues = useCallback(() => {
    firedCuesRef.current.clear()
  }, [])

  // Fire audio micro-haptics at precise timestamps
  useEffect(() => {
    const t = currentTime
    const cues = firedCuesRef.current

    if (t < 0.2 && cues.size > 0) {
      resetCues()
    }

    // Cue 1: Glyph Assembly Snap (t = 0.8s)
    if (t >= 0.8 && !cues.has('cue-0.8')) {
      cues.add('cue-0.8')
      playHapticGlass(0.9)
    }

    // Cue 2: Omnibar Slide (t = 1.8s)
    if (t >= 1.8 && !cues.has('cue-1.8')) {
      cues.add('cue-1.8')
      playHapticSwoosh(0.8)
    }

    // Cue 3: Typing keystroke pulses (between 2.8s and 4.8s)
    if (t >= 2.8 && t <= 4.8) {
      const stepIndex = Math.floor((t - 2.8) / 0.14)
      const keyId = `type-${stepIndex}`
      if (!cues.has(keyId)) {
        cues.add(keyId)
        playHapticScrub(0.4)
      }
    }

    // Cue 4: Button Hover (t = 5.6s)
    if (t >= 5.6 && !cues.has('cue-5.6')) {
      cues.add('cue-5.6')
      playHapticPop(0.7)
    }

    // Cue 5: Action Click (t = 6.2s)
    if (t >= 6.2 && !cues.has('cue-6.2')) {
      cues.add('cue-6.2')
      playHapticClick(1.0)
    }

    // Cue 6: Stream Lock (t = 7.4s)
    if (t >= 7.4 && !cues.has('cue-7.4')) {
      cues.add('cue-7.4')
      playHapticGlass(1.0)
    }

    // Cue 7: Final Resolution Unveil (t = 8.8s)
    if (t >= 8.8 && !cues.has('cue-8.8')) {
      cues.add('cue-8.8')
      playHapticSwoosh(1.0)
    }
  }, [currentTime, resetCues])

  // Play / Pause / Seek Handlers
  const handleTogglePlay = () => {
    if (currentTime >= DURATION) {
      setCurrentTime(0)
      resetCues()
      setIsPlaying(true)
    } else {
      setIsPlaying(!isPlaying)
    }
  }

  const handleRestart = () => {
    setCurrentTime(0)
    resetCues()
    setIsPlaying(true)
  }

  const handleTimelineScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubTrackRef.current) return
    const rect = scrubTrackRef.current.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const ratio = clickX / rect.width
    const target = ratio * DURATION
    setCurrentTime(target)
    resetCues()
  }

  const handleToggleAudio = () => {
    const next = toggleHapticAudio()
    setIsMuted(next)
  }

  // --- Dynamic State Calculations based on Timeline (0.00s - 10.00s) ---

  // Act 1: Glyph Identity (0.00 - 1.40s)
  const isGlyphAssembling = currentTime < 1.40
  const isBrandCentered = currentTime < 1.60

  // Act 2: Omnibar & Typing (1.40 - 5.20s)
  const isOmnibarVisible = currentTime >= 1.40 && currentTime < 6.40
  const typingProgress = Math.max(0, Math.min(1, (currentTime - 2.80) / 2.20))
  const charsCount = Math.floor(typingProgress * TARGET_INPUT.length)
  const typedText = currentTime >= 2.80 ? TARGET_INPUT.slice(0, charsCount) : ''

  // Act 3: Cursor approach & click (5.00 - 6.40s)
  const isCursorVisible = currentTime >= 5.00 && currentTime < 6.60
  const cursorProgress = Math.max(0, Math.min(1, (currentTime - 5.00) / 1.10))
  // Parametric curved path from lower-right (x: 85%, y: 80%) to button (x: 74%, y: 52%)
  const cursorX = 85 - Math.sin((cursorProgress * Math.PI) / 2) * 11
  const cursorY = 80 - Math.sin((cursorProgress * Math.PI) / 2) * 28
  const isBtnHovered = currentTime >= 5.60 && currentTime < 6.40
  const isBtnClicked = currentTime >= 6.15 && currentTime < 6.40

  // Act 4: Stream Lock Telemetry HUD (6.40 - 8.80s)
  const isStatusPanelVisible = currentTime >= 6.40 && currentTime < 8.80
  const statusProgress = Math.max(0, Math.min(100, ((currentTime - 6.40) / 2.0) * 100))

  // Act 5: Resolution Stage (8.80 - 10.00s)
  const isResolutionVisible = currentTime >= 8.80

  // Master Gemini Generation Prompt string
  const masterGeminiPrompt = `IMPORTANT:
This is a high-precision motion-design reconstruction task, NOT a generic creative interpretation.
Recreate an exact 10.00-second product motion graphics trailer for "HyperStream".
Duration: exactly 10.00 seconds. Aspect Ratio: ${aspectMode}. Frame rate: 60 fps (or 30 fps).
Style: elite minimalist UI motion graphics, Obsidian Computing archetype, Windows 11 Fluent 2 specular materials.
Camera: completely virtual/static UI motion. No physical camera shakes or hand-held drift.

COLOR / ENVIRONMENT:
Background: Midnight obsidian (#07080C transitioning to #0E1017).
Atmospheric lighting: Diffused deep cobalt blue (#0284C7) and electric cyan (#38BDF8) rim glow along bottom and edges.
Laser accents: 1px specular gradient borders (#38BDF8 to #818CF8 at 30% opacity).
No neon oversaturation. No muddy gradients.

TIMELINE & CHOREOGRAPHY:
0.00–1.40 — HYPERSTREAM GLYPH MATERIALIZATION:
Start with dark obsidian canvas. Barely visible atmospheric glow in the center.
The HyperStream glyph (a modern geometric streaming ribbon glyph) swiftly forms in dead center.
Glyph colors: smooth electric cyan (#38BDF8) into soft violet (#818CF8).
Precise mathematical deceleration (cubic-bezier ease-out). No bouncing, no particles, no explosions.
The glyph settles crisply.

1.40–2.80 — OMNIBAR & WORDMARK LOCKUP:
The glyph scales down to 48px and glides smoothly into the top-left corner, revealing the wordmark "HYPERSTREAM" in crisp semi-bold sans-serif.
Simultaneously, a centered floating omnibar pill (dark glassmorphism, subtle 1px border, soft shadow) slides up from y: 30px to center.
Inside the pill: an active stream sniffer icon and a blinking caret "|".

2.80–5.20 — SNIFFER INPUT TYPING:
Type the text into the omnibar character-by-character:
"${TARGET_INPUT}"
Realistic typing pacing (fast, natural keyboard cadence, visible blinking caret at the end).
Do not reveal the entire text at once. No typewriter sound effects or cartoon shakes.
To the right of the input, a glowing cyan pill button appears: "Accelerate".

5.20–6.80 — CURSOR INTERACTION & CLICK:
A clean white desktop pointer cursor glides smoothly along an organic curved path from the lower-right toward "Accelerate".
Natural deceleration as it reaches the button.
The button enters hover state: cyan glow intensifies subtly.
Cursor performs a fast, crisp click (subtle 0.96 scale dip).
No click ripple, no exaggerated shockwave.

6.80–8.80 — STREAM LOCK & SHIELD ACTIVATION:
Immediately upon click, the omnibar seamlessly morphs into a stream status panel.
Two crisp telemetry indicators advance rapidly:
- "Shields: Active (0 Trackers / Ads Skipped)"
- "Buffer Latency: 4.2ms -> 0.0ms (LOCKED)"
A vibrant green/cyan progress bar completes crisply.

8.80–10.00 — RESOLUTION & BRAND OUTRO:
The panel resolves smoothly into a clean cinematic live video view with the minimal title badge:
"HyperStream — Pure Media Velocity"
Centered, perfectly legible, ultra-clean.
Video freezes on the pristine final frame at exactly 10.00 seconds.

STRICT NEGATIVE INSTRUCTIONS:
Do NOT generate: people, faces, physical monitors, laptops, messy room backgrounds, cartoons, 3D rotating cubes, confetti, smoke, fire, lens flares, camera shake, generic web dissolves, random floating icons, cheesy futuristic holograms. Keep stationary UI vector-sharp and typography perfectly legible.`

  const copyPromptToClipboard = () => {
    navigator.clipboard.writeText(masterGeminiPrompt)
    setCopiedPrompt(true)
    playHapticGlass(1)
    setTimeout(() => setCopiedPrompt(false), 2500)
  }

  // Render the core Obsidian Screen Experience (shared between 9:16 card & 16:9 cinematic)
  const renderObsidianContent = (isBenchmarkComparison = false) => {
    return (
      <div className="hs-screen-content">
        {/* Ambient Horizon Glow */}
        <div
          className={`hs-ambient-glow ${
            isBenchmarkComparison ? 'hs-glow-crimson' : isStatusPanelVisible ? 'hs-glow-indigo' : 'hs-glow-cyan'
          }`}
        />

        {/* Brand Lockup (Transitions from center to top-left) */}
        <div
          className={`hs-motion-brand-lockup ${
            isBrandCentered ? 'hs-brand-center' : 'hs-brand-top-left'
          }`}
          style={{
            opacity: currentTime >= 0.1 ? 1 : 0,
            transform: isBrandCentered
              ? `translate(-50%, -50%) scale(${isGlyphAssembling ? 1.4 : 1.2})`
              : 'translate(0, 0) scale(1)',
          }}
        >
          <svg
            className="hs-motion-glyph"
            viewBox="0 0 48 46"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={logoPath}
              fill="url(#motionGrad)"
            />
            <defs>
              <linearGradient id="motionGrad" x1="0" y1="0" x2="48" y2="46" gradientUnits="userSpaceOnUse">
                <stop stopColor="#38bdf8" />
                <stop offset="0.5" stopColor="#818cf8" />
                <stop offset="1" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
          {!isBrandCentered && (
            <span className="hs-motion-wordmark">{brandName}</span>
          )}
        </div>

        {/* Floating Omnibar Pill */}
        {isOmnibarVisible && (
          <div
            className="hs-motion-omnibar"
            style={{
              opacity: currentTime >= 1.6 ? 1 : (currentTime - 1.4) / 0.2,
              transform: `translateY(${Math.max(0, (2.0 - currentTime) * 20)}px)`,
            }}
          >
            <div className="hs-omnibar-input-area">
              <span className="hs-omnibar-icon">⚡</span>
              <span>{typedText}</span>
              {currentTime >= 2.6 && currentTime < 6.4 && <span className="hs-caret" />}
            </div>
            {currentTime >= 4.0 && (
              <button
                className={`hs-motion-action-btn ${isBtnHovered ? 'hovered' : ''} ${
                  isBtnClicked ? 'clicked' : ''
                }`}
              >
                Accelerate
              </button>
            )}
          </div>
        )}

        {/* Kinetic Desktop Cursor */}
        {isCursorVisible && (
          <div
            className="hs-motion-cursor"
            style={{
              left: `${cursorX}%`,
              top: `${cursorY}%`,
              transform: `scale(${isBtnClicked ? 0.9 : 1})`,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4.5 3.5L11.5 20.5L14.5 13.5L21.5 10.5L4.5 3.5Z"
                fill="#ffffff"
                stroke="#07080c"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        {/* Telemetry Status HUD */}
        {isStatusPanelVisible && (
          <div className="hs-motion-status-panel">
            <div className="hs-status-header">
              <h4 className="hs-status-heading">Sniffing Live Feed</h4>
              <span className="hs-status-latency-badge">
                {currentTime >= 7.6 ? '0.0ms LOCKED' : '2.1ms SYNC'}
              </span>
            </div>
            <div className="hs-status-rows">
              <div className="hs-status-row">
                <div className="hs-status-label">
                  <span>Ad-Shields & DRM Decryption</span>
                  <span>Active (16x bypass)</span>
                </div>
                <div className="hs-status-progress-track">
                  <div
                    className="hs-status-progress-bar"
                    style={{ width: `${Math.min(100, statusProgress * 1.1)}%` }}
                  />
                </div>
              </div>
              <div className="hs-status-row">
                <div className="hs-status-label">
                  <span>Stream Ingestion Pipeline</span>
                  <span>{Math.round(statusProgress)}%</span>
                </div>
                <div className="hs-status-progress-track">
                  <div
                    className="hs-status-progress-bar"
                    style={{ width: `${statusProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Final Resolution Stage (8.80 - 10.00s) */}
        {isResolutionVisible && (
          <div
            className="hs-stream-resolution-stage"
            style={{
              opacity: (currentTime - 8.80) / 0.5,
              backgroundImage:
                'linear-gradient(rgba(7, 8, 12, 0.4), rgba(7, 8, 12, 0.8)), radial-gradient(circle at 50% 50%, #0369a1 0%, #0f172a 100%)',
            }}
          >
            <div className="hs-stream-overlay-badge">
              <span>⚡</span>
              <span>HyperStream — Pure Media Velocity</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Render the benchmark comparison card (for 9:16 Reels mode top card)
  const renderBenchmarkCard = () => {
    return (
      <div className="hs-screen-content">
        <div className="hs-ambient-glow hs-glow-crimson" />
        <div style={{ textAlign: 'center', zIndex: 10 }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>🐌</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#f87171' }}>
            {currentTime < 6.2 ? 'Buffering 4K Stream (1840ms lag)...' : 'Ad Playing (1 of 2)...'}
          </div>
          <div
            style={{
              width: '180px',
              height: '4px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '9999px',
              margin: '12px auto 0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, currentTime * 12)}%`,
                height: '100%',
                background: '#ef4444',
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="hs-motion-studio">
      {/* Studio Toolbar */}
      <header className="hs-ms-header">
        <div className="hs-ms-title-group">
          <span className="hs-ms-badge">Forensic Engine</span>
          <h2 className="hs-ms-title">HyperStream Motion Graphics Studio</h2>
        </div>

        <div className="hs-ms-controls-group">
          {/* Aspect Ratio Switcher */}
          <button
            className={`hs-ms-btn ${aspectMode === '9:16' ? 'active' : ''}`}
            onClick={() => {
              setAspectMode('9:16')
              playHapticClick(0.8)
            }}
          >
            📱 9:16 Reel (Creator Format)
          </button>
          <button
            className={`hs-ms-btn ${aspectMode === '16:9' ? 'active' : ''}`}
            onClick={() => {
              setAspectMode('16:9')
              playHapticClick(0.8)
            }}
          >
            🖥️ 16:9 Cinematic
          </button>

          {/* Audio Haptics Toggle */}
          <button
            className={`hs-ms-btn ${!isMuted ? 'active' : ''}`}
            onClick={handleToggleAudio}
            title="Toggle Web Audio micro-haptics"
          >
            {isMuted ? '🔇 Muted' : '🔊 Micro-Haptics'}
          </button>

          {/* Custom Logo & Brand Editor */}
          <button
            className={`hs-ms-btn ${showLogoModal ? 'active' : ''}`}
            onClick={() => {
              setShowLogoModal(true)
              playHapticGlass(0.8)
            }}
            title="Swap SVG logo and brand name"
          >
            🎨 Custom Logo
          </button>

          {/* Master Prompt Modal Trigger */}
          <button
            className="hs-ms-btn hs-ms-btn-primary"
            onClick={() => {
              setShowPromptModal(true)
              playHapticGlass(1)
            }}
          >
            📋 Master AI Generation Prompt
          </button>

          {onClose && (
            <button className="hs-ms-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </header>

      {/* Viewport Stage */}
      <main className="hs-ms-stage">
        {aspectMode === '9:16' ? (
          /* 9:16 Vertical Reel Mode (Exact recreation of @shhradddhaa.ai layout) */
          <div className="hs-ms-viewport-9-16">
            <div className="hs-reel-canvas">
              {/* Decorative Corner Leaves (SVG silhouettes) */}
              <svg className="hs-leaf-tl" viewBox="0 0 100 100" fill="#2d3748">
                <path d="M10,0 C30,40 50,20 80,10 C50,60 10,70 0,40 Z" />
              </svg>
              <svg className="hs-leaf-bl" viewBox="0 0 100 100" fill="#2d3748">
                <path d="M0,80 C30,60 60,90 90,80 C40,100 10,90 0,80 Z" />
              </svg>

              <div className="hs-reel-card-section">
                {/* Top Benchmark Card: Standard Slow Browser / After Effects */}
                <div className="hs-reel-card-container">
                  <div className="hs-reel-card-header">
                    <span className="hs-reel-pill-badge hs-pill-ae">Ae</span>
                    <span className="hs-reel-card-title">Generic Browser / Slow Stream</span>
                  </div>
                  <div className="hs-reel-screen-window">{renderBenchmarkCard()}</div>
                </div>

                {/* Bottom Benchmark Card: HyperStream / Gemini Reconstructed */}
                <div className="hs-reel-card-container">
                  <div className="hs-reel-card-header">
                    <span className="hs-reel-pill-badge hs-pill-gemini">✦ HyperStream</span>
                    <span className="hs-reel-card-title">Ultra-Low Latency Engine</span>
                  </div>
                  <div className="hs-reel-screen-window">{renderObsidianContent(false)}</div>
                </div>
              </div>

              {/* Bottom Viral Engagement Hook */}
              <div className="hs-reel-footer-cta">
                <p className="hs-reel-cta-title">
                  Follow and star <span className="hs-reel-cta-highlight">HyperStream</span>
                </p>
                <span className="hs-reel-cta-subtitle">For the Full Release & Source</span>
              </div>
            </div>
          </div>
        ) : (
          /* 16:9 Cinematic Mode (Website Hero / YouTube / Trailer) */
          <div className="hs-ms-viewport-16-9">
            {renderObsidianContent(false)}
          </div>
        )}
      </main>

      {/* Bottom Timeline Scrubber & Transport Controls */}
      <footer className="hs-ms-footer-timeline">
        <div
          className="hs-ms-timeline-track"
          ref={scrubTrackRef}
          onClick={handleTimelineScrub}
        >
          <div
            className="hs-ms-timeline-progress"
            style={{ width: `${(currentTime / DURATION) * 100}%` }}
          >
            <div className="hs-ms-timeline-handle" />
          </div>
        </div>

        <div className="hs-ms-timeline-indicators">
          <span>0.00s (Identity)</span>
          <span>2.80s (Omnibar)</span>
          <span>5.20s (Cursor Click)</span>
          <span>6.80s (Sniffer Lock)</span>
          <span>8.80s (Velocity Outro)</span>
          <span>10.00s</span>
        </div>

        <div className="hs-ms-playback-bar">
          <div className="hs-ms-controls-group">
            <button className="hs-ms-btn hs-ms-btn-primary" onClick={handleTogglePlay}>
              {isPlaying ? '⏸ Pause' : currentTime >= DURATION ? '↺ Replay' : '▶ Play'}
            </button>
            <button className="hs-ms-btn" onClick={handleRestart}>
              ⏮ Restart
            </button>
            <button
              className={`hs-ms-btn ${playbackSpeed === 0.5 ? 'active' : ''}`}
              onClick={() => {
                setPlaybackSpeed(playbackSpeed === 1 ? 0.5 : 1)
                playHapticClick(0.8)
              }}
            >
              {playbackSpeed === 0.5 ? '🐢 0.5x Slow-Mo' : '⚡ 1.0x Real-Time'}
            </button>
          </div>

          <div className="hs-ms-timecode">
            <span>⏱ {currentTime.toFixed(2)}s</span>
            <span style={{ color: '#64748b' }}>/ {DURATION.toFixed(2)}s</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              ({Math.round(currentTime * 60)} frames @ 60fps)
            </span>
          </div>
        </div>
      </footer>

      {/* Master Prompt Modal */}
      {showPromptModal && (
        <div
          className="hs-ms-modal-backdrop"
          onClick={() => setShowPromptModal(false)}
        >
          <div
            className="hs-ms-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hs-ms-modal-header">
              <h3 style={{ margin: 0, fontSize: '15px', color: '#38bdf8' }}>
                Master Gemini / Claude Generation Prompt
              </h3>
              <button
                className="hs-ms-btn"
                onClick={() => setShowPromptModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="hs-ms-modal-body">{masterGeminiPrompt}</div>
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
              }}
            >
              <button
                className="hs-ms-btn hs-ms-btn-primary"
                onClick={copyPromptToClipboard}
              >
                {copiedPrompt ? '✓ Copied to Clipboard!' : '📋 Copy Prompt for Gemini'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Logo & Brand Editor Modal */}
      {showLogoModal && (
        <div
          className="hs-ms-modal-backdrop"
          onClick={() => setShowLogoModal(false)}
        >
          <div
            className="hs-ms-modal-card"
            style={{ maxWidth: '540px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hs-ms-modal-header">
              <h3 style={{ margin: 0, fontSize: '15px', color: '#38bdf8' }}>
                🎨 Customize Brand & Logo Glyph
              </h3>
              <button
                className="hs-ms-btn"
                onClick={() => setShowLogoModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#94a3b8', marginBottom: '6px' }}>
                  Brand Name
                </label>
                <input
                  type="text"
                  value={brandInputText}
                  onChange={(e) => setBrandInputText(e.target.value)}
                  placeholder="e.g. HyperStream"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#07080c',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#ffffff',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#94a3b8', marginBottom: '6px' }}>
                  SVG Path Data (d=&quot;...&quot;) or Full &lt;svg&gt; Snippet
                </label>
                <textarea
                  value={logoInputText}
                  onChange={(e) => setLogoInputText(e.target.value)}
                  placeholder="Paste SVG path data like M25.9 44.9... or entire <svg> element"
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#07080c',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#38bdf8',
                    fontSize: '12px',
                    fontFamily: 'Consolas, monospace',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: '#64748b', width: '100%' }}>Presets:</span>
                <button
                  type="button"
                  className="hs-ms-btn"
                  style={{ fontSize: '11px' }}
                  onClick={() => {
                    setLogoPath(DEFAULT_GLYPH)
                    setBrandName('HyperStream')
                    setBrandInputText('HyperStream')
                    setLogoInputText('')
                    playHapticGlass(0.7)
                  }}
                >
                  ⚡ HyperStream Chevron
                </button>
                <button
                  type="button"
                  className="hs-ms-btn"
                  style={{ fontSize: '11px' }}
                  onClick={() => {
                    const sparkPath = 'M24 2L28 16L42 20L28 24L24 38L20 24L6 20L20 16L24 2Z'
                    setLogoPath(sparkPath)
                    setLogoInputText(sparkPath)
                    playHapticGlass(0.7)
                  }}
                >
                  ✦ Stream Spark
                </button>
                <button
                  type="button"
                  className="hs-ms-btn"
                  style={{ fontSize: '11px' }}
                  onClick={() => {
                    const ringPath = 'M24 4A20 20 0 1 0 24 44A20 20 0 1 0 24 4Z'
                    setLogoPath(ringPath)
                    setLogoInputText(ringPath)
                    playHapticGlass(0.7)
                  }}
                >
                  ◯ Orbit Ring
                </button>
              </div>
            </div>

            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
              }}
            >
              <button
                type="button"
                className="hs-ms-btn"
                onClick={() => setShowLogoModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="hs-ms-btn hs-ms-btn-primary"
                onClick={() => {
                  let path = logoInputText.trim()
                  if (path) {
                    // Extract d attribute if full svg was pasted
                    const match = path.match(/d=["']([^"']+)["']/i)
                    if (match && match[1]) {
                      path = match[1]
                    }
                    setLogoPath(path)
                  }
                  if (brandInputText.trim()) {
                    setBrandName(brandInputText.trim())
                  }
                  setShowLogoModal(false)
                  playHapticClick(1)
                  setCurrentTime(0)
                  setIsPlaying(true)
                }}
              >
                Apply & Preview Motion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export default MotionStudio
