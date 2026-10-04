import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IconSearch, IconX, IconClipboard, IconAlertCircle, IconLoader, IconCheck, IconSparkles } from './Icons'
import { GlassSelect } from '../common/GlassSelect'
import { playHapticClick, playHapticPop } from '@/lib/sound'
import { errorMessage, prefetchMediaInfo, queryMediaInfo, type NativeDownloadOptions, type NativeMediaMetadata } from '@/lib/tauri-bridge'
import type { AppSettings } from '@/lib/settings'
import { formatDuration, hostnameOf } from '@/lib/format'
import { isValidStreamUrl, normalizeStreamUrl } from './validation'
import {
  audioOptions,
  buildDownloadRequests,
  defaultAudioValue,
  defaultQualityValue,
  needsSignIn,
  qualityOptions,
  subtitleOptions,
  SUBS_OFF,
} from './capture-options'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing'; url: string }
  | { status: 'ready'; url: string; meta: NativeMediaMetadata }
  | { status: 'error'; url: string; message: string }

export interface OmnibarProps {
  settings: AppSettings
  /** False while the download engine is being installed. */
  engineReady: boolean
  /** Queues the requests; rejects with a readable message on failure. */
  onCapture: (requests: NativeDownloadOptions[]) => Promise<void>
  onOpenInBrowser?: (url: string) => void
  initialUrl?: string
  /** Queue `initialUrl` at the default quality once looked up (single videos only). */
  autoCaptureInitial?: boolean
  onUrlConsumed?: () => void
}

