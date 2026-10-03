import { describe, it, expect } from 'vitest'
import type { NativeMediaMetadata } from '@/lib/tauri-bridge'
import {
  AUDIO_ALL,
  QUALITY_AUDIO,
  QUALITY_BEST,
  SUBS_OFF,
  audioOptions,
  buildDownloadRequests,
  defaultAudioValue,
  defaultQualityValue,
  extractLinks,
  needsSignIn,
  qualityOptions,
  subtitleOptions,
} from './capture-options'

function meta(patch: Partial<NativeMediaMetadata> = {}): NativeMediaMetadata {
  return {
    id: 'abc',
    title: 'A video',
    uploader: 'Someone',
    extractor: 'youtube',
    duration: 120,
    thumbnail: 'https://i.ytimg.com/x.jpg',
    webpage_url: 'https://www.youtube.com/watch?v=abc',
    is_live: false,
    resolutions: [
      { width: 3840, height: 2160 },
      { width: 1920, height: 1088 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ],
    has_audio: true,
    audio_tracks: [],
    subtitles: [],
    entries: [],
    ...patch,
  }
}

const settings = { downloadDir: '', preferCompatible: false }

describe('quality options', () => {
  it('lists real sizes once each, plus best and audio', () => {
    const labels = qualityOptions(meta()).map((o) => o.label)
    expect(labels).toEqual(['Best (4K)', '4K', '1080p', '720p', 'Audio only'])
  })

  it('labels portrait video by its short side', () => {
    const labels = qualityOptions(meta({ resolutions: [{ width: 1080, height: 1920 }] })).map((o) => o.label)
    expect(labels).toContain('1080p')
    expect(labels.join()).not.toContain('1920p')
  })

  it('omits audio-only when the source has no audio', () => {
    expect(qualityOptions(meta({ has_audio: false })).some((o) => o.value === QUALITY_AUDIO)).toBe(false)
  })

  it('picks the largest size within the default preference', () => {
    expect(defaultQualityValue(meta(), 'best')).toBe(QUALITY_BEST)
    expect(defaultQualityValue(meta(), '1440')).toBe('1088')
    expect(defaultQualityValue(meta(), '720')).toBe('720')
    expect(defaultQualityValue(meta(), '480')).toBe(QUALITY_BEST)
    expect(defaultQualityValue(meta(), 'audio')).toBe(QUALITY_AUDIO)
  })
})

describe('audio and subtitle options', () => {
  it('hides the audio picker for single-language sources', () => {
    expect(audioOptions(meta())).toEqual([])
  })

  it('offers each language, marks the original, and defaults to it', () => {
    const m = meta({
      audio_tracks: [
        { language: 'en', note: '', is_original: false },
        { language: 'ja', note: '', is_original: true },
      ],
    })
    const opts = audioOptions(m)
    expect(opts.map((o) => o.value)).toEqual(['en', 'ja', AUDIO_ALL])
    expect(opts[1].label).toContain('(original)')
    expect(defaultAudioValue(m)).toBe('ja')
  })

  it('hides subtitles when there are none, otherwise starts with an off choice', () => {
    expect(subtitleOptions(meta())).toEqual([])
    const opts = subtitleOptions(meta({ subtitles: [{ language: 'en', name: 'English' }] }))
    expect(opts[0].value).toBe(SUBS_OFF)
    expect(opts[1]).toEqual({ value: 'en', label: 'English' })
  })
})

describe('buildDownloadRequests', () => {
  it('builds one request carrying the chosen quality, audio and subtitles', () => {
    const m = meta({
      audio_tracks: [
        { language: 'en', note: '', is_original: true },
        { language: 'es', note: '', is_original: false },
      ],
      subtitles: [{ language: 'fr', name: 'French' }],
    })
    const reqs = buildDownloadRequests(
      m,
      'https://youtu.be/abc',
      { quality: '1080', audio: AUDIO_ALL, subtitles: 'fr' },
      settings,
    )
    expect(reqs).toHaveLength(1)
    const [req] = reqs
    expect(req.url).toBe('https://www.youtube.com/watch?v=abc')
    expect(req.max_height).toBe(1080)
    expect(req.audio_only).toBe(false)
    expect(req.audio_languages).toEqual(['en', 'es'])
    expect(req.subtitles).toEqual(['fr'])
    expect(req.output_dir).toBeNull()
  })

  it('drops subtitles and height for audio-only', () => {
    const [req] = buildDownloadRequests(
      meta({ subtitles: [{ language: 'en', name: 'English' }] }),
      '',
      { quality: QUALITY_AUDIO, audio: '', subtitles: 'en' },
      { downloadDir: 'D:\\Music', preferCompatible: true },
    )
    expect(req.audio_only).toBe(true)
    expect(req.max_height).toBeNull()
    expect(req.subtitles).toEqual([])
    expect(req.output_dir).toBe('D:\\Music')
    expect(req.prefer_compatible).toBe(true)
  })

  it('expands a playlist into one request per entry', () => {
    const m = meta({
      entries: [
        { url: 'https://youtu.be/1', title: 'One', duration: 10 },
        { url: 'https://youtu.be/2', title: 'Two' },
      ],
    })
    const reqs = buildDownloadRequests(m, '', { quality: QUALITY_BEST, audio: '', subtitles: '' }, settings)
    expect(reqs.map((r) => r.url)).toEqual(['https://youtu.be/1', 'https://youtu.be/2'])
    expect(reqs[0].max_height).toBeNull()
    expect(reqs[1].duration).toBeNull()
  })
})

describe('helpers', () => {
  it('detects sign-in errors', () => {
    expect(needsSignIn('This content needs you to be signed in.')).toBe(true)
    expect(needsSignIn('Video unavailable')).toBe(false)
  })

  it('extracts unique links from text and trims trailing punctuation', () => {
    const text = 'see https://a.com/x, and https://b.com/y). Also https://a.com/x again'
    expect(extractLinks(text)).toEqual(['https://a.com/x', 'https://b.com/y'])
    expect(extractLinks('no links here')).toEqual([])
    expect(extractLinks('https://a.com/1 https://a.com/2 https://a.com/3', 2)).toHaveLength(2)
  })
})
