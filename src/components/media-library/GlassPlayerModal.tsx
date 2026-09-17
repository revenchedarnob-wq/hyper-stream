import React, { useState, useEffect, useRef } from 'react'
import type { MediaItem } from './mock-media-data'
import {
  IconPlay,
  IconPause,
  IconX,
  IconVolume2,
  IconMaximize2,
} from '../stream-hub/Icons'
import {
  playHapticClick,
  playHapticGlass,
  playHapticPop,
  playHapticScrub,
} from '@/lib/sound'
import { GlassSelect } from '../common/GlassSelect'

interface GlassPlayerModalProps {
  item: MediaItem | null
  onClose: () => void
}

export const GlassPlayerModal: React.FC<GlassPlayerModalProps> = ({
  item,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [progress, setProgress] = useState(38)
  const [currentTime, setCurrentTime] = useState('00:00')
  const [selectedAudio, setSelectedAudio] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState('1x')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        playHapticGlass()
        onClose()
      }
      if (e.key === ' ' && item) {
        e.preventDefault()
        playHapticClick()
        setIsPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [item, onClose])

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(() => {})
      } else {
        videoRef.current.pause()
      }
    }
  }, [isPlaying])

  if (!item) return null

  return (
    <div className="player-modal-backdrop" onClick={onClose}>
      <div
        className="player-modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="player-modal-header">
          <div className="player-header-left">
            <span className="player-quality-pill">{item.quality}</span>
            <span className="player-codec-pill">{item.codec}</span>
            <span className="player-title">{item.title}</span>
          </div>

          <div className="player-header-right">
            <span className="player-bitrate-text">{item.bitrate}</span>
            <button
              type="button"
              className="player-close-btn"
              onClick={() => {
                playHapticGlass()
                onClose()
              }}
              title="Close Player (Esc)"
            >
              <IconX size={15} />
            </button>
          </div>
        </div>

        {/* Cinematic Screen Canvas Area */}
        <div className="player-screen-area" style={{ background: item.gradient, position: 'relative', overflow: 'hidden' }}>
          {item.videoUrl ? (
            <video
              ref={videoRef}
              src={item.videoUrl}
              className="player-html5-video"
              autoPlay={isPlaying}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (v.duration) {
                  setProgress((v.currentTime / v.duration) * 100)
                  const mins = Math.floor(v.currentTime / 60).toString().padStart(2, '0')
                  const secs = Math.floor(v.currentTime % 60).toString().padStart(2, '0')
                  setCurrentTime(`${mins}:${secs}`)
                }
              }}
              onEnded={() => setIsPlaying(false)}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div className="player-center-watermark">
              <div className="player-watermark-title">{item.title}</div>
              <div className="player-watermark-sub">{item.source} · Master Stream</div>
            </div>
          )}

          {!isPlaying && (
            <div className="player-paused-overlay">
              <div className="paused-badge">Paused</div>
            </div>
          )}
        </div>

        {/* Transport Controls Bar */}
        <div className="player-controls-bar">
          {/* Progress & Scrubber Line */}
          <div
            className="player-scrub-container"
            onClick={(e) => {
              playHapticScrub()
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
              setProgress(pct)
              if (videoRef.current && videoRef.current.duration) {
                videoRef.current.currentTime = (pct / 100) * videoRef.current.duration
              }
            }}
          >
            <div className="player-scrub-track">
              <div className="player-scrub-buffer" style={{ width: '64%' }} />
              <div className="player-scrub-fill" style={{ width: `${progress}%` }}>
                <div className="player-scrub-head" />
              </div>
            </div>
          </div>

          {/* Buttons & Time Row */}
          <div className="player-actions-row">
            <div className="player-actions-left">
              <button
                type="button"
                className="player-play-btn"
                onClick={() => {
                  playHapticClick()
                  setIsPlaying((p) => !p)
                }}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <IconPause size={15} /> : <IconPlay size={15} />}
              </button>

              <div className="player-time-display">
                <span className="time-current">{item.videoUrl ? currentTime : '09:14'}</span>
                <span className="time-sep">/</span>
                <span className="time-total">{item.duration}</span>
              </div>
            </div>

            <div className="player-actions-right">
              {/* Audio Track Selector */}
              <div className="player-audio-selector">
                <IconVolume2 size={14} className="player-audio-icon" />
                <GlassSelect
                  id="player-audio-track"
                  value={String(selectedAudio)}
                  options={item.audioTracks.map((track, idx) => ({
                    value: String(idx),
                    label: track,
                  }))}
                  onChange={(val) => setSelectedAudio(Number(val))}
                  ariaLabel="Select audio track"
                />
              </div>

              {/* Speed multiplier */}
              <button
                type="button"
                className="player-speed-btn"
                onClick={() => {
                  playHapticPop()
                  const speeds = ['1x', '1.25x', '1.5x', '2x']
                  const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length
                  setPlaybackSpeed(speeds[nextIdx])
                }}
                title="Playback Speed"
              >
                <span>{playbackSpeed}</span>
              </button>

              <button
                type="button"
                className="player-fullscreen-btn"
                title="Fullscreen Preview"
                onClick={() => {
                  playHapticClick()
                }}
              >
                <IconMaximize2 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}