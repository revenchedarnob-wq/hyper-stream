export interface QualityRendition {
  id: string
  label: string
  resolution: string
  fps: number
  codec: string
  bitrate: string
  bitrateKbps: number
  badge?: string
}

export interface AudioTrackItem {
  id: string
  language: string
  channels: string
  codec: string
  bitrate: string
  isDefault?: boolean
}

export interface SubtitleTrackItem {
  id: string
  language: string
  format: string
  type: 'full' | 'signs' | 'sdh' | 'off'
  isDefault?: boolean
}

export interface HypePeak {
  id: string
  timestamp: string
  seconds: number
  label: string
  energy: number
  category?: 'combat' | 'objective' | 'climax' | 'reaction'
}

export interface StreamPreset {
  id: string
  name: string
  url: string
  poster: string
  duration: number
  qualityId: string
  audioTrackId: string
  subtitleTrackId: string
  description?: string
}

export interface StreamStudioProps {
  initialUrl?: string
  onNavigateToHub?: () => void
  onAddTransfer?: (transfer: any) => void
}

export const DEFAULT_QUALITIES: QualityRendition[] = [
  {
    id: '4k-hdr',
    label: '4K HDR',
    resolution: '3840x2160',
    fps: 60,
    codec: 'HEVC',
    bitrate: '28 Mbps',
    bitrateKbps: 28000,
    badge: 'HDR',
  },
  {
    id: '1080p60',
    label: '1080p60 Source',
    resolution: '1920x1080',
    fps: 60,
    codec: 'AVC',
    bitrate: '12 Mbps',
    bitrateKbps: 12000,
    badge: 'Source',
  },
  {
    id: '720p60',
    label: '720p60',
    resolution: '1280x720',
    fps: 60,
    codec: 'AVC',
    bitrate: '5.5 Mbps',
    bitrateKbps: 5500,
    badge: 'HD',
  },
  {
    id: '480p30',
    label: '480p30',
    resolution: '854x480',
    fps: 30,
    codec: 'AVC',
    bitrate: '2.1 Mbps',
    bitrateKbps: 2100,
    badge: 'SD',
  },
  {
    id: 'audio-only',
    label: 'Audio-Only',
    resolution: 'Direct Audio',
    fps: 0,
    codec: 'Opus',
    bitrate: '320 kbps',
    bitrateKbps: 320,
    badge: 'HQ',
  },
]

export const DEFAULT_AUDIO_TRACKS: AudioTrackItem[] = [
  {
    id: 'jpn-51',
    language: 'Japanese 5.1 Surround',
    channels: '5.1 ch',
    codec: 'FLAC',
    bitrate: '640 kbps',
    isDefault: true,
  },
  {
    id: 'eng-stereo',
    language: 'English Stereo Direct',
    channels: '2.0 ch',
    codec: 'AAC',
    bitrate: '320 kbps',
  },
  {
    id: 'mic-iso',
    language: 'Streamer Mic Isolated',
    channels: '1.0 ch',
    codec: 'Opus',
    bitrate: '192 kbps',
  },
  {
    id: 'sfx-direct',
    language: 'In-Game SFX Direct',
    channels: '2.0 ch',
    codec: 'AAC',
    bitrate: '256 kbps',
  },
]

export const DEFAULT_SUBTITLE_TRACKS: SubtitleTrackItem[] = [
  {
    id: 'eng-ass',
    language: 'English ASS (Full Styled)',
    format: 'ASS',
    type: 'full',
    isDefault: true,
  },
  {
    id: 'jpn-romaji',
    language: 'Japanese Kanji + Romaji (ASS)',
    format: 'ASS',
    type: 'signs',
  },
  {
    id: 'spa-latam',
    language: 'Spanish Latin (SRT)',
    format: 'SRT',
    type: 'sdh',
  },
  {
    id: 'none',
    language: 'None / Off',
    format: 'None',
    type: 'off',
  },
]

export const DEFAULT_HYPE_PEAKS: HypePeak[] = [
  {
    id: 'peak-1',
    timestamp: '00:14:22',
    seconds: 862,
    label: '1v5 Ace',
    energy: 96,
    category: 'combat',
  },
  {
    id: 'peak-2',
    timestamp: '00:32:10',
    seconds: 1930,
    label: 'Baron Steal',
    energy: 89,
    category: 'objective',
  },
  {
    id: 'peak-3',
    timestamp: '01:15:45',
    seconds: 4545,
    label: 'Final Boss Phase 2',
    energy: 99,
    category: 'climax',
  },
]

export const DEFAULT_STREAM_PRESETS: StreamPreset[] = [
  {
    id: 'vct-finals',
    name: 'VCT Champions Finals',
    url: 'https://stream.riotgames.com/hls/vct-finals-2026/master.m3u8',
    poster: '/wallpapers/bg-neon-waves.jpg',
    duration: 9600, // 02:40:00
    qualityId: '4k-hdr',
    audioTrackId: 'jpn-51',
    subtitleTrackId: 'eng-ass',
    description: '4K HDR 60fps Riot Games World Championship feed with 5.1 crowd audio',
  },
  {
    id: 'elden-ring',
    name: 'Elden Ring No-Hit Run',
    url: 'https://stream.fromsoftware.media/hls/elden-ring-nohit/master.m3u8',
    poster: '/wallpapers/bg-amber-flow.jpg',
    duration: 7200, // 02:00:00
    qualityId: '1080p60',
    audioTrackId: 'eng-stereo',
    subtitleTrackId: 'eng-ass',
    description: 'Level 1 Wretch all-remembrance direct capture stream',
  },
  {
    id: 'night-city',
    name: 'Night City 4K Tour',
    url: 'https://stream.cyberpunk.net/hls/night-city-4k/master.m3u8',
    poster: '/wallpapers/bg-prism-wave.jpg',
    duration: 5400, // 01:30:00
    qualityId: '4k-hdr',
    audioTrackId: 'jpn-51',
    subtitleTrackId: 'none',
    description: 'Full path-traced raytracing cinematic city traverse',
  },
]

/**
 * Format raw seconds to HH:MM:SS.mmm with precision millisecond readout
 */
export function formatTimecode(totalSeconds: number, includeMs = true): string {
  const safeSeconds = Math.max(0, totalSeconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = Math.floor(safeSeconds % 60)
  const ms = Math.floor((safeSeconds % 1) * 1000)

  const hh = hours.toString().padStart(2, '0')
  const mm = minutes.toString().padStart(2, '0')
  const ss = seconds.toString().padStart(2, '0')

  if (!includeMs) {
    return `${hh}:${mm}:${ss}`
  }

  const mmm = ms.toString().padStart(3, '0')
  return `${hh}:${mm}:${ss}.${mmm}`
}

/**
 * Parse timecode string (HH:MM:SS or HH:MM:SS.mmm) to total seconds
 */
export function parseTimecode(tc: string): number {
  if (!tc) return 0
  const parts = tc.trim().split(':')
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return hours * 3600 + minutes * 60 + seconds
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0
    const seconds = parseFloat(parts[1]) || 0
    return minutes * 60 + seconds
  }
  return parseFloat(tc) || 0
}
