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
    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      )
    case 'spotify':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.436-5.308-1.76-8.793-.963-.335.077-.67-.133-.746-.467-.077-.334.132-.67.467-.746 3.808-.87 7.076-.502 9.722 1.112.294.18.386.563.207.857zm1.225-2.723c-.226.368-.71.482-1.078.256-2.69-1.653-6.79-2.133-9.972-1.168-.413.125-.853-.11-.978-.523-.125-.413.11-.853.523-.978 3.633-1.102 8.147-.568 11.249 1.335.368.226.482.71.256 1.078zm.106-2.835C14.692 8.94 9.37 8.766 6.275 9.706c-.496.15-1.022-.132-1.173-.628-.151-.496.133-1.022.628-1.173 3.556-1.08 9.429-.877 13.14 1.328.445.264.59.838.326 1.283-.264.444-.838.59-1.282.326z"/>
        </svg>
      )
    case 'reddit':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="9" cy="11.5" r="1.5" fill="#ffffff" />
          <circle cx="15" cy="11.5" r="1.5" fill="#ffffff" />
          <path d="M8.5 15.5c1.8 1.5 5.2 1.5 7 0" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      )
    case 'bilibili':
      return <Lettermark letter="B" size={size} />
    case 'tiktok':
      return <Lettermark letter="T" size={size} />
    default:
      return <IconGlobe size={size} />
  }
}
