import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react'
import type { DetectedStream, ShieldsMetrics } from './types'
import {
  IconArrowLeft,
  IconArrowRight,
  IconReload,
  IconHome,
  IconLock,
  IconX,
  IconBraveLion,
  IconPuzzlePiece,
} from './Icons'
import { StreamDetectorPill } from './StreamDetectorPill'
import { BraveShieldsPopover } from './BraveShieldsPopover'
import { handleBrowserSubmit } from './url-utils'
import { playHapticClick, playHapticGlass } from '@/lib/sound'
import './browser.css'

export interface BrowserNavControlsProps {
  canGoBack: boolean
  canGoForward: boolean
  isLoading?: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onHome: () => void
}

export function BrowserNavControls({
  canGoBack,
  canGoForward,
  isLoading = false,
  onBack,
  onForward,
  onReload,
  onHome,
}: BrowserNavControlsProps) {
  const handleBack = () => {
    if (!canGoBack) return
    playHapticClick()
    onBack()
  }

  const handleForward = () => {
    if (!canGoForward) return
    playHapticClick()
    onForward()
  }

  const handleReload = () => {
    playHapticClick()
    onReload()
  }

  const handleHome = () => {
    playHapticClick()
    onHome()
  }

  return (
    <div className="browser-nav-group" role="group" aria-label="Navigation Controls">
      <button
        type="button"
        className="browser-nav-btn"
        onClick={handleBack}
        disabled={!canGoBack}
        aria-label="Back"
        title="Back"
        data-testid="browser-btn-back"
      >
        <IconArrowLeft size={16} />
      </button>

      <button
        type="button"
        className="browser-nav-btn"
        onClick={handleForward}
        disabled={!canGoForward}
        aria-label="Forward"
        title="Forward"
        data-testid="browser-btn-forward"
      >
        <IconArrowRight size={16} />
      </button>

      <button
        type="button"
        className={`browser-nav-btn ${isLoading ? 'is-loading' : ''}`}
        onClick={handleReload}
        aria-label="Reload"
        title="Reload page"
        data-testid="browser-btn-reload"
      >
        <IconReload size={15} />
      </button>

      <button
        type="button"
        className="browser-nav-btn"
        onClick={handleHome}
        aria-label="Home"
        title="Speed dial portal"
        data-testid="browser-btn-home"
      >
        <IconHome size={16} />
      </button>
    </div>
  )
}

export interface BrowserToolbarProps {
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading?: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onHome: () => void
  onNavigate: (url: string) => void
  shieldsStats?: ShieldsMetrics
  onToggleShields?: () => void
  detectedStream?: DetectedStream | null
  onOpenInHub: (url: string) => void
  onOpenInStudio: (url: string) => void
  onDismissStream?: () => void
  onOpenExtensions?: () => void
}

const DEFAULT_SHIELDS_STATS: ShieldsMetrics = {
  adsBlocked: 238,
  trackersBlocked: 142,
  bandwidthSavedBytes: 29360128,
  fingerprintingBlocked: 36,
  isEnabled: true,
}

