import React, { useState, useEffect, useRef } from 'react'
import './stream-hub.css'
import {
  IconSearch,
  IconSparkles,
  IconX,
  IconClipboard,
  IconCheck,
  IconAlertCircle,
  IconLoader,
} from './Icons'
import { playHapticClick, playHapticPop } from '@/lib/sound'
import { GlassSelect } from '../common/GlassSelect'
import { TelemetryVitals } from './TelemetryVitals'
import { ActivePipeline } from './ActivePipeline'
import type { DownloadItem } from './ActivePipeline'
import { RecentCaptures } from './RecentCaptures'
import type { RecentItem } from './RecentCaptures'
import { ManifestDropzone } from './ManifestDropzone'
import { revealInExplorer } from '@/lib/tauri-bridge'

export type QualityTier = 'Best' | '1080p' | '720p' | '480p' | 'Audio'

const QUALITY_OPTIONS = [
  { value: 'Best', label: 'Best' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: 'Audio', label: 'Audio' },
]

const AUDIO_TRACK_OPTIONS = [
  { value: 'JPN 5.1', label: 'Audio: JPN 5.1' },
  { value: 'ENG 2.0', label: 'Audio: ENG 2.0' },
  { value: 'Commentary', label: 'Audio: Commentary' },
  { value: 'All Tracks', label: 'Audio: All Tracks' },
]

const SUBTITLE_TRACK_OPTIONS = [
  { value: 'ENG', label: 'Subs: ENG' },
  { value: 'ENG Signs', label: 'Subs: ENG Signs' },
  { value: 'SPA', label: 'Subs: SPA' },
  { value: 'Off', label: 'Subs: Off' },
]

import { isValidStreamUrl } from './validation'

export interface OmnibarProps {
  onAnalyze: (url: string, preset: QualityTier, audioTrack?: string, subtitleTrack?: string) => void
  isAnalyzing: boolean
}

