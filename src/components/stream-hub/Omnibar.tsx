import React, { useState, useEffect, useRef } from 'react'
import { IconSearch, IconSparkles, IconX, IconClipboard, IconCheck, IconAlertCircle, IconLoader } from './Icons'
import { playHapticClick, playHapticPop } from '@/lib/sound'
import { GlassSelect } from '../common/GlassSelect'

const PRESET_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: 'audio', label: 'Audio' },
]

import { isValidStreamUrl } from './validation'

interface OmnibarProps {
  onAnalyze: (url: string, preset: string) => void
  isAnalyzing: boolean
}

export const Omnibar: React.FC<OmnibarProps> = ({ onAnalyze, isAnalyzing }) => {
  const [url, setUrl] = useState('')
  const [preset, setPreset] = useState('auto')
  const [clipboardPrompt, setClipboardPrompt] = useState<string | null>(
    'https://stream-cdn.animex.net/hls/frieren-ep29/master.m3u8'
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [hasSuccess, setHasSuccess] = useState(false)
  const captureStatus: 'idle' | 'loading' | 'success' | 'error' = isAnalyzing
    ? 'loading'
    : hasError
      ? 'error'
      : hasSuccess
        ? 'success'
        : 'idle'
  const inputRef = useRef<HTMLInputElement>(null)
  const prevAnalyzingRef = useRef(isAnalyzing)

  useEffect(() => {
    if (prevAnalyzingRef.current && !isAnalyzing) {
      setHasSuccess(true)
      const timer = setTimeout(() => {
        setHasSuccess(false)
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
    if (hasError) {
      setHasError(false)
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
      setHasError(true)
      setTimeout(() => setIsShaking(false), 500)
      setTimeout(() => {
        setHasError(false)
      }, 2000)
      return
    }

    setValidationError(null)
    playHapticClick()
    onAnalyze(trimmed, preset)
  }

  const handlePasteClipboard = () => {
    if (clipboardPrompt) {
      playHapticPop()
      setUrl(clipboardPrompt)
      setValidationError(null)
      onAnalyze(clipboardPrompt, preset)
      setClipboardPrompt(null)
    }
  }

  const isUrlValid = url.trim().length > 0 && isValidStreamUrl(url.trim())
  const hasUrlContent = url.trim().length > 0

  return (
    <div className="omnibar-wrapper">
      <form
        onSubmit={handleSubmit}
        className={`omnibar-card ${isShaking ? 'omnibar-shake' : ''} ${validationError ? 'omnibar-invalid' : ''} ${isUrlValid ? 'omnibar-valid' : ''}`}
      >
        <div className={`omnibar-icon-prefix ${isUrlValid ? 'is-valid' : ''}`}>
          {captureStatus === 'loading' ? (
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
                setHasError(false)
                setHasSuccess(false)
                inputRef.current?.focus()
              }}
              title="Clear input"
              aria-label="Clear input"
            >
              <IconX size={13} />
            </button>
          )}

          <div className="omnibar-preset-wrapper">
            <GlassSelect
              id="stream-preset-select"
              value={preset}
              options={PRESET_OPTIONS}
              onChange={setPreset}
              ariaLabel="Select stream preset"
            />
          </div>

          <button
            type="submit"
            className={`omnibar-submit-btn state-${captureStatus} ${!hasUrlContent ? 'is-empty' : ''}`}
            disabled={!hasUrlContent || isAnalyzing}
            title={!hasUrlContent ? 'Enter stream URL to capture' : 'Capture and ingest stream'}
            aria-label={isAnalyzing ? 'Ingesting stream' : 'Capture stream'}
          >
            {captureStatus === 'loading' ? (
              <>
                <IconLoader size={14} className="omnibar-spin-icon" />
                <span>Ingesting...</span>
              </>
            ) : captureStatus === 'success' ? (
              <>
                <IconCheck size={14} className="omnibar-success-icon" />
                <span>Captured</span>
              </>
            ) : captureStatus === 'error' ? (
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