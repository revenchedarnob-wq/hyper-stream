import type { NativeDownloadOptions, NativeMediaMetadata } from '@/lib/tauri-bridge'
import type { AppSettings, DefaultQuality } from '@/lib/settings'
import { languageName, qualityLabel } from '@/lib/format'

export interface SelectOption {
  value: string
  label: string
}

export const QUALITY_BEST = 'best'
export const QUALITY_AUDIO = 'audio'
export const AUDIO_ALL = '__all__'
export const SUBS_OFF = '__off__'

/** Standard tiers used when the exact sizes aren't known (playlists). */
const STANDARD_TIERS = [2160, 1440, 1080, 720, 480]

function shortSide(width: number, height: number): number {
  return width > 0 ? Math.min(width, height) : height
}

/** Quality choices for a probed link. Values are max heights, "best" or "audio". */
export function qualityOptions(meta: NativeMediaMetadata): SelectOption[] {
  const options: SelectOption[] = []
  const isPlaylist = meta.entries.length > 0

  if (isPlaylist) {
    options.push({ value: QUALITY_BEST, label: 'Best quality' })
    for (const h of STANDARD_TIERS) options.push({ value: String(h), label: `Up to ${qualityLabel(null, h)}` })
    options.push({ value: QUALITY_AUDIO, label: 'Audio only' })
    return options
  }

  const sizes = meta.resolutions
  if (sizes.length > 0) {
    const top = sizes[0]
    options.push({ value: QUALITY_BEST, label: `Best (${qualityLabel(top.width, top.height)})` })
    const seen = new Set<string>()
    for (const r of sizes) {
      const label = qualityLabel(r.width, r.height)
      // Several heights can map to one label (e.g. 1080 and 1088); keep the largest.
      if (seen.has(label)) continue
      seen.add(label)
      options.push({ value: String(r.height), label })
    }
  } else {
    options.push({ value: QUALITY_BEST, label: 'Best quality' })
  }
  if (meta.has_audio) options.push({ value: QUALITY_AUDIO, label: 'Audio only' })
  return options
}

/** Picks the option matching the user's default quality preference. */
export function defaultQualityValue(meta: NativeMediaMetadata, preference: DefaultQuality): string {
  const options = qualityOptions(meta)
  if (preference === 'audio') {
    return options.some((o) => o.value === QUALITY_AUDIO) ? QUALITY_AUDIO : QUALITY_BEST
  }
  if (preference === 'best') return QUALITY_BEST

  const target = Number(preference)
  if (meta.entries.length > 0) return String(target)

  // Largest available size whose short side fits the preference.
  const fit = meta.resolutions.find((r) => shortSide(r.width, r.height) <= target)
  return fit ? String(fit.height) : QUALITY_BEST
}

/** Audio language choices; empty when the source has a single audio track. */
export function audioOptions(meta: NativeMediaMetadata): SelectOption[] {
  if (meta.audio_tracks.length < 2) return []
  const options = meta.audio_tracks.map((t) => ({
    value: t.language,
    label: `${languageName(t.language)}${t.is_original ? ' (original)' : ''}`,
  }))
  options.push({ value: AUDIO_ALL, label: 'All languages' })
  return options
}

export function defaultAudioValue(meta: NativeMediaMetadata): string {
  const original = meta.audio_tracks.find((t) => t.is_original)
  return original?.language ?? meta.audio_tracks[0]?.language ?? ''
}

/** Subtitle choices; empty when the source has none. */
export function subtitleOptions(meta: NativeMediaMetadata): SelectOption[] {
  if (meta.subtitles.length === 0) return []
  return [
    { value: SUBS_OFF, label: 'No subtitles' },
    ...meta.subtitles.map((s) => ({ value: s.language, label: s.name || languageName(s.language) })),
  ]
}

export interface CaptureSelection {
  quality: string
  audio: string
  subtitles: string
}

/** Turns the probe result and the user's choices into download requests (one per playlist entry). */
export function buildDownloadRequests(
  meta: NativeMediaMetadata,
  sourceUrl: string,
  selection: CaptureSelection,
  settings: Pick<AppSettings, 'downloadDir' | 'preferCompatible'>,
): NativeDownloadOptions[] {
  const audioOnly = selection.quality === QUALITY_AUDIO
  const maxHeight = audioOnly || selection.quality === QUALITY_BEST ? null : Number(selection.quality)
  const common = {
    max_height: maxHeight,
    audio_only: audioOnly,
    output_dir: settings.downloadDir || null,
    prefer_compatible: settings.preferCompatible,
  }

  if (meta.entries.length > 0) {
    return meta.entries.map((e) => ({
      ...common,
      url: e.url,
      title: e.title,
      duration: e.duration ?? null,
      uploader: meta.uploader ?? null,
      extractor: meta.extractor ?? null,
    }))
  }

  let audioLanguages: string[] = []
  if (meta.audio_tracks.length > 1) {
    audioLanguages = selection.audio === AUDIO_ALL ? meta.audio_tracks.map((t) => t.language) : [selection.audio].filter(Boolean)
  }
  const subtitles = !audioOnly && selection.subtitles && selection.subtitles !== SUBS_OFF ? [selection.subtitles] : []

  return [
    {
      ...common,
      url: meta.webpage_url || sourceUrl,
      title: meta.title,
      audio_languages: audioLanguages,
      subtitles,
      thumbnail: meta.thumbnail ?? null,
      duration: meta.duration ?? null,
      uploader: meta.uploader ?? null,
      extractor: meta.extractor ?? null,
    },
  ]
}

/** True when the error means the site wants a signed-in session. */
export function needsSignIn(message: string): boolean {
  return /signed in|sign in|private/i.test(message)
}

/** Extracts unique http(s) links from free text (dropped files, pasted lists). */
export function extractLinks(text: string, limit = 200): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? []
  const unique: string[] = []
  for (const raw of matches) {
    const url = raw.replace(/[),.;]+$/, '')
    if (!unique.includes(url)) unique.push(url)
    if (unique.length >= limit) break
  }
  return unique
}
