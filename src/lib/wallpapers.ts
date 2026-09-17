export interface WallpaperOption {
  id: string
  name: string
  url: string
  frostedUrl?: string
  theme?: 'light' | 'dark'
}

export const SIMULATOR_WALLPAPERS: WallpaperOption[] = [
  {
    id: 'neon-waves',
    name: 'Neon Waves',
    url: '/wallpapers/bg-neon-waves.jpg',
    frostedUrl: '/wallpapers/bg-neon-waves-frosted.webp',
    theme: 'dark',
  },
  {
    id: 'ghibli-meadow',
    name: 'Ghibli Meadow',
    url: '/wallpapers/bg-ghibli.jpg',
    frostedUrl: '/wallpapers/bg-ghibli-frosted.webp',
    theme: 'light',
  },
  {
    id: 'silk-loop',
    name: 'Silk Loop',
    url: '/wallpapers/bg-silk-loop.jpg',
    frostedUrl: '/wallpapers/bg-silk-loop-frosted.webp',
    theme: 'light',
  },
  {
    id: 'amber-flow',
    name: 'Amber Flow',
    url: '/wallpapers/bg-amber-flow.jpg',
    frostedUrl: '/wallpapers/bg-amber-flow-frosted.webp',
    theme: 'light',
  },
  {
    id: 'rose-petals',
    name: 'Rose Petals',
    url: '/wallpapers/bg-rose-petals.jpg',
    frostedUrl: '/wallpapers/bg-rose-petals-frosted.webp',
    theme: 'light',
  },
  {
    id: 'prism-wave',
    name: 'Prism Wave',
    url: '/wallpapers/bg-prism-wave.jpg',
    frostedUrl: '/wallpapers/bg-prism-wave-frosted.webp',
    theme: 'light',
  },
  {
    id: 'violet-discs',
    name: 'Violet Discs',
    url: '/wallpapers/bg-violet-discs.jpg',
    frostedUrl: '/wallpapers/bg-violet-discs-frosted.webp',
    theme: 'light',
  },
]
