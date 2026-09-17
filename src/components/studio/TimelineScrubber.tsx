import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { HypePeak } from './types'
import { formatTimecode } from './types'
import {
  playHapticClick,
  playHapticGlass,
  playHapticPop,
  playHapticScrub,
} from '@/lib/sound'

export interface TimelineScrubberProps {
  duration: number
  currentTime: number
  inPoint: number
  outPoint: number
  hypePeaks: HypePeak[]
  onSeek: (time: number) => void
  onSetInPoint: (time: number) => void
  onSetOutPoint: (time: number) => void
  onSelectPeak?: (peak: HypePeak) => void
}

/**
 * Generate smooth activity heatmap path points matching Hype Peaks and ambient energy.
 */
function generateWaveformPaths(
  duration: number,
  hypePeaks: HypePeak[],
  width = 1000,
  height = 64
): { areaPath: string; linePath: string } {
  const steps = 180
  const baseY = height * 0.72
  const points: { x: number; y: number }[] = []

  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width

    // Ambient baseline frequency modulation
    const ambient =
      Math.sin(i * 0.18) * 3.2 +
      Math.sin(i * 0.07 + 1.2) * 3.8 +
      Math.cos(i * 0.35 + 0.5) * 2.0

    // Peak energy elevation matching hype peaks
    let peakElevation = 0
    for (const peak of hypePeaks) {
      const peakX = (peak.seconds / Math.max(1, duration)) * width
      const dist = Math.abs(x - peakX)
      // Gaussian bell curve with ~28px spread
      const sigma = 26
      const bell = Math.exp(-Math.pow(dist / sigma, 2))
      const maxPeakSurge = (peak.energy / 100) * (height * 0.62)
      peakElevation = Math.max(peakElevation, bell * maxPeakSurge)

      if (dist < sigma * 2.2) {
        peakElevation += Math.sin(dist * 0.28) * (bell * 2.5)
      }
    }

    const y = Math.max(8, Math.min(height - 4, baseY - ambient - peakElevation))
    points.push({ x, y })
  }

  // Smooth quadratic bezier interpolation
  let linePath = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const midX = ((prev.x + curr.x) / 2).toFixed(1)
    const midY = ((prev.y + curr.y) / 2).toFixed(1)
    linePath += ` Q ${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${midX},${midY}`
  }
  const lastPoint = points[points.length - 1]
  linePath += ` L ${lastPoint.x.toFixed(1)},${lastPoint.y.toFixed(1)}`

  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`

  return { areaPath, linePath }
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  duration,
  currentTime,
  inPoint,
  outPoint,
  hypePeaks,
  onSeek,
  onSetInPoint,
  onSetOutPoint,
  onSelectPeak,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const inHandleRef = useRef<HTMLDivElement>(null)
  const outHandleRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)

  const [dragType, setDragType] = useState<'in' | 'out' | 'playhead' | null>(null)
  const [snappedPeak, setSnappedPeak] = useState<HypePeak | null>(null)
  const [hoverPeak, setHoverPeak] = useState<HypePeak | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [isHoveringTrack, setIsHoveringTrack] = useState<boolean>(false)

  const lastSnappedIdRef = useRef<string | null>(null)

  // Safe percentage coordinates
  const safeDuration = Math.max(1, duration)
  const inPercent = Math.min(100, Math.max(0, (inPoint / safeDuration) * 100))
  const outPercent = Math.min(100, Math.max(0, (outPoint / safeDuration) * 100))
  const currentPercent = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100))
  const clipWidthPercent = Math.max(0, outPercent - inPercent)

  // Memoized SVG waveform paths based on duration and hype peaks
  const { areaPath, linePath } = useMemo(
    () => generateWaveformPaths(duration, hypePeaks),
    [duration, hypePeaks]
  )

  // Calculate time from pointer coordinate with magnetic snapping
  const calculateTimeFromPointer = useCallback(
    (clientX: number): { time: number; snappedPeak: HypePeak | null } => {
      if (!trackRef.current) return { time: 0, snappedPeak: null }
      const rect = trackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return { time: 0, snappedPeak: null }

      const rawX = Math.max(0, Math.min(rect.width, clientX - rect.left))
      const ratio = rawX / rect.width
      let targetTime = ratio * safeDuration

      // Magnetic snapping threshold: +/- 12px or ~1.5% duration
      const snapThresholdSec = Math.max((12 / rect.width) * safeDuration, safeDuration * 0.015)
      let matchedPeak: HypePeak | null = null

      for (const peak of hypePeaks) {
        if (Math.abs(targetTime - peak.seconds) <= snapThresholdSec) {
          targetTime = peak.seconds
          matchedPeak = peak
          break
        }
      }

      return {
        time: Math.max(0, Math.min(safeDuration, targetTime)),
        snappedPeak: matchedPeak,
      }
    },
    [safeDuration, hypePeaks]
  )

  // Keyboard listener: 'I' for In-Point, 'O' for Out-Point
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }

      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        playHapticClick()
        const newIn = Math.min(currentTime, Math.max(0, outPoint - 0.1))
        onSetInPoint(newIn)
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        playHapticClick()
        const newOut = Math.max(currentTime, Math.min(safeDuration, inPoint + 0.1))
        onSetOutPoint(newOut)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentTime, safeDuration, inPoint, outPoint, onSetInPoint, onSetOutPoint])

  // In-Point Handle Pointer Events
  const handleInPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setDragType('in')
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Ignore capture failure in test environments
    }
    playHapticClick()
  }

  const handleInPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType !== 'in') return
    const { time, snappedPeak: snap } = calculateTimeFromPointer(e.clientX)
    const clampedTime = Math.min(time, Math.max(0, outPoint - 0.1))

    if (snap && snap.id !== lastSnappedIdRef.current) {
      lastSnappedIdRef.current = snap.id
      setSnappedPeak(snap)
      playHapticClick()
    } else if (!snap) {
      lastSnappedIdRef.current = null
      setSnappedPeak(null)
    }

    onSetInPoint(clampedTime)
  }

  const handleInPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType === 'in') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      setDragType(null)
      setSnappedPeak(null)
      lastSnappedIdRef.current = null
      playHapticPop()
    }
  }

  // Out-Point Handle Pointer Events
  const handleOutPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setDragType('out')
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    playHapticClick()
  }

  const handleOutPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType !== 'out') return
    const { time, snappedPeak: snap } = calculateTimeFromPointer(e.clientX)
    const clampedTime = Math.max(time, Math.min(safeDuration, inPoint + 0.1))

    if (snap && snap.id !== lastSnappedIdRef.current) {
      lastSnappedIdRef.current = snap.id
      setSnappedPeak(snap)
      playHapticClick()
    } else if (!snap) {
      lastSnappedIdRef.current = null
      setSnappedPeak(null)
    }

    onSetOutPoint(clampedTime)
  }

  const handleOutPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType === 'out') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      setDragType(null)
      setSnappedPeak(null)
      lastSnappedIdRef.current = null
      playHapticPop()
    }
  }

  // Playhead Pointer Events
  const handlePlayheadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    setDragType('playhead')
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    playHapticClick()
  }

  const handlePlayheadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType !== 'playhead') return
    const { time, snappedPeak: snap } = calculateTimeFromPointer(e.clientX)

    if (snap && snap.id !== lastSnappedIdRef.current) {
      lastSnappedIdRef.current = snap.id
      setSnappedPeak(snap)
      playHapticClick()
    } else if (!snap) {
      lastSnappedIdRef.current = null
      setSnappedPeak(null)
    }

    onSeek(time)
    playHapticScrub()
  }

  const handlePlayheadPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType === 'playhead') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {}
      setDragType(null)
      setSnappedPeak(null)
      lastSnappedIdRef.current = null
      playHapticPop()
    }
  }

  // Track Background Direct Click / Drag Seeking
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const { time, snappedPeak: snap } = calculateTimeFromPointer(e.clientX)
    onSeek(time)
    playHapticScrub()
    setDragType('playhead')
    if (snap) {
      setSnappedPeak(snap)
      lastSnappedIdRef.current = snap.id
      playHapticClick()
    }
    try {
      trackRef.current?.setPointerCapture(e.pointerId)
    } catch {}
  }

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType === 'playhead') {
      const { time, snappedPeak: snap } = calculateTimeFromPointer(e.clientX)
      if (snap && snap.id !== lastSnappedIdRef.current) {
        lastSnappedIdRef.current = snap.id
        setSnappedPeak(snap)
        playHapticClick()
      } else if (!snap) {
        lastSnappedIdRef.current = null
        setSnappedPeak(null)
      }
      onSeek(time)
      playHapticScrub()
    } else if (trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect()
      const rawX = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
      setHoverTime((rawX / rect.width) * safeDuration)
    }
  }

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragType === 'playhead') {
      try {
        trackRef.current?.releasePointerCapture(e.pointerId)
      } catch {}
      setDragType(null)
      setSnappedPeak(null)
      lastSnappedIdRef.current = null
      playHapticPop()
    }
  }

  // Peak Jump Click
  const handlePeakClick = (e: React.MouseEvent, peak: HypePeak) => {
    e.stopPropagation()
    playHapticGlass()
    const jumpTarget = Math.max(0, peak.seconds - 5)
    onSeek(jumpTarget)
    if (onSelectPeak) {
      onSelectPeak(peak)
    }
  }

  // Time ruler ticks (0%, 25%, 50%, 75%, 100%)
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1.0].map((fraction) => ({
    fraction,
    percent: fraction * 100,
    timecode: formatTimecode(fraction * safeDuration, false),
  }))

  return (
    <div className="studio-timeline-scrubber" aria-label="Magnetic Timeline Scrubber">
      {/* 1. Time Ruler Header */}
      <div className="studio-timeline-ruler">
        {rulerTicks.map((tick) => (
          <div
            key={tick.fraction}
            className="studio-ruler-tick-wrap"
            style={{ left: `${tick.percent}%` }}
          >
            <div className="studio-ruler-notch" />
            <span className="studio-ruler-timecode">{tick.timecode}</span>
          </div>
        ))}

        {/* Hover Time Indicator */}
        {isHoveringTrack && hoverTime !== null && !dragType && (
          <div
            className="studio-hover-time-tag"
            style={{
              left: `${Math.min(96, Math.max(4, (hoverTime / safeDuration) * 100))}%`,
            }}
          >
            <span>{formatTimecode(hoverTime, true)}</span>
          </div>
        )}
      </div>

      {/* 2. Interactive Timeline Track */}
      <div
        ref={trackRef}
        className={`studio-timeline-track ${dragType ? 'is-dragging' : ''}`}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerCancel={handleTrackPointerUp}
        onMouseEnter={() => setIsHoveringTrack(true)}
        onMouseLeave={() => {
          setIsHoveringTrack(false)
          setHoverTime(null)
        }}
        role="slider"
        aria-label="Timeline position slider"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
      >
        {/* Ambient Activity Heatmap & Waveform SVG */}
        <svg
          viewBox="0 0 1000 64"
          preserveAspectRatio="none"
          className="studio-waveform-svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="studioHeatmapGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-primary, #6366f1)" stopOpacity="0.45" />
              <stop offset="60%" stopColor="var(--color-brand-primary, #6366f1)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-brand-primary, #6366f1)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="studioHeatmapClipGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-primary, #6366f1)" stopOpacity="0.75" />
              <stop offset="100%" stopColor="var(--color-brand-primary, #6366f1)" stopOpacity="0.20" />
            </linearGradient>
          </defs>

          {/* Ambient Waveform Fill */}
          <path d={areaPath} fill="url(#studioHeatmapGrad)" />

          {/* Glowing Crest Line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand-primary, #818cf8)"
            strokeWidth="1.8"
            strokeOpacity="0.85"
          />
        </svg>

        {/* Frosted Shading: Region Before In-Point */}
        <div
          className="studio-frosted-mask studio-mask-before"
          style={{ width: `${inPercent}%` }}
        />

        {/* Frosted Shading: Region After Out-Point */}
        <div
          className="studio-frosted-mask studio-mask-after"
          style={{ left: `${outPercent}%`, right: 0 }}
        />

        {/* Highlighted Selection Clip Span [In, Out] */}
        <div
          className="studio-clip-region"
          style={{
            left: `${inPercent}%`,
            width: `${clipWidthPercent}%`,
          }}
        >
          <div className="studio-clip-top-border" />
          <div className="studio-clip-bottom-border" />
          <div className="studio-clip-center-pill">
            <span>{formatTimecode(Math.max(0, outPoint - inPoint), false)}</span>
          </div>
        </div>

        {/* Magnetic Snapping Flash Guide */}
        {snappedPeak && (
          <div
            className="studio-snap-indicator"
            style={{
              left: `${(snappedPeak.seconds / safeDuration) * 100}%`,
            }}
          >
            <div className="studio-snap-line" />
            <div className="studio-snap-badge">
              <span>SNAP: {snappedPeak.label}</span>
            </div>
          </div>
        )}

        {/* Hype Peak Markers */}
        {hypePeaks.map((peak) => {
          const peakPercent = (peak.seconds / safeDuration) * 100
          const isSelected = Math.abs(currentTime - (peak.seconds - 5)) < 1.0
          const isHovered = hoverPeak?.id === peak.id

          return (
            <div
              key={peak.id}
              className={`studio-peak-marker studio-peak-${peak.category || 'combat'} ${isSelected ? 'is-selected' : ''}`}
              style={{
                left: `${peakPercent}%`,
                transform: 'translate3d(-50%, 0, 0)',
              }}
              onClick={(e) => handlePeakClick(e, peak)}
              onMouseEnter={() => setHoverPeak(peak)}
              onMouseLeave={() => setHoverPeak(null)}
              role="button"
              tabIndex={0}
              aria-label={`Jump to ${peak.label} at ${peak.timestamp}`}
            >
              <div className="studio-peak-diamond" />
              <span className="studio-peak-tag">{peak.label}</span>

              {/* Peak Micro Tooltip */}
              {isHovered && (
                <div className="studio-peak-tooltip">
                  <div className="studio-peak-tooltip-header">
                    <span className="studio-peak-tooltip-title">{peak.label}</span>
                    <span className="studio-peak-tooltip-energy">{peak.energy}% Energy</span>
                  </div>
                  <div className="studio-peak-tooltip-body">
                    <span>{peak.timestamp}</span>
                    <span className="meta-dot">·</span>
                    <span>Click to jump (-5s)</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Draggable In-Point Handle */}
        <div
          ref={inHandleRef}
          className={`studio-handle-in ${dragType === 'in' ? 'is-dragging' : ''}`}
          style={{
            left: `${inPercent}%`,
            transform: 'translate3d(-100%, 0, 0)',
          }}
          onPointerDown={handleInPointerDown}
          onPointerMove={handleInPointerMove}
          onPointerUp={handleInPointerUp}
          onPointerCancel={handleInPointerUp}
          role="slider"
          aria-label="Mark In Handle"
          aria-valuenow={inPoint}
          tabIndex={0}
        >
          <div className="studio-handle-flag">
            <span className="studio-handle-bracket">[</span>
            <span className="studio-handle-text">IN</span>
          </div>
          <div className="studio-handle-stem">
            <div className="studio-handle-grip" />
          </div>
          <div className="studio-handle-time-pill">
            <span>{formatTimecode(inPoint, true)}</span>
          </div>
        </div>

        {/* Draggable Out-Point Handle */}
        <div
          ref={outHandleRef}
          className={`studio-handle-out ${dragType === 'out' ? 'is-dragging' : ''}`}
          style={{
            left: `${outPercent}%`,
            transform: 'translate3d(0, 0, 0)',
          }}
          onPointerDown={handleOutPointerDown}
          onPointerMove={handleOutPointerMove}
          onPointerUp={handleOutPointerUp}
          onPointerCancel={handleOutPointerUp}
          role="slider"
          aria-label="Mark Out Handle"
          aria-valuenow={outPoint}
          tabIndex={0}
        >
          <div className="studio-handle-flag">
            <span className="studio-handle-text">OUT</span>
            <span className="studio-handle-bracket">]</span>
          </div>
          <div className="studio-handle-stem">
            <div className="studio-handle-grip" />
          </div>
          <div className="studio-handle-time-pill">
            <span>{formatTimecode(outPoint, true)}</span>
          </div>
        </div>

        {/* Draggable Playhead Scrubber Line */}
        <div
          ref={playheadRef}
          className={`studio-playhead-line ${dragType === 'playhead' ? 'is-dragging' : ''}`}
          style={{
            left: `${currentPercent}%`,
            transform: 'translate3d(-50%, 0, 0)',
          }}
          onPointerDown={handlePlayheadPointerDown}
          onPointerMove={handlePlayheadPointerMove}
          onPointerUp={handlePlayheadPointerUp}
          onPointerCancel={handlePlayheadPointerUp}
          role="slider"
          aria-label="Current Playhead"
          aria-valuenow={currentTime}
          tabIndex={0}
        >
          <div className="studio-playhead-head">
            <div className="studio-playhead-notch" />
          </div>
          <div className="studio-playhead-shaft" />
          <div className="studio-playhead-time-badge">
            <span>{formatTimecode(currentTime, true)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TimelineScrubber
