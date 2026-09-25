import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './stream-studio.css'
import type {
  QualityRendition,
  AudioTrackItem,
  SubtitleTrackItem,
  HypePeak,
  StreamStudioProps,
  StreamPreset,
} from './types'
import {
  DEFAULT_QUALITIES,
  DEFAULT_AUDIO_TRACKS,
  DEFAULT_SUBTITLE_TRACKS,
  DEFAULT_HYPE_PEAKS,
  DEFAULT_STREAM_PRESETS,
  formatTimecode,
} from './types'
import {
  IconPlay,
  IconPause,
  IconSkipBack,
  IconSkipForward,
  IconVolume2,
  IconVolumeX,
  IconMaximize2,
  IconChevronDown,
  IconCheck,
  IconScissors,
  IconArrowLeft,
  IconSearch,
  IconRefreshCw,
  IconZap,
} from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import { getSystemVitals } from '@/lib/tauri-bridge'
import { TimelineScrubber } from './TimelineScrubber'

export const StreamStudio: React.FC<StreamStudioProps> = ({
  initialUrl = '',
  onNavigateToHub,
  onAddTransfer,
}) => {
  // 1. Ingestion & Preset State
  const defaultPreset = DEFAULT_STREAM_PRESETS[0]
  const [streamUrl, setStreamUrl] = useState<string>(initialUrl || defaultPreset.url)
  const [engineStatus, setEngineStatus] = useState<string>('Hardware Acceleration')

  useEffect(() => {
    getSystemVitals().then((v) => {
      if (v?.engineStatus) setEngineStatus(v.engineStatus)
    })
  }, [])
  const [activePresetId, setActivePresetId] = useState<string>(
    initialUrl ? '' : defaultPreset.id
  )
  const [posterUrl, setPosterUrl] = useState<string>(defaultPreset.poster)
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // 2. Track Inspector State
  const [activeQuality, setActiveQuality] = useState<QualityRendition>(DEFAULT_QUALITIES[0])
  const [activeAudio, setActiveAudio] = useState<AudioTrackItem>(DEFAULT_AUDIO_TRACKS[0])
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleTrackItem>(DEFAULT_SUBTITLE_TRACKS[0])
  const [openPopover, setOpenPopover] = useState<'quality' | 'audio' | 'subtitle' | null>(null)

  // 3. Playback & Timecode State
  const [duration, setDuration] = useState<number>(defaultPreset.duration) // 9600s = 02:40:00
  const [currentTime, setCurrentTime] = useState<number>(4545.024) // 01:15:45.024
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [isMuted, setIsMuted] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  // 4. Budget Preset State (Lossless vs Discord Safe vs Social)
  const [selectedBudget, setSelectedBudget] = useState<'lossless' | 'discord' | 'social'>('lossless')

  // 5. Timeline In/Out Points
  const [inPoint, setInPoint] = useState<number>(() =>
    Math.max(0, DEFAULT_HYPE_PEAKS[0].seconds - 15)
  )
  const [outPoint, setOutPoint] = useState<number>(() =>
    DEFAULT_HYPE_PEAKS[0].seconds + 45
  )

  // Refs
  const pillMatrixRef = useRef<HTMLDivElement>(null)
  const monitorContainerRef = useRef<HTMLDivElement>(null)
  const prevInitialUrlRef = useRef(initialUrl)

  // Sync initialUrl changes from parent bridge
  useEffect(() => {
    if (initialUrl && initialUrl !== prevInitialUrlRef.current) {
      prevInitialUrlRef.current = initialUrl
      setStreamUrl(initialUrl)
      setActivePresetId('')
    }
  }, [initialUrl])

  // Toast notification helper
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    const timer = setTimeout(() => {
      setToastMessage(null)
    }, 2400)
    return () => clearTimeout(timer)
  }, [])

  // Close popovers on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (pillMatrixRef.current && !pillMatrixRef.current.contains(e.target as Node)) {
        setOpenPopover(null)
      }
    }

    if (openPopover) {
      document.addEventListener('mousedown', handleOutsideClick)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [openPopover])

  // Frame Stepping (-1 Frame / +1 Frame with 1/fps delta)
  const stepFrame = useCallback((direction: -1 | 1) => {
    playHapticClick()
    const fps = activeQuality.fps > 0 ? activeQuality.fps : 60
    const frameDelta = 1 / fps
    setCurrentTime((t) => {
      if (direction === -1) {
        return Math.max(0, t - frameDelta)
      } else {
        return Math.min(duration, t + frameDelta)
      }
    })
  }, [activeQuality.fps, duration])

  // Global keyboard shortcuts (Space: play/pause, Escape: close popovers, Frame stepping)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keystrokes inside text inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (e.key === 'Escape') {
        if (openPopover) {
          setOpenPopover(null)
        }
      } else if (e.key === ' ') {
        e.preventDefault()
        playHapticClick()
        setIsPlaying((prev) => !prev)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepFrame(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrame(1)
      } else if (e.key === 'm' || e.key === 'M') {
        playHapticClick()
        setIsMuted((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openPopover, stepFrame])

  // High-precision playback simulation clock (60-120 FPS requestAnimationFrame)
  useEffect(() => {
    if (!isPlaying) return

    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const deltaSec = (now - lastTime) / 1000
      lastTime = now

      setCurrentTime((prev) => {
        if (prev >= duration) {
          setIsPlaying(false)
          return duration
        }
        return prev + deltaSec
      })

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [isPlaying, duration])

  // Jump to Start / End
  const handleJumpStart = () => {
    playHapticClick()
    setCurrentTime(0)
  }

  const handleJumpEnd = () => {
    playHapticClick()
    setCurrentTime(duration)
  }

  // Toggle Popover
  const togglePopover = (type: 'quality' | 'audio' | 'subtitle') => {
    playHapticGlass()
    setOpenPopover((prev) => (prev === type ? null : type))
  }

  // Select Quality
  const handleSelectQuality = (quality: QualityRendition) => {
    playHapticClick()
    setActiveQuality(quality)
    setOpenPopover(null)
    showToast(`Active Rendition: ${quality.label} (${quality.resolution} @ ${quality.fps}fps)`)
  }

  // Select Audio Track
  const handleSelectAudio = (audio: AudioTrackItem) => {
    playHapticClick()
    setActiveAudio(audio)
    setOpenPopover(null)
    showToast(`Audio Track: ${audio.language} (${audio.channels})`)
  }

  // Select Subtitle Track
  const handleSelectSubtitle = (sub: SubtitleTrackItem) => {
    playHapticClick()
    setActiveSubtitle(sub)
    setOpenPopover(null)
    showToast(`Subtitle Track: ${sub.language}`)
  }

  // Load Preset
  const handleLoadPreset = (preset: StreamPreset) => {
    playHapticGlass()
    setActivePresetId(preset.id)
    setStreamUrl(preset.url)
    setPosterUrl(preset.poster)
    setDuration(preset.duration)

    const matchQuality = DEFAULT_QUALITIES.find((q) => q.id === preset.qualityId)
    if (matchQuality) setActiveQuality(matchQuality)

    const matchAudio = DEFAULT_AUDIO_TRACKS.find((a) => a.id === preset.audioTrackId)
    if (matchAudio) setActiveAudio(matchAudio)

    const matchSub = DEFAULT_SUBTITLE_TRACKS.find((s) => s.id === preset.subtitleTrackId)
    if (matchSub) setActiveSubtitle(matchSub)

    // Jump to first hype peak for cinematic presentation
    setCurrentTime(DEFAULT_HYPE_PEAKS[0].seconds)
    setInPoint(Math.max(0, DEFAULT_HYPE_PEAKS[0].seconds - 15))
    setOutPoint(Math.min(preset.duration, DEFAULT_HYPE_PEAKS[0].seconds + 45))
    showToast(`Loaded Preset: ${preset.name}`)
  }

  // Load / Analyze URL
  const handleAnalyzeStream = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!streamUrl.trim() || isAnalyzing) return

    playHapticClick()
    setIsAnalyzing(true)

    setTimeout(() => {
      setIsAnalyzing(false)
      showToast('Manifest parsed: 5 qualities, 4 audio tracks, 4 subtitles detected')
    }, 600)
  }

  // Hype Peak Snap (Jump to timestamp minus 5 seconds)
  const handleJumpToPeak = (peak: HypePeak) => {
    playHapticGlass()
    const target = Math.max(0, peak.seconds - 5)
    setCurrentTime(target)
    showToast(`Snapped to Hype Peak: ${peak.label} (${peak.timestamp})`)
  }

  // Toggle Fullscreen
  const handleToggleFullscreen = () => {
    playHapticClick()
    if (!monitorContainerRef.current) return

    if (!document.fullscreenElement) {
      monitorContainerRef.current
        .requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => setIsFullscreen(!isFullscreen))
    } else {
      document
        .exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => setIsFullscreen(false))
    }
  }

  // Bitrate Budgeting & Telemetry Math
  const clipDuration = Math.max(0.1, outPoint - inPoint)
  const videoBitrateKbps = activeQuality.bitrateKbps || 12000
  const audioBitrateKbps = parseInt(activeAudio.bitrate, 10) || 320

  // 1. Lossless: exact estimated size from active quality rendition + audio
  const losslessTotalKbps = videoBitrateKbps + audioBitrateKbps
  const losslessSizeMB = (clipDuration * losslessTotalKbps) / (8 * 1024)

  // 2. Discord-Safe (< 25 MB): locks file budget to 24.8 MB and calculates target video bitrate
  const discordTargetVideoKbps = Math.max(
    250,
    Math.floor((24.8 * 8 * 1024) / clipDuration - audioBitrateKbps)
  )
  const discordSizeMB = Math.min(
    24.8,
    (clipDuration * (discordTargetVideoKbps + audioBitrateKbps)) / (8 * 1024)
  )

  // 3. Social (< 10 MB): locks file budget to 9.8 MB and calculates target video bitrate
  const socialTargetVideoKbps = Math.max(
    250,
    Math.floor((9.8 * 8 * 1024) / clipDuration - audioBitrateKbps)
  )
  const socialSizeMB = Math.min(
    9.8,
    (clipDuration * (socialTargetVideoKbps + audioBitrateKbps)) / (8 * 1024)
  )

  const formatClipDuration = (seconds: number): string => {
    const s = Math.floor(seconds)
    const hrs = Math.floor(s / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const secs = s % 60
    if (hrs > 0) {
      return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
    }
    return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`
  }

  const activeEstimatedSize = useMemo(() => {
    if (selectedBudget === 'discord') {
      return `${discordSizeMB.toFixed(1)} MB`
    }
    if (selectedBudget === 'social') {
      return `${socialSizeMB.toFixed(1)} MB`
    }
    if (losslessSizeMB >= 1024) {
      return `${(losslessSizeMB / 1024).toFixed(2)} GB`
    }
    return `${losslessSizeMB.toFixed(1)} MB`
  }, [selectedBudget, discordSizeMB, socialSizeMB, losslessSizeMB])

  const activeRecommendedBitrate = useMemo(() => {
    if (selectedBudget === 'discord') {
      return discordTargetVideoKbps >= 1000
        ? `${(discordTargetVideoKbps / 1000).toFixed(2)} Mbps`
        : `${discordTargetVideoKbps} kbps`
    }
    if (selectedBudget === 'social') {
      return socialTargetVideoKbps >= 1000
        ? `${(socialTargetVideoKbps / 1000).toFixed(2)} Mbps`
        : `${socialTargetVideoKbps} kbps`
    }
    return activeQuality.bitrate
  }, [selectedBudget, discordTargetVideoKbps, socialTargetVideoKbps, activeQuality.bitrate])

  // Quick Clip Control Handlers
  const handleMarkIn = () => {
    playHapticClick()
    const newIn = Math.min(currentTime, Math.max(0, outPoint - 0.1))
    setInPoint(newIn)
    showToast(`Marked In at ${formatTimecode(newIn, true)}`)
  }

  const handleMarkOut = () => {
    playHapticClick()
    const newOut = Math.max(currentTime, Math.min(duration, inPoint + 0.1))
    setOutPoint(newOut)
    showToast(`Marked Out at ${formatTimecode(newOut, true)}`)
  }

  const handleResetFullRange = () => {
    playHapticPop()
    setInPoint(0)
    setOutPoint(duration)
    showToast(`Clip range reset to full stream (${formatTimecode(duration, false)})`)
  }

  // Export Clip Dispatch (Connects to active transfers queue)
  const handleExportClip = () => {
    playHapticGlass()
    const clipTitle = `Clip: ${activePresetId ? DEFAULT_STREAM_PRESETS.find((p) => p.id === activePresetId)?.name : 'HyperStream Capture'}`
    const payload = {
      id: `transfer-${Date.now()}`,
      title: clipTitle,
      quality:
        selectedBudget === 'lossless'
          ? activeQuality.label
          : `${activeQuality.label} (${selectedBudget})`,
      bitrate: activeRecommendedBitrate,
      duration: formatClipDuration(clipDuration),
      size: activeEstimatedSize,
      status: 'ingesting',
      progress: 0,
      timestamp: Date.now(),
    }

    if (onAddTransfer) {
      onAddTransfer(payload)
    }

    showToast(`Export dispatched to Stream Hub pipeline: ${clipTitle} (${formatClipDuration(clipDuration)})`)
  }

  return (
    <div className="stream-studio-container">
      {/* Toast Feedback Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'var(--surface-overlay)',
            color: 'var(--color-text-primary)',
            padding: '10px 18px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: 500,
            backdropFilter: 'blur(16px)',
            boxShadow: 'var(--shadow-elevated)',
            border: '1px solid var(--border-normal)',
            borderTop: '1px solid var(--border-specular-top)',
            zIndex: 100,
          }}
        >
          {toastMessage}
        </div>
      )}

      <div className="stream-studio-content">
        {/* =========================================================
           1. Top Bar: Back to Hub, Studio Title, Manifest Status Badge
        ========================================================= */}
        <div className="studio-header">
          <div className="studio-header-left">
            {onNavigateToHub && (
              <button
                type="button"
                onClick={() => {
                  playHapticClick()
                  onNavigateToHub()
                }}
                className="studio-back-btn"
                aria-label="Back to Stream Hub"
              >
                <IconArrowLeft size={14} />
                <span>Stream Hub</span>
              </button>
            )}

            <div className="studio-title-group">
              <h1 className="studio-title">Stream Studio</h1>
            </div>
          </div>

          <div className="studio-header-right">
            <div className="studio-manifest-badge">
              <span className="studio-status-dot" />
              <span>
                MANIFEST VERIFIED - {activeQuality.label.toUpperCase()} {activeQuality.codec} / {activeQuality.fps > 0 ? `${activeQuality.fps} FPS` : 'AUDIO'}
              </span>
            </div>
            <div className="studio-engine-pill">
              <span>{engineStatus}</span>
            </div>
          </div>
        </div>

        {/* =========================================================
           2. URL Input Bar & 1-Click Preset Chips
        ========================================================= */}
        <div className="studio-stream-bar">
          <form className="studio-url-row" onSubmit={handleAnalyzeStream}>
            <div className="studio-url-input-wrap">
              <span className="studio-url-icon">
                <IconSearch size={15} />
              </span>
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => {
                  setStreamUrl(e.target.value)
                  if (activePresetId) setActivePresetId('')
                }}
                placeholder="Enter stream manifest URL (e.g. .m3u8, .mpd, or direct link)..."
                className="studio-url-input"
                aria-label="Stream manifest URL"
              />
            </div>

            <button
              type="submit"
              disabled={isAnalyzing}
              className="studio-load-btn"
              aria-label="Load stream manifest"
            >
              {isAnalyzing ? (
                <>
                  <IconRefreshCw size={14} className="spin-slow" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <IconZap size={14} />
                  <span>Analyze Stream</span>
                </>
              )}
            </button>
          </form>

          <div className="studio-presets-row">
            <span className="studio-presets-label">Stream Presets:</span>
            {DEFAULT_STREAM_PRESETS.map((preset) => {
              const isActive = activePresetId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleLoadPreset(preset)}
                  className={`studio-preset-chip ${isActive ? 'is-active' : ''}`}
                >
                  <span>{preset.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* =========================================================
           3. Cinematic 16:9 Video Player Monitor
        ========================================================= */}
        <div className="studio-monitor-section">
          <div
            ref={monitorContainerRef}
            className={`studio-video-monitor ${isPlaying ? 'is-playing' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
          >
            {/* Monitor Backdrop Artwork */}
            <img
              src={posterUrl}
              alt="Stream Monitor Artwork"
              className="studio-monitor-backdrop"
            />
            <div className="studio-monitor-vignette" />
            <div className="studio-monitor-scanline" />

            {/* Top Overlay: Active Codec Tag & Precision Timecode Badge */}
            <div className="studio-monitor-header-overlay">
              <div className="studio-stream-tag">
                <span className="studio-stream-tag-dot" />
                <span>
                  {activeQuality.label} · {activeQuality.codec} {activeQuality.fps > 0 ? `${activeQuality.fps} FPS` : ''} · {activeQuality.bitrate}
                </span>
              </div>

              <div className="studio-timecode-badge">
                <span className="studio-timecode-current">
                  {formatTimecode(currentTime, true)}
                </span>
                <span className="studio-timecode-divider">/</span>
                <span className="studio-timecode-total">
                  {formatTimecode(duration, true)}
                </span>
              </div>
            </div>

            {/* Big Center Play Trigger (when paused) */}
            {!isPlaying && (
              <button
                type="button"
                onClick={() => {
                  playHapticClick()
                  setIsPlaying(true)
                }}
                className="studio-big-center-trigger"
                aria-label="Start playback"
              >
                <IconPlay size={26} />
              </button>
            )}

            {/* Bottom Glass Transport Dock */}
            <div className="studio-monitor-bottom-overlay">
              <div className="studio-transport-controls">
                {/* Jump to Start */}
                <button
                  type="button"
                  onClick={handleJumpStart}
                  className="studio-transport-btn"
                  title="Jump to Start"
                  aria-label="Jump to start of stream"
                >
                  <IconSkipBack size={14} />
                </button>

                {/* Step -1 Frame */}
                <button
                  type="button"
                  onClick={() => stepFrame(-1)}
                  className="studio-transport-btn"
                  title="Step Backward 1 Frame (1/60s)"
                  aria-label="Step backward 1 frame"
                >
                  <span>-1 Frame</span>
                </button>

                {/* Play / Pause */}
                <button
                  type="button"
                  onClick={() => {
                    playHapticClick()
                    setIsPlaying(!isPlaying)
                  }}
                  className="studio-transport-btn studio-play-btn"
                  title="Play / Pause (Space)"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
                </button>

                {/* Step +1 Frame */}
                <button
                  type="button"
                  onClick={() => stepFrame(1)}
                  className="studio-transport-btn"
                  title="Step Forward 1 Frame (1/60s)"
                  aria-label="Step forward 1 frame"
                >
                  <span>+1 Frame</span>
                </button>

                {/* Jump to End */}
                <button
                  type="button"
                  onClick={handleJumpEnd}
                  className="studio-transport-btn"
                  title="Jump to End"
                  aria-label="Jump to end of stream"
                >
                  <IconSkipForward size={14} />
                </button>
              </div>

              <div className="studio-monitor-aux-controls">
                {/* Audio Mute Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    playHapticClick()
                    setIsMuted(!isMuted)
                  }}
                  className="studio-icon-btn"
                  title={isMuted ? 'Unmute' : 'Mute'}
                  aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                >
                  {isMuted ? <IconVolumeX size={15} /> : <IconVolume2 size={15} />}
                </button>

                {/* Fullscreen Toggle */}
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  className="studio-icon-btn"
                  title="Toggle Fullscreen"
                  aria-label="Toggle fullscreen"
                >
                  <IconMaximize2 size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================
           4. Unified Pill Matrix: Quality, Audio, Subtitles
        ========================================================= */}
        <div ref={pillMatrixRef} className="studio-pill-matrix">
          {/* Pill 1: Quality Rendition */}
          <div className="studio-pill-wrapper">
            <button
              type="button"
              onClick={() => togglePopover('quality')}
              className={`studio-matrix-pill ${openPopover === 'quality' ? 'is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={openPopover === 'quality'}
              aria-label="Quality Renditions"
            >
              <div className="studio-pill-meta">
                <span className="studio-pill-category">Quality</span>
                <span className="studio-pill-value">
                  {activeQuality.label} · {activeQuality.bitrate}
                </span>
              </div>
              <span className="studio-pill-chevron">
                <IconChevronDown size={14} />
              </span>
            </button>

            {openPopover === 'quality' && (
              <div className="studio-micro-popover" role="listbox">
                <div className="studio-popover-header">
                  <span className="studio-popover-title">Stream Renditions</span>
                  <span className="studio-popover-count">
                    {DEFAULT_QUALITIES.length} Available
                  </span>
                </div>
                {DEFAULT_QUALITIES.map((q) => {
                  const isSelected = q.id === activeQuality.id
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => handleSelectQuality(q)}
                      className={`studio-popover-item ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="studio-popover-item-left">
                        <div className="studio-popover-item-title">
                          <span>{q.label}</span>
                          {q.badge && <span className="studio-item-badge">{q.badge}</span>}
                        </div>
                        <span className="studio-popover-item-sub">
                          {q.resolution} · {q.codec} {q.fps > 0 ? `· ${q.fps} fps` : ''}
                        </span>
                      </div>
                      <div className="studio-popover-item-right">
                        <span className="studio-popover-bitrate">{q.bitrate}</span>
                        {isSelected && <IconCheck size={14} className="studio-popover-check" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pill 2: Audio Track */}
          <div className="studio-pill-wrapper">
            <button
              type="button"
              onClick={() => togglePopover('audio')}
              className={`studio-matrix-pill ${openPopover === 'audio' ? 'is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={openPopover === 'audio'}
              aria-label="Audio Tracks"
            >
              <div className="studio-pill-meta">
                <span className="studio-pill-category">Audio</span>
                <span className="studio-pill-value">
                  {activeAudio.language.split(' ')[0]} {activeAudio.channels}
                </span>
              </div>
              <span className="studio-pill-chevron">
                <IconChevronDown size={14} />
              </span>
            </button>

            {openPopover === 'audio' && (
              <div className="studio-micro-popover" role="listbox">
                <div className="studio-popover-header">
                  <span className="studio-popover-title">Audio Streams</span>
                  <span className="studio-popover-count">
                    {DEFAULT_AUDIO_TRACKS.length} Available
                  </span>
                </div>
                {DEFAULT_AUDIO_TRACKS.map((a) => {
                  const isSelected = a.id === activeAudio.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleSelectAudio(a)}
                      className={`studio-popover-item ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="studio-popover-item-left">
                        <div className="studio-popover-item-title">
                          <span>{a.language}</span>
                        </div>
                        <span className="studio-popover-item-sub">
                          {a.channels} · {a.codec}
                        </span>
                      </div>
                      <div className="studio-popover-item-right">
                        <span className="studio-popover-bitrate">{a.bitrate}</span>
                        {isSelected && <IconCheck size={14} className="studio-popover-check" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pill 3: Subtitle Track */}
          <div className="studio-pill-wrapper">
            <button
              type="button"
              onClick={() => togglePopover('subtitle')}
              className={`studio-matrix-pill ${openPopover === 'subtitle' ? 'is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={openPopover === 'subtitle'}
              aria-label="Subtitle Tracks"
            >
              <div className="studio-pill-meta">
                <span className="studio-pill-category">Subtitles</span>
                <span className="studio-pill-value">
                  {activeSubtitle.id === 'none'
                    ? 'None / Off'
                    : activeSubtitle.language.replace(/ \(.*\)/, '')}
                </span>
              </div>
              <span className="studio-pill-chevron">
                <IconChevronDown size={14} />
              </span>
            </button>

            {openPopover === 'subtitle' && (
              <div className="studio-micro-popover" role="listbox">
                <div className="studio-popover-header">
                  <span className="studio-popover-title">Subtitle Streams</span>
                  <span className="studio-popover-count">
                    {DEFAULT_SUBTITLE_TRACKS.length} Available
                  </span>
                </div>
                {DEFAULT_SUBTITLE_TRACKS.map((s) => {
                  const isSelected = s.id === activeSubtitle.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectSubtitle(s)}
                      className={`studio-popover-item ${isSelected ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="studio-popover-item-left">
                        <div className="studio-popover-item-title">
                          <span>{s.language}</span>
                        </div>
                        <span className="studio-popover-item-sub">
                          Format: {s.format} {s.type !== 'off' ? `· ${s.type.toUpperCase()}` : ''}
                        </span>
                      </div>
                      <div className="studio-popover-item-right">
                        {isSelected && <IconCheck size={14} className="studio-popover-check" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* =========================================================
           5. Interactive Timeline Scrubber & Bitrate Budgeting Dock
        ========================================================= */}
        <div className="studio-timeline-section" id="studio-timeline-slot">
          <div className="studio-timeline-header">
            <div className="studio-timeline-title-wrap">
              <span className="studio-timeline-title">Timeline & Activity Heatmap</span>
            </div>

            <div className="studio-timeline-controls-row">
              {/* Quick Clip Marking Controls */}
              <div className="studio-quick-clip-buttons">
                <button
                  type="button"
                  onClick={handleMarkIn}
                  className="studio-quick-clip-btn"
                  title="Mark In Point at Playhead (I)"
                >
                  <span className="studio-btn-key">I</span>
                  <span>Mark In</span>
                </button>
                <button
                  type="button"
                  onClick={handleMarkOut}
                  className="studio-quick-clip-btn"
                  title="Mark Out Point at Playhead (O)"
                >
                  <span className="studio-btn-key">O</span>
                  <span>Mark Out</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetFullRange}
                  className="studio-quick-clip-btn studio-quick-clip-reset"
                  title="Reset In/Out to Full Stream Range"
                >
                  <IconRefreshCw size={12} />
                  <span>Reset Range</span>
                </button>
              </div>

              {/* Hotkey Guide */}
              <div className="studio-timeline-hotkeys">
                <span>[I] Mark In</span>
                <span className="meta-dot">·</span>
                <span>[O] Mark Out</span>
                <span className="meta-dot">·</span>
                <span>[Space] Play/Pause</span>
                <span className="meta-dot">·</span>
                <span>[Left/Right] Step Frame</span>
              </div>
            </div>
          </div>

          <div className="studio-timeline-slot-content">
            {/* Magnetic Timeline Scrubber Component with Ambient SVG Waveform & Draggable Handles */}
            <TimelineScrubber
              duration={duration}
              currentTime={currentTime}
              inPoint={inPoint}
              outPoint={outPoint}
              hypePeaks={DEFAULT_HYPE_PEAKS}
              onSeek={(time) => setCurrentTime(time)}
              onSetInPoint={(time) => setInPoint(time)}
              onSetOutPoint={(time) => setOutPoint(time)}
              onSelectPeak={handleJumpToPeak}
            />

            {/* Export Dock & Bitrate Budgeting Telemetry */}
            <div className="studio-export-dock">
              <div className="studio-dock-telemetry">
                <div className="studio-telemetry-item">
                  <span className="studio-telemetry-label">Range:</span>
                  <span className="studio-telemetry-badge">
                    {formatTimecode(inPoint, false)} - {formatTimecode(outPoint, false)}
                  </span>
                </div>
                <div className="studio-telemetry-item">
                  <span className="studio-telemetry-label">Duration:</span>
                  <span className="studio-telemetry-badge studio-telemetry-highlight">
                    {formatClipDuration(clipDuration)}
                  </span>
                </div>
                <div className="studio-telemetry-item">
                  <span className="studio-telemetry-label">Est. Size:</span>
                  <span className="studio-telemetry-badge studio-telemetry-size">
                    {activeEstimatedSize}
                  </span>
                </div>
                <div className="studio-telemetry-item">
                  <span className="studio-telemetry-label">Bitrate:</span>
                  <span className="studio-telemetry-badge">
                    {activeRecommendedBitrate}
                  </span>
                </div>
                <div className="studio-telemetry-item studio-telemetry-overhead">
                  <span className="studio-telemetry-label">Overhead:</span>
                  <span className="studio-overhead-text">~1.8% container mux</span>
                </div>
              </div>

              <div className="studio-dock-actions">
                <div className="studio-budget-selector" role="radiogroup" aria-label="Target Bitrate Budget Mode">
                  <button
                    type="button"
                    onClick={() => {
                      playHapticPop()
                      setSelectedBudget('lossless')
                    }}
                    className={`studio-budget-pill ${selectedBudget === 'lossless' ? 'is-active' : ''}`}
                    role="radio"
                    aria-checked={selectedBudget === 'lossless'}
                    title="Original lossless capture matching active quality bitrate"
                  >
                    <span className="studio-budget-title">Original Lossless</span>
                    <span className="studio-budget-sub">
                      {losslessSizeMB >= 1024
                        ? `${(losslessSizeMB / 1024).toFixed(2)} GB`
                        : `${losslessSizeMB.toFixed(1)} MB`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playHapticPop()
                      setSelectedBudget('discord')
                    }}
                    className={`studio-budget-pill ${selectedBudget === 'discord' ? 'is-active' : ''}`}
                    role="radio"
                    aria-checked={selectedBudget === 'discord'}
                    title="Locks file budget to 24.8 MB for safe Discord Nitro / Standard sharing"
                  >
                    <span className="studio-budget-title">Discord Safe (&lt;25 MB)</span>
                    <span className="studio-budget-sub">
                      {discordTargetVideoKbps >= 1000
                        ? `${(discordTargetVideoKbps / 1000).toFixed(1)}M · `
                        : `${discordTargetVideoKbps}k · `}
                      24.8 MB
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playHapticPop()
                      setSelectedBudget('social')
                    }}
                    className={`studio-budget-pill ${selectedBudget === 'social' ? 'is-active' : ''}`}
                    role="radio"
                    aria-checked={selectedBudget === 'social'}
                    title="Locks file budget to 9.8 MB for social media uploads"
                  >
                    <span className="studio-budget-title">Social (&lt;10 MB)</span>
                    <span className="studio-budget-sub">
                      {socialTargetVideoKbps >= 1000
                        ? `${(socialTargetVideoKbps / 1000).toFixed(1)}M · `
                        : `${socialTargetVideoKbps}k · `}
                      9.8 MB
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleExportClip}
                  className="studio-export-btn"
                  aria-label="Export clip to hub"
                >
                  <IconScissors size={14} />
                  <span>Export Clip to Hub</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StreamStudio
