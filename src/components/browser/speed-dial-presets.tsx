import type { ReactNode } from 'react'
import type { SpeedDialItem } from './types'
import {
  IconTwitch,
  IconYouTube,
  IconKick,
  IconCrunchyroll,
  IconAnimeFlix,
  IconSoundCloud,
  IconGlobe,
} from './Icons'

export const DEFAULT_SPEED_DIAL_PRESETS: SpeedDialItem[] = [
  {
    id: 'twitch',
    title: 'Twitch',
    url: 'https://twitch.tv',
    category: 'streaming',
    iconKey: 'twitch',
    accentColor: '#9146FF',
  },
  {
    id: 'youtube',
    title: 'YouTube',
    url: 'https://youtube.com',
    category: 'streaming',
    iconKey: 'youtube',
    accentColor: '#FF0000',
  },
  {
    id: 'kick',
    title: 'Kick',
    url: 'https://kick.com',
    category: 'streaming',
    iconKey: 'kick',
    accentColor: '#53FC18',
  },
  {
    id: 'crunchyroll',
    title: 'Crunchyroll',
    url: 'https://crunchyroll.com',
    category: 'anime',
    iconKey: 'crunchyroll',
    accentColor: '#F47521',
  },
  {
    id: 'animeflix',
    title: 'AnimeFlix',
    url: 'https://animeflix.live',
    category: 'anime',
    iconKey: 'animeflix',
    accentColor: '#06B6D4',
  },
  {
    id: 'soundcloud',
    title: 'SoundCloud',
    url: 'https://soundcloud.com',
    category: 'music',
    iconKey: 'soundcloud',
    accentColor: '#FF5500',
  },
]

export function renderSpeedDialIcon(iconKey: string, size = 20): ReactNode {
  switch (iconKey) {
    case 'twitch':
      return <IconTwitch size={size} />
    case 'youtube':
      return <IconYouTube size={size} />
    case 'kick':
      return <IconKick size={size} />
    case 'crunchyroll':
      return <IconCrunchyroll size={size} />
    case 'animeflix':
      return <IconAnimeFlix size={size} />
    case 'soundcloud':
      return <IconSoundCloud size={size} />
    default:
      return <IconGlobe size={size} />
  }
}
