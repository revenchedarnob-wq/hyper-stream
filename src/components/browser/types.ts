export interface DetectedStream {
  id: string
  url: string
  title: string
  /** Site name for pages ("YouTube"), container for direct media ("HLS", "MP4"). */
  format: string
  live?: boolean
  timestamp: number
}

export interface SpeedDialItem {
  id: string
  title: string
  url: string
  category: 'streaming' | 'video' | 'music' | 'social' | 'anime' | 'custom'
  iconKey: string
  accentColor?: string
}

export interface BrowserNavigationState {
  currentUrl: string
  displayUrl: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isSecure: boolean
}

export interface WebviewBounds {
  x: number
  y: number
  width: number
  height: number
}
