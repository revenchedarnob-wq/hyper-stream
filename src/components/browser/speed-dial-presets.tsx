import type { ReactNode } from 'react'
import type { SpeedDialItem } from './types'
import {
  IconTwitch,
  IconYouTube,
  IconKick,
  IconSoundCloud,
  IconGlobe,
} from './Icons'

export const DEFAULT_SPEED_DIAL_PRESETS: SpeedDialItem[] = [
  { id: 'youtube', title: 'YouTube', url: 'https://youtube.com', category: 'video', iconKey: 'youtube', accentColor: '#FF0000' },
  { id: 'facebook', title: 'Facebook', url: 'https://facebook.com', category: 'social', iconKey: 'facebook', accentColor: '#1877F2' },
  { id: 'instagram', title: 'Instagram', url: 'https://instagram.com', category: 'social', iconKey: 'instagram', accentColor: '#E1306C' },
  { id: 'crunchyroll', title: 'Crunchyroll', url: 'https://crunchyroll.com', category: 'anime', iconKey: 'crunchyroll', accentColor: '#F47521' },
  { id: 'x', title: 'X', url: 'https://x.com', category: 'social', iconKey: 'x', accentColor: '#E7E9EA' },
  { id: 'netflix', title: 'Netflix', url: 'https://netflix.com', category: 'video', iconKey: 'netflix', accentColor: '#E50914' },
]

function Lettermark({ letter, size }: { letter: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="17"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
        fill="currentColor"
      >
        {letter}
      </text>
    </svg>
  )
}

export function renderSpeedDialIcon(iconKey: string, size = 20): ReactNode {
  switch (iconKey) {
    case 'twitch':
      return <IconTwitch size={size} />
    case 'youtube':
      return <IconYouTube size={size} />
    case 'kick':
      return <IconKick size={size} />
    case 'vimeo':
      return <Lettermark letter="v" size={size} />
    case 'dailymotion':
      return <Lettermark letter="d" size={size} />
    case 'facebook':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v8h4v-8h3l.5-4h-3.5V9c0-.6.4-1 1-1z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </svg>
      )
    case 'x':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
        </svg>
      )
    case 'netflix':
      return <Lettermark letter="N" size={size} />
    case 'crunchyroll':
      return <Lettermark letter="C" size={size} />
    case 'soundcloud':
      return <IconSoundCloud size={size} />
    default:
      return <IconGlobe size={size} />
  }
}
