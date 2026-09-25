import React, { useState, useMemo } from 'react'
import { playHapticClick, playHapticGlass } from '@/lib/sound'
import { invoke } from '@tauri-apps/api/core'
import { IconX, IconCheck, IconFolder, IconDownload } from './Icons'

export interface MediaFormat {
  format_id: string
  extension: string
  resolution?: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  tbr?: number
  is_video: boolean
  is_audio: boolean
}

export interface SubtitleTrack {
  language: string
  url?: string
  ext: string
}

export interface AudioVersion {
  audioLocale: string
  guid: string
  original: boolean
}

export interface FormatPickerModalProps {
  isOpen: boolean
  onClose: () => void
  url: string
  title: string
  thumbnail?: string
  duration?: number
  formats: MediaFormat[]
  subtitles: SubtitleTrack[]
  crunchyrollVersions?: AudioVersion[]
  onConfirmDownload: (options: {
    formatId?: string
    title: string
    audioFormats: string[]
    subtitles: string[]
    outputDir?: string
  }) => void
}

export const FormatPickerModal: React.FC<FormatPickerModalProps> = ({
  isOpen,
  onClose,
  url,
  title,
  thumbnail,
  duration,
  formats,
  subtitles,
  crunchyrollVersions,
  onConfirmDownload,
}) => {
  const [selectedFormatId, setSelectedFormatId] = useState<string>('')
  const [selectedAudioLangs, setSelectedAudioLangs] = useState<string[]>([])
  const [selectedSubLangs, setSelectedSubLangs] = useState<string[]>([])
  const [customTitle, setCustomTitle] = useState(title)
  const [customOutputDir, setCustomOutputDir] = useState<string>('')

  // Video formats sorted by height descending
  const videoFormats = useMemo(() => {
    const list = formats.filter((f) => f.is_video && (f.height || 0) > 0)
    list.sort((a, b) => (b.height || 0) - (a.height || 0))
    // Deduplicate by resolution and prefer modern codecs (AV1/VP9 over H264)
    const seen = new Set<number>()
    const deduped: MediaFormat[] = []
    for (const f of list) {
      const h = f.height || 0
      if (!seen.has(h)) {
        seen.add(h)
        deduped.push(f)
      }
    }
    return deduped
  }, [formats])

  // Select best video by default
  React.useEffect(() => {
    if (videoFormats.length > 0 && !selectedFormatId) {
      setSelectedFormatId(videoFormats[0].format_id)
    }
    setCustomTitle(title)
  }, [videoFormats, title])

  // Initialize audio versions
  React.useEffect(() => {
    if (crunchyrollVersions && crunchyrollVersions.length > 0) {
      setSelectedAudioLangs(crunchyrollVersions.map((v) => v.audioLocale))
    }
  }, [crunchyrollVersions])

  if (!isOpen) return null

  const formatDuration = (sec?: number) => {
    if (!sec || sec <= 0) return ''
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    const h = Math.floor(m / 60)
    if (h > 0) {
      return `${h}h ${m % 60}m`
    }
    return `${m}m ${s}s`
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return ''
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handlePickDirectory = async () => {
    playHapticClick()
    try {
      const chosen = await invoke<string | null>('pick_storage_folder')
      if (chosen) {
        setCustomOutputDir(chosen)
      }
    } catch {
      // Fallback
    }
  }

  const toggleAudio = (locale: string) => {
    playHapticClick()
    setSelectedAudioLangs((prev) =>
      prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale]
    )
  }

  const toggleSub = (lang: string) => {
    playHapticClick()
    setSelectedSubLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    )
  }

  const handleStart = () => {
    playHapticGlass()
    onConfirmDownload({
      formatId: selectedFormatId || undefined,
      title: customTitle.trim() || title,
      audioFormats: selectedAudioLangs,
      subtitles: selectedSubLangs,
      outputDir: customOutputDir || undefined,
    })
    onClose()
  }

  return (
    <div className="format-picker-backdrop" role="dialog" aria-modal="true">
      <div className="format-picker-modal">
        {/* Header */}
        <div className="format-picker-header">
          <div className="format-picker-title-group">
            <span className="format-picker-badge">Format Selection & Stream Routing</span>
            <h2 className="format-picker-heading">Stream Ingestion Matrix</h2>
          </div>
          <button
            type="button"
            className="format-picker-close-btn"
            onClick={() => {
              playHapticClick()
              onClose()
            }}
            aria-label="Close format picker"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Media Preview Card */}
        <div className="format-picker-preview-card">
          {thumbnail && (
            <div className="format-picker-thumb-wrap">
              <img src={thumbnail} alt={title} className="format-picker-thumb" />
              {duration && duration > 0 && (
                <span className="format-picker-duration-tag">{formatDuration(duration)}</span>
              )}
            </div>
          )}
          <div className="format-picker-meta-info">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="format-picker-title-input"
              placeholder="Filename / Stream title"
            />
            <span className="format-picker-source-url">{url}</span>
          </div>
        </div>

        {/* Video Quality Matrix */}
        <div className="format-picker-section">
          <label className="format-picker-section-label">Video Stream Quality</label>
          <div className="format-picker-quality-grid">
            {videoFormats.length > 0 ? (
              videoFormats.map((f) => {
                const isSelected = selectedFormatId === f.format_id
                const label = `${f.height}p${f.fps && f.fps > 30 ? f.fps : ''}`
                const codec = f.vcodec?.split('.')[0] || 'AVC'
                const sizeStr = formatFileSize(f.filesize)

                return (
                  <button
                    key={f.format_id}
                    type="button"
                    className={`format-picker-option-card ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      playHapticClick()
                      setSelectedFormatId(f.format_id)
                    }}
                  >
                    <div className="format-option-header">
                      <span className="format-option-res">{label}</span>
                      <span className="format-option-codec">{codec}</span>
                    </div>
                    {sizeStr && <span className="format-option-size">~{sizeStr}</span>}
                    {isSelected && (
                      <div className="format-option-check">
                        <IconCheck size={12} />
                      </div>
                    )}
                  </button>
                )
              })
            ) : (
              <button
                type="button"
                className="format-picker-option-card active"
                onClick={() => playHapticClick()}
              >
                <div className="format-option-header">
                  <span className="format-option-res">Auto Master</span>
                  <span className="format-option-codec">Lossless</span>
                </div>
                <span className="format-option-size">Highest available</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-Audio Dubs (Crunchyroll or Multi-track) */}
        {crunchyrollVersions && crunchyrollVersions.length > 0 && (
          <div className="format-picker-section">
            <label className="format-picker-section-label">Multi-Audio Dub Extraction</label>
            <div className="format-picker-tags-row">
              {crunchyrollVersions.map((v) => {
                const isChecked = selectedAudioLangs.includes(v.audioLocale)
                const isOriginal = v.original
                return (
                  <button
                    key={v.guid}
                    type="button"
                    className={`format-picker-tag-chip ${isChecked ? 'active' : ''}`}
                    onClick={() => toggleAudio(v.audioLocale)}
                  >
                    <span className="tag-chip-name">
                      {v.audioLocale} {isOriginal ? '(Original)' : '(Dub)'}
                    </span>
                    {isChecked && <IconCheck size={12} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Subtitles */}
        {subtitles.length > 0 && (
          <div className="format-picker-section">
            <label className="format-picker-section-label">Soft Subtitle Tracks</label>
            <div className="format-picker-tags-row">
              {subtitles.slice(0, 10).map((s) => {
                const isChecked = selectedSubLangs.includes(s.language)
                return (
                  <button
                    key={s.language}
                    type="button"
                    className={`format-picker-tag-chip ${isChecked ? 'active' : ''}`}
                    onClick={() => toggleSub(s.language)}
                  >
                    <span className="tag-chip-name">{s.language.toUpperCase()}</span>
                    {isChecked && <IconCheck size={12} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Destination Path Selector */}
        <div className="format-picker-section">
          <label className="format-picker-section-label">Destination Directory</label>
          <div className="format-picker-dir-bar">
            <span className="format-picker-dir-text">
              {customOutputDir || 'Default: Videos/HyperStream/'}
            </span>
            <button
              type="button"
              className="format-picker-browse-btn"
              onClick={handlePickDirectory}
            >
              <IconFolder size={14} />
              <span>Browse</span>
            </button>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="format-picker-footer">
          <button
            type="button"
            className="format-picker-cancel-btn"
            onClick={() => {
              playHapticClick()
              onClose()
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="format-picker-confirm-btn"
            onClick={handleStart}
          >
            <IconDownload size={16} />
            <span>Start Lossless Ingestion</span>
          </button>
        </div>
      </div>
    </div>
  )
}