export function BrowserToolbar({
  currentUrl,
  canGoBack,
  canGoForward,
  isLoading = false,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  shieldsStats = DEFAULT_SHIELDS_STATS,
  onToggleShields,
  detectedStream = null,
  onOpenInHub,
  onOpenInStudio,
  onDismissStream,
  onOpenExtensions,
}: BrowserToolbarProps) {
  const [prevUrl, setPrevUrl] = useState(currentUrl)
  const [inputValue, setInputValue] = useState(() =>
    currentUrl === 'about:blank' || !currentUrl ? '' : currentUrl
  )
  const [isShieldsOpen, setIsShieldsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (currentUrl !== prevUrl) {
    setPrevUrl(currentUrl)
    setInputValue(currentUrl === 'about:blank' || !currentUrl ? '' : currentUrl)
  }


  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    const resolved = handleBrowserSubmit(trimmed, onNavigate)
    setInputValue(resolved.url)
  }

  const handleClear = () => {
    playHapticClick()
    setInputValue('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setInputValue(currentUrl === 'about:blank' || !currentUrl ? '' : currentUrl)
      inputRef.current?.blur()
    }
  }

  const handleToggleShieldsPopover = () => {
    playHapticGlass()
    setIsShieldsOpen((prev) => !prev)
  }

  const isSecure =
    currentUrl.startsWith('https://') ||
    currentUrl.startsWith('http://localhost') ||
    currentUrl.startsWith('about:') ||
    !currentUrl

  const totalBlocked =
    (shieldsStats.adsBlocked || 0) + (shieldsStats.trackersBlocked || 0)

  return (
    <header className="browser-toolbar" role="toolbar" aria-label="Browser Navigation Bar">
      {/* Navigation Controls */}
      <BrowserNavControls
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isLoading={isLoading}
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
        onHome={onHome}
      />

      {/* Smart Address Omnibar */}
      <form
        className="browser-omnibar-form"
        onSubmit={handleFormSubmit}
        role="search"
        aria-label="Address and search bar"
      >
        <div
          className={`browser-omnibar-security ${isSecure ? 'is-secure' : 'is-insecure'}`}
          title={isSecure ? 'Connection is secure' : 'Insecure connection'}
          aria-hidden="true"
        >
          <IconLock size={13} className="browser-omnibar-lock" />
        </div>

        <input
          id="browser-url-input"
          ref={inputRef}
          type="text"
          className="browser-omnibar-input"
          placeholder="Search with Brave or enter URL..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          aria-label="Address or search query"
        />

        {inputValue.length > 0 && (
          <button
            type="button"
            className="browser-omnibar-clear-btn"
            onClick={handleClear}
            aria-label="Clear address bar"
            title="Clear"
            data-testid="browser-omnibar-clear"
          >
            <IconX size={12} />
          </button>
        )}
      </form>

      {/* Active Stream Detector Pill Mount */}
      {detectedStream && (
        <div className="browser-stream-detector-slot" data-testid="browser-stream-slot">
          <StreamDetectorPill
            stream={detectedStream}
            onOpenInHub={onOpenInHub}
            onOpenInStudio={onOpenInStudio}
            onDismiss={onDismissStream}
          />
        </div>
      )}

      {/* Brave Shields Protection Button & Popover */}
      <div className="browser-shields-wrapper">
        <button
          type="button"
          className={`browser-shields-btn ${shieldsStats.isEnabled ? 'is-active' : 'is-disabled'}`}
          onClick={handleToggleShieldsPopover}
          aria-label="Brave Shields"
          aria-expanded={isShieldsOpen}
          title={`Brave Shields: ${totalBlocked} ads and trackers blocked`}
          data-testid="browser-shields-button"
        >
          <div className="browser-shields-lion-icon" aria-hidden="true">
            <IconBraveLion size={17} />
          </div>
          <span
            className="browser-shields-count-badge"
            data-testid="browser-shields-badge"
          >
            {shieldsStats.isEnabled ? totalBlocked : 'OFF'}
          </span>
        </button>

        {isShieldsOpen && (
          <BraveShieldsPopover
            stats={shieldsStats}
            onToggleShields={() => {
              onToggleShields?.()
            }}
            onClose={() => setIsShieldsOpen(false)}
          />
        )}
      </div>

      {/* Extension Store Trigger Button */}
      <button
        type="button"
        className="browser-extensions-btn"
        onClick={() => {
          playHapticClick()
          onOpenExtensions?.()
        }}
        aria-label="Extension Store"
        title="Extension Store (AdGuard, uBlock, SponsorBlock, Dark Reader)"
        data-testid="browser-extensions-btn"
      >
        <IconPuzzlePiece size={16} />
      </button>
    </header>
  )
}
