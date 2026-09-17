export interface DetectedStream {
  id: string
  url: string
  title: string
  format: 'HLS' | 'DASH' | 'MP4' | 'WebM' | 'Live'
  resolution?: string
  bitrateKbps?: number
  timestamp: number
}

export interface ShieldsMetrics {
  adsBlocked: number
  trackersBlocked: number
  bandwidthSavedBytes: number
  fingerprintingBlocked: number
  isEnabled: boolean
}

export interface SpeedDialItem {
  id: string
  title: string
  url: string
  category: 'streaming' | 'anime' | 'music' | 'custom'
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