export const Omnibar: React.FC<OmnibarProps> = ({
  settings,
  engineReady,
  onCapture,
  onOpenInBrowser,
  initialUrl,
  autoCaptureInitial = false,
  onUrlConsumed,
}) => {
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const [quality, setQuality] = useState('best')
  const [audio, setAudio] = useState('')
  const [subtitles, setSubtitles] = useState(SUBS_OFF)
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  // A copied link is offered once; after it's used or dismissed it isn't offered again.
  const handledClipboardRef = useRef<string | null>(null)

  const runProbe = useCallback(
    async (target: string): Promise<NativeMediaMetadata | null> => {
      const normalized = normalizeStreamUrl(target)
      if (!normalized) {
        requestIdRef.current++
        setProbe({ status: 'error', url: target.trim(), message: 'That doesn’t look like a link. Paste a web address such as https://youtube.com/watch?v=…' })
        return null
      }
      const trimmed = normalized
      setUrl(normalized)
      const requestId = ++requestIdRef.current
      setProbe({ status: 'probing', url: trimmed })
      try {
        const meta = await queryMediaInfo(trimmed)
        if (requestId !== requestIdRef.current) return null
        setQuality(defaultQualityValue(meta, settings.defaultQuality))
        setAudio(defaultAudioValue(meta))
        setSubtitles(SUBS_OFF)
        setProbe({ status: 'ready', url: trimmed, meta })
        return meta
      } catch (err) {
        if (requestId !== requestIdRef.current) return null
        setProbe({ status: 'error', url: trimmed, message: errorMessage(err) })
        return null
      }
    },
    [settings.defaultQuality],
  )

  const latest = useRef({ auto: autoCaptureInitial, settings, capture: onCapture })
  latest.current = { auto: autoCaptureInitial, settings, capture: onCapture }

  // Links handed over from the Browser tab or another browser.
  useEffect(() => {
    if (!initialUrl || !initialUrl.trim()) return
    const target = initialUrl.trim()
    // Before onUrlConsumed: the parent resets the flag together with the link.
    const auto = latest.current.auto
    setUrl(target)
    onUrlConsumed?.()
    void runProbe(target).then(async (meta) => {
      // Playlists always stop here so the user can pick what to download.
      if (!auto || !meta || meta.entries.length > 0) return
      const { settings: current, capture: queue } = latest.current
      const pageUrl = normalizeStreamUrl(target) ?? target
      const choice = { quality: defaultQualityValue(meta, current.defaultQuality), audio: defaultAudioValue(meta), subtitles: SUBS_OFF }
      setSubmitting(true)
      try {
        await queue(buildDownloadRequests(meta, pageUrl, choice, current))
        playHapticPop()
        requestIdRef.current++
        setUrl('')
        setProbe({ status: 'idle' })
        setJustAdded(true)
        window.setTimeout(() => setJustAdded(false), 1400)
      } catch (err) {
        setProbe({ status: 'error', url: pageUrl, message: errorMessage(err) })
      } finally {
        setSubmitting(false)
      }
    })
  }, [initialUrl, onUrlConsumed, runProbe])

  // Offer a copied link when the window gains focus.
  useEffect(() => {
    if (!settings.clipboardDetect) {
      setClipboardUrl(null)
      return
    }
    const check = async () => {
      try {
        const text = (await navigator.clipboard?.readText?.())?.trim()
        const offer = text && /^https?:\/\//i.test(text) && isValidStreamUrl(text) && text !== handledClipboardRef.current
        setClipboardUrl(offer ? text : null)
        // Likely to be used: start the look-up now so it's ready when the chip is clicked.
        const normalized = offer ? normalizeStreamUrl(text) : null
        if (normalized) prefetchMediaInfo(normalized)
      } catch {
        // Clipboard access can be denied; the chip is optional.
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [settings.clipboardDetect])

  const reset = () => {
    requestIdRef.current++
    setUrl('')
    setProbe({ status: 'idle' })
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value)
    if (probe.status !== 'idle') {
      requestIdRef.current++
      setProbe({ status: 'idle' })
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = normalizeStreamUrl(e.clipboardData.getData('text'))
    // Only replace the whole field; pasting into the middle of a typed address stays a normal paste.
    const replacesAll = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length
    if (pasted && engineReady && replacesAll) {
      e.preventDefault()
      handledClipboardRef.current = e.clipboardData.getData('text').trim()
      setClipboardUrl(null)
      setUrl(pasted)
      void runProbe(pasted)
    }
  }

  const capture = async () => {
    if (probe.status !== 'ready') return
    setSubmitting(true)
    try {
      const requests = buildDownloadRequests(probe.meta, probe.url, { quality, audio, subtitles }, settings)
      await onCapture(requests)
      playHapticPop()
      reset()
      setJustAdded(true)
      window.setTimeout(() => setJustAdded(false), 1400)
    } catch (err) {
      setProbe({ status: 'error', url: probe.url, message: errorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || !engineReady || submitting) return
    playHapticClick()
    if (probe.status === 'ready' && probe.url === (normalizeStreamUrl(url) ?? url.trim())) {
      void capture()
    } else if (probe.status !== 'probing') {
      void runProbe(url)
    }
  }

  const meta = probe.status === 'ready' ? probe.meta : null
  const qualityChoices = meta ? qualityOptions(meta) : []
  const audioChoices = meta && meta.entries.length === 0 ? audioOptions(meta) : []
  const subtitleChoices = meta && meta.entries.length === 0 && quality !== 'audio' ? subtitleOptions(meta) : []
  const hasUrl = url.trim().length > 0
  const isPlaylist = !!meta && meta.entries.length > 0

  let buttonLabel = 'Capture'
  let ButtonIcon: typeof IconSparkles = IconSparkles
  if (probe.status === 'probing') {
    buttonLabel = 'Detecting…'
    ButtonIcon = IconLoader
  } else if (submitting) {
    buttonLabel = 'Adding…'
    ButtonIcon = IconLoader
  } else if (justAdded) {
    buttonLabel = 'Added'
    ButtonIcon = IconCheck
  } else if (meta) {
    buttonLabel = isPlaylist ? `Capture ${meta.entries.length}` : 'Capture'
    ButtonIcon = IconSparkles
  }

  return (
    <div className="omnibar-wrapper">
      <form
        onSubmit={handleSubmit}
        className={`omnibar-card ${probe.status === 'error' ? 'omnibar-invalid' : ''} ${meta ? 'omnibar-valid' : ''}`}
      >
        <div className={`omnibar-icon-prefix ${meta ? 'is-valid' : ''}`}>
          {probe.status === 'probing' ? <IconLoader size={17} className="omnibar-spin-icon" /> : <IconSearch size={17} />}
        </div>

        <input
          ref={inputRef}
          id="stream-url-input"
          name="streamUrl"
          type="text"
          className="omnibar-input"
          placeholder={engineReady ? 'Paste a video, playlist or post link…' : 'Setting up the download engine…'}
          value={url}
          onChange={handleChange}
          onPaste={handlePaste}
          disabled={!engineReady}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />

        <div className="omnibar-actions">
          {!hasUrl && clipboardUrl && engineReady && (
            <div className="omnibar-clipboard-chip" role="status">
              <button
                type="button"
                className="clipboard-chip-button"
                onClick={() => {
                  playHapticPop()
                  handledClipboardRef.current = clipboardUrl
                  setUrl(clipboardUrl)
                  setClipboardUrl(null)
                  void runProbe(clipboardUrl)
                }}
                title={`Use copied link: ${clipboardUrl}`}
              >
                <IconClipboard size={12} className="clipboard-chip-icon" />
                <span className="clipboard-chip-text">{hostnameOf(clipboardUrl)}</span>
                <span className="clipboard-chip-badge">Paste</span>
              </button>
              <button
                type="button"
                className="clipboard-chip-close"
                onClick={() => {
                  handledClipboardRef.current = clipboardUrl
                  setClipboardUrl(null)
                }}
                title="Dismiss"
                aria-label="Dismiss copied link"
              >
                <IconX size={11} />
              </button>
            </div>
          )}

          {hasUrl && (
            <button
              type="button"
              className="omnibar-clear-btn"
              onClick={() => {
                playHapticClick()
                reset()
                inputRef.current?.focus()
              }}
              title="Clear"
              aria-label="Clear link"
            >
              <IconX size={13} />
            </button>
          )}

          {meta && (
            <div className="stream-hub-quick-badges" role="group" aria-label="Download options">
              {audioChoices.length > 0 && (
                <GlassSelect
                  id="stream-audio-track-select"
                  value={audio}
                  options={audioChoices}
                  onChange={setAudio}
                  className="stream-hub-badge-select"
                  ariaLabel="Audio language"
                />
              )}
              {subtitleChoices.length > 0 && (
                <GlassSelect
                  id="stream-subs-track-select"
                  value={subtitles}
                  options={subtitleChoices}
                  onChange={setSubtitles}
                  className="stream-hub-badge-select"
                  ariaLabel="Subtitles"
                />
              )}
              <GlassSelect
                id="stream-preset-select"
                value={quality}
                options={qualityChoices}
                onChange={setQuality}
                className="stream-hub-badge-select"
                ariaLabel="Quality"
              />
            </div>
          )}

          <button
            type="submit"
            className={`omnibar-submit-btn ${probe.status === 'probing' || submitting ? 'state-loading' : justAdded ? 'state-success' : ''} ${!hasUrl ? 'is-empty' : ''}`}
            disabled={!hasUrl || !engineReady || probe.status === 'probing' || submitting}
          >
            <ButtonIcon size={14} className={probe.status === 'probing' || submitting ? 'omnibar-spin-icon' : undefined} />
            <span>{buttonLabel}</span>
          </button>
        </div>
      </form>

      {meta && (
        <div className="omnibar-preview" aria-live="polite">
          {meta.thumbnail ? (
            <img className="omnibar-preview-thumb" src={meta.thumbnail} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="omnibar-preview-thumb is-empty" aria-hidden="true" />
          )}
          <div className="omnibar-preview-text">
            <div className="omnibar-preview-title" title={meta.title}>{meta.title}</div>
            <div className="omnibar-preview-meta">
              {[
                isPlaylist ? `Playlist · ${meta.entries.length} videos` : null,
                meta.uploader,
                !isPlaylist ? formatDuration(meta.duration) : null,
                meta.is_live ? 'Live' : null,
                meta.extractor ?? hostnameOf(probe.status === 'ready' ? probe.url : ''),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}

      {probe.status === 'error' && (
        <div className="omnibar-error-hint" role="alert">
          <IconAlertCircle size={12} />
          <span>{probe.message}</span>
          {needsSignIn(probe.message) && onOpenInBrowser && (
            <button type="button" className="omnibar-inline-action" onClick={() => onOpenInBrowser(probe.url)}>
              Open in Browser to sign in
            </button>
          )}
        </div>
      )}
    </div>
  )
}