export const Omnibar: React.FC<OmnibarProps> = ({ onAnalyze, isAnalyzing }) => {
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState<QualityTier>('Best')
  const [audioTrack, setAudioTrack] = useState('JPN 5.1')
  const [subtitleTrack, setSubtitleTrack] = useState('ENG')
  const [clipboardPrompt, setClipboardPrompt] = useState<string | null>(
    'https://stream-cdn.animex.net/hls/frieren-ep29/master.m3u8'
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const prevAnalyzingRef = useRef(isAnalyzing)

  useEffect(() => {
    if (prevAnalyzingRef.current && !isAnalyzing) {
      setCaptureStatus('success')
      const timer = setTimeout(() => {
        setCaptureStatus('idle')
      }, 1400)
      return () => clearTimeout(timer)
    }
    prevAnalyzingRef.current = isAnalyzing
  }, [isAnalyzing])

  useEffect(() => {
    const checkClipboard = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = (await navigator.clipboard.readText()).trim()
          if (isValidStreamUrl(text)) {
            setClipboardPrompt(text)
          }
        }
      } catch {
        // Clipboard read permission might be denied
      }
    }

    checkClipboard()
    window.addEventListener('focus', checkClipboard)
    return () => window.removeEventListener('focus', checkClipboard)
  }, [])

  const getClipboardLabel = (clipUrl: string) => {
    if (clipUrl.includes('frieren')) return 'Frieren Ep 29'
    if (clipUrl.includes('youtube') || clipUrl.includes('youtu.be')) return 'YouTube Stream'
    if (clipUrl.includes('twitch')) return 'Twitch Live'
    if (clipUrl.includes('.m3u8')) return 'HLS Master'
    if (clipUrl.includes('.mpd')) return 'DASH Stream'
    return 'Detected Stream'
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value)
    if (validationError) {
      setValidationError(null)
    }
    if (captureStatus === 'error') {
      setCaptureStatus('idle')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || isAnalyzing) return

    if (!isValidStreamUrl(trimmed)) {
      playHapticPop()
      setIsShaking(true)
      setValidationError('Please enter a valid stream URL (e.g. .m3u8, .mpd, or video link)')
      setCaptureStatus('error')
      setTimeout(() => setIsShaking(false), 500)
      setTimeout(() => {
        setCaptureStatus('idle')
      }, 2000)
      return
    }

    setValidationError(null)
    playHapticClick()
    onAnalyze(trimmed, quality, audioTrack, subtitleTrack)
  }

  const handlePasteClipboard = () => {
    if (clipboardPrompt) {
      playHapticPop()
      setUrl(clipboardPrompt)
      setValidationError(null)
      onAnalyze(clipboardPrompt, quality, audioTrack, subtitleTrack)
      setClipboardPrompt(null)
    }
  }


  const isUrlValid = url.trim().length > 0 && isValidStreamUrl(url.trim())
  const hasUrlContent = url.trim().length > 0
  const effectiveStatus = isAnalyzing ? 'loading' : captureStatus

  return (
    <div className="omnibar-wrapper">
      <form
        onSubmit={handleSubmit}
        className={`omnibar-card ${isShaking ? 'omnibar-shake' : ''} ${validationError ? 'omnibar-invalid' : ''} ${isUrlValid ? 'omnibar-valid' : ''}`}
      >
        <div className={`omnibar-icon-prefix ${isUrlValid ? 'is-valid' : ''}`}>
          {effectiveStatus === 'loading' ? (
            <IconLoader size={17} className="omnibar-spin-icon" />
          ) : isUrlValid ? (
            <IconSearch size={17} className="omnibar-search-valid" />
          ) : (
            <IconSearch size={17} />
          )}
        </div>

        <input
          ref={inputRef}
          id="stream-url-input"
          name="streamUrl"
          type="text"
          className="omnibar-input"
          placeholder="Paste stream or video link..."
          value={url}
          onChange={handleInputChange}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />

        <div className="omnibar-actions">
          {!hasUrlContent && clipboardPrompt && (
            <div className="omnibar-clipboard-chip" role="status" aria-label="Detected clipboard link">
              <button
                type="button"
                className="clipboard-chip-button"
                onClick={handlePasteClipboard}
                title={`Paste and ingest: ${clipboardPrompt}`}
              >
                <IconClipboard size={12} className="clipboard-chip-icon" />
                <span className="clipboard-chip-text">{getClipboardLabel(clipboardPrompt)}</span>
                <span className="clipboard-chip-badge">Paste</span>
              </button>
              <button
                type="button"
                className="clipboard-chip-close"
                onClick={() => setClipboardPrompt(null)}
                title="Dismiss clipboard suggestion"
                aria-label="Dismiss"
              >
                <IconX size={11} />
              </button>
            </div>
          )}

          {hasUrlContent && (
            <button
              type="button"
              className="omnibar-clear-btn"
              onClick={() => {
                playHapticClick()
                setUrl('')
                setValidationError(null)
                setCaptureStatus('idle')
                inputRef.current?.focus()
              }}
              title="Clear input"
              aria-label="Clear input"
            >
              <IconX size={13} />
            </button>
          )}

          {/* Quick Manifest Track Badges (Audio & Subtitles) */}
          {hasUrlContent && (
            <div className="stream-hub-quick-badges" role="group" aria-label="Stream manifest tracks">
              <GlassSelect
                id="stream-audio-track-select"
                value={audioTrack}
                options={AUDIO_TRACK_OPTIONS}
                onChange={setAudioTrack}
                className="stream-hub-badge-select"
                ariaLabel="Select audio stream track"
              />
              <GlassSelect
                id="stream-subs-track-select"
                value={subtitleTrack}
                options={SUBTITLE_TRACK_OPTIONS}
                onChange={setSubtitleTrack}
                className="stream-hub-badge-select"
                ariaLabel="Select subtitle track"
              />
            </div>
          )}

          {/* 5-Tier Quality Selector */}
          <div className="omnibar-preset-wrapper">
            <GlassSelect
              id="stream-preset-select"
              value={quality}
              options={QUALITY_OPTIONS}
              onChange={(val) => setQuality(val as QualityTier)}
              ariaLabel="Select stream quality tier"
            />
          </div>


          {/* Primary Ingestion Trigger */}
          <button
            type="submit"
            className={`omnibar-submit-btn state-${effectiveStatus} ${!hasUrlContent ? 'is-empty' : ''}`}
            disabled={!hasUrlContent || isAnalyzing}
            title={!hasUrlContent ? 'Enter stream URL to capture' : 'Capture and ingest stream'}
            aria-label={isAnalyzing ? 'Ingesting stream' : 'Capture stream'}
          >
            {effectiveStatus === 'loading' ? (
              <>
                <IconLoader size={14} className="omnibar-spin-icon" />
                <span>Ingesting...</span>
              </>
            ) : effectiveStatus === 'success' ? (
              <>
                <IconCheck size={14} className="omnibar-success-icon" />
                <span>Captured</span>
              </>
            ) : effectiveStatus === 'error' ? (
              <>
                <IconAlertCircle size={14} />
                <span>Invalid URL</span>
              </>
            ) : (
              <>
                <IconSparkles size={14} />
                <span>Capture</span>
              </>
            )}
          </button>
        </div>
      </form>

      {validationError && (
        <div className="omnibar-error-hint" role="alert">
          <IconAlertCircle size={12} />
          <span>{validationError}</span>
        </div>
      )}
    </div>
  )
}


const INITIAL_DOWNLOADS: DownloadItem[] = [
  {
    id: 'dl-1',
    title: "Frieren: Beyond Journey's End · Season 1",
    sourceType: 'anime',
    quality: '1080p',
    codec: 'HEVC',
    audioLang: 'Dual Audio',
    progress: 28,
    downloadedSize: '9.36 GB',
    totalSize: '37.4 GB',
    speed: '28.4 MB/s',
    eta: '16m 25s',
    status: 'downloading',
    batch: {
      seriesTitle: "Frieren: Beyond Journey's End",
      seasonNumber: 1,
      totalEpisodes: 24,
      completedEpisodes: 6,
      overallProgress: 28,
      aggregateSpeed: '28.4 MB/s',
      timeRemaining: '16m 25s',
      isExpanded: false,
      episodes: [
        {
          id: 'dl-1-ep-1',
          episodeNumber: 1,
          title: "Ep 01: The Journey's End",
          size: '1.56 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-2',
          episodeNumber: 2,
          title: "Ep 02: It Didn't Have to Be Magic...",
          size: '1.52 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-3',
          episodeNumber: 3,
          title: 'Ep 03: Killing Magic',
          size: '1.55 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-4',
          episodeNumber: 4,
          title: 'Ep 04: The Land Where Souls Rest',
          size: '1.54 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-5',
          episodeNumber: 5,
          title: 'Ep 05: Phantoms of the Dead',
          size: '1.58 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-6',
          episodeNumber: 6,
          title: 'Ep 06: The Hero of the Village',
          size: '1.53 GB',
          status: 'completed',
          progress: 100,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-7',
          episodeNumber: 7,
          title: 'Ep 07: Like a Fairy Tale',
          size: '1.55 GB',
          status: 'ingesting',
          progress: 68,
          speed: '28.4 MB/s',
        },
        {
          id: 'dl-1-ep-8',
          episodeNumber: 8,
          title: 'Ep 08: Frieren the Slayer',
          size: '1.60 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-9',
          episodeNumber: 9,
          title: 'Ep 09: Aura the Guillotine',
          size: '1.62 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-10',
          episodeNumber: 10,
          title: 'Ep 10: A Powerful Mage',
          size: '1.56 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-11',
          episodeNumber: 11,
          title: 'Ep 11: Winter in the Northern Lands',
          size: '1.51 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-12',
          episodeNumber: 12,
          title: 'Ep 12: A Real Hero',
          size: '1.57 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-13',
          episodeNumber: 13,
          title: "Ep 13: Aversion to One's Own Kind",
          size: '1.53 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-14',
          episodeNumber: 14,
          title: 'Ep 14: Privilege of the Young',
          size: '1.58 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-15',
          episodeNumber: 15,
          title: 'Ep 15: Smells of Trouble',
          size: '1.52 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-16',
          episodeNumber: 16,
          title: 'Ep 16: Long-Lived Friends',
          size: '1.54 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-17',
          episodeNumber: 17,
          title: 'Ep 17: Take Care',
          size: '1.55 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-18',
          episodeNumber: 18,
          title: 'Ep 18: First-Class Mage Exam',
          size: '1.61 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-19',
          episodeNumber: 19,
          title: 'Ep 19: Well-Laid Plans',
          size: '1.56 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-20',
          episodeNumber: 20,
          title: 'Ep 20: Necessary Killing',
          size: '1.59 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-21',
          episodeNumber: 21,
          title: 'Ep 21: The World of Magic',
          size: '1.57 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-22',
          episodeNumber: 22,
          title: 'Ep 22: Future Enemies',
          size: '1.53 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-23',
          episodeNumber: 23,
          title: 'Ep 23: Conquering the Labyrinth',
          size: '1.60 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
        {
          id: 'dl-1-ep-24',
          episodeNumber: 24,
          title: 'Ep 24: Perfect Replicas',
          size: '1.63 GB',
          status: 'queued',
          progress: 0,
          speed: '0 MB/s',
        },
      ],
    },
  },
  {
    id: 'dl-2',
    title: 'The Primeagen · Stream Catchup',
    sourceType: 'stream',
    quality: '1440p',
    codec: 'AV1',
    audioLang: 'Stereo',
    progress: 42,
    downloadedSize: '4.10 GB',
    totalSize: '9.80 GB',
    speed: '14.4 MB/s',
    eta: '1m 40s',
    status: 'downloading',
  },
]

const INITIAL_RECENTS: RecentItem[] = [
  {
    id: 'rec-1',
    title: 'Jujutsu Kaisen S2 · Ep 23',
    quality: '1080p',
    size: '1.45 GB',
    duration: '23:40',
    timestamp: '12m ago',
  },
  {
    id: 'rec-2',
    title: 'GDC 2026 Keynote',
    quality: '4K',
    size: '5.80 GB',
    duration: '1h 14m',
    timestamp: '2h ago',
  },
  {
    id: 'rec-3',
    title: 'Cyberpunk Edgerunners OST',
    quality: 'FLAC',
    size: '420 MB',
    duration: '42:15',
    timestamp: 'Yesterday',
  },
]

export const StreamHub: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>(INITIAL_DOWNLOADS)
  const [recents] = useState<RecentItem[]>(INITIAL_RECENTS)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)

  const showNotification = (msg: string) => {
    setNotification(msg)
    setTimeout(() => {
      setNotification((current) => (current === msg ? null : current))
    }, 3200)
  }

  const handleAnalyze = (
    url: string,
    preset: QualityTier,
    audioTrack = 'JPN 5.1',
    subtitleTrack = 'ENG'
  ) => {
    setIsAnalyzing(true)

    // Simulate probing stream metadata
    setTimeout(() => {
      setIsAnalyzing(false)

      let title = 'Live Stream Capture'
      if (url.includes('frieren')) title = 'Frieren - Special OAV Stream'
      else if (url.includes('youtube') || url.includes('youtu.be')) title = 'YouTube 4K High-Bitrate Capture'
      else if (url.includes('.m3u8')) title = 'HLS Live Ingestion Stream'
      else if (url.includes('.mpd')) title = 'DASH Multi-Track Audio Master'

      const qualityMap: Record<QualityTier, string> = {
        Best: 'Best (4K HDR)',
        '1080p': '1080p HEVC',
        '720p': '720p HD',
        '480p': '480p SD',
        Audio: 'Audio (Lossless)',
      }

      const quality = qualityMap[preset] || 'Best (4K HDR)'
      const codec = preset === 'Audio' ? 'FLAC / AAC' : 'HEVC / AAC'
      const audioLang = preset === 'Audio' ? 'Lossless FLAC' : `${audioTrack} · Subs: ${subtitleTrack}`

      const newItem: DownloadItem = {
        id: `dl-${Date.now()}`,
        title,
        sourceType: 'anime',
        quality,
        codec,
        audioLang,
        progress: 4,
        downloadedSize: preset === 'Audio' ? '12 MB' : '84 MB',
        totalSize: preset === 'Audio' ? '240 MB' : '2.10 GB',
        speed: '36.2 MB/s',
        eta: '54s',
        status: 'downloading',
      }

      setDownloads((prev) => [newItem, ...prev])
      showNotification(`Stream parsed successfully: ${title}`)
    }, 750)
  }


  const handleTogglePause = (id: string) => {
    setDownloads((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextStatus = item.status === 'paused' ? 'downloading' : 'paused'
          return { ...item, status: nextStatus }
        }
        return item
      })
    )
  }

  const handleCancel = (id: string) => {
    setDownloads((prev) => prev.filter((item) => item.id !== id))
    showNotification('Download cancelled and staging cache cleared')
  }

  const handlePlay = (item: RecentItem) => {
    showNotification(`Launching playback for: ${item.title}`)
  }

  const handleOpenFolder = (item: RecentItem) => {
    revealInExplorer(`C:\\Users\\arnob\\Downloads\\${item.title}.mp4`)
    showNotification(`Revealed in Explorer: ${item.title}`)
  }

  const handleRetry = (id: string) => {
    setDownloads((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            status: 'downloading',
            progress: 8,
            speed: '31.5 MB/s',
            eta: '48s',
            errorReason: undefined,
          }
        }
        return item
      })
    )
    showNotification('Transfer restarted from staging checkpoint')
  }

  const handleFilesDropped = (files: FileList) => {
    const fileNames = Array.from(files).map((f) => f.name).join(', ')
    Array.from(files).forEach((file) => {
      const isM3u8 = file.name.toLowerCase().endsWith('.m3u8')
      const newItem: DownloadItem = {
        id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: file.name.replace(/\.(m3u8|mpd|txt|json)$/i, ''),
        sourceType: isM3u8 ? 'anime' : 'stream',
        quality: isM3u8 ? '1080p Master' : 'Original',
        codec: 'HEVC / OPUS',
        audioLang: 'Multi-Track',
        progress: 0,
        downloadedSize: '0 MB',
        totalSize: '2.40 GB',
        speed: '34.2 MB/s',
        eta: 'Calculating...',
        status: 'downloading',
      }
      setDownloads((prev) => [newItem, ...prev])
    })
    showNotification(`Queued transfer from manifest: ${fileNames}`)
  }

  const liveThroughput = downloads
    .filter((d) => d.status === 'downloading' || d.status === 'ingesting')
    .reduce((acc, d) => acc + (parseFloat(d.speed) || 0), 0)

  return (
    <div className="stream-hub-container">
      {/* Toast Notification */}
      {notification && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '20px',
            background: 'rgba(24, 9, 47, 0.94)',
            color: '#ffffff',
            padding: '9px 16px',
            borderRadius: '8px',
            fontSize: '12.5px',
            fontWeight: 500,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            zIndex: 100,
            animation: 'bannerSlideIn 240ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
        >
          {notification}
        </div>
      )}

      <div className="stream-hub-content">
        {/* Unified Top Header */}
        <div className="stream-hub-header">
          <h1 className="stream-hub-title">Stream Hub</h1>
          <div className="hub-status-pill">
            <span className={`hub-status-dot ${liveThroughput > 0 ? 'is-active' : ''}`} />
            <span className="hub-status-throughput">
              {liveThroughput > 0 ? `${liveThroughput.toFixed(1)} MB/s Ingesting` : 'Engine Ready'}
            </span>
            <span className="meta-dot">·</span>
            <span className="hub-status-engine">NVENC Turbo</span>
          </div>
        </div>

        {/* 1. Hero Stream Ingestion Omnibar */}
        <Omnibar
          onAnalyze={handleAnalyze}
          isAnalyzing={isAnalyzing}
        />


        {/* 2. Engine & Throughput Vitals */}
        <TelemetryVitals
          throughput={liveThroughput || 0}
          activeCount={downloads.filter((d) => d.status === 'downloading' || d.status === 'ingesting').length}
          queuedCount={downloads.filter((d) => d.status === 'paused' || d.status === 'queued').length}
        />

        {/* 3 & 4. Bento Split Area: Active Pipeline (Left) & Recents/Dropzone (Right) */}
        <div className="hub-bento-split">
          <ActivePipeline
            items={downloads}
            onTogglePause={handleTogglePause}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />

          <div className="hub-sidebar-aux">
            <RecentCaptures
              items={recents}
              onPlay={handlePlay}
              onOpenFolder={handleOpenFolder}
            />

            <ManifestDropzone onFilesDropped={handleFilesDropped} />
          </div>
        </div>
      </div>
    </div>
  )
}
export default StreamHub