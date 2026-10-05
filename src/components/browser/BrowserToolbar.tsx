import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react'
import type { DetectedStream } from './types'
import type { ExtensionStoreListing } from './url-utils'
import {
  IconArrowLeft,
  IconArrowRight,
  IconReload,
  IconHome,
  IconLock,
  IconX,
  IconShieldCheck,
  IconPuzzlePiece,
  IconStar,
  IconCopy,
  IconCheck,
} from './Icons'
import { StreamDetectorPill } from './StreamDetectorPill'
import { ExtensionStorePill } from './ExtensionStorePill'
import { ShieldsPopover } from './ShieldsPopover'
import { OmnibarDropdown } from './OmnibarDropdown'
import { getShortcuts } from './shortcuts'
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
        className="browser-nav-btn"
        onClick={handleReload}
        aria-label={isLoading ? 'Stop' : 'Reload'}
        title={isLoading ? 'Stop loading' : 'Reload page'}
        data-testid="browser-btn-reload"
      >
        {isLoading ? <IconX size={15} /> : <IconReload size={15} />}
      </button>

      <button
        type="button"
        className="browser-nav-btn"
        onClick={handleHome}
        aria-label="Home"
        title="Start page"
        data-testid="browser-btn-home"
      >
        <IconHome size={16} />
      </button>
    </div>
  )
}

export interface BrowserToolbarProps {
  currentUrl: string
  pageTitle?: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading?: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onHome: () => void
  onNavigate: (url: string) => void
  /** Shields apply to the current site. */
  shieldsEnabled?: boolean
  shieldsGlobalEnabled?: boolean
  /** Current site (host without "www."), empty on the start page. */
  shieldsSite?: string
  onToggleShields?: () => void
  onToggleShieldsForSite?: () => void
  /** The page is an extension's store listing. */
  storeListing?: ExtensionStoreListing | null
  detectedStream?: DetectedStream | null
  onOpenInHub: (url: string) => void
  onDismissStream?: () => void
  onOpenExtensions?: () => void
  /** Fires when the Shields panel opens or closes (the native page must hide so it can't cover the panel). */
  onShieldsPanelChange?: (open: boolean) => void
  /** Increments to move focus to the address bar (Ctrl+L inside the page). */
  focusAddressNonce?: number
  /** The current page is on the start page (filled star). */
  isSaved?: boolean
  /** Star / Ctrl+D: save or remove the current page as a start-page shortcut. */
  onToggleSaved?: () => void
  /** Unified header: Brand and sidebar toggle slot on the left. */
  sidebarArea?: React.ReactNode
  /** Unified header: Windows 11 window controls on the right. */
  windowControls?: React.ReactNode
  onTopBarPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerMove?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerUp?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarDoubleClick?: (e: React.MouseEvent<HTMLElement>) => void
}

export function BrowserToolbar({
  currentUrl,
  pageTitle = '',
  canGoBack,
  canGoForward,
  isLoading = false,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  shieldsEnabled = true,
  shieldsGlobalEnabled = true,
  shieldsSite = '',
  onToggleShields,
  onToggleShieldsForSite,
  storeListing = null,
  detectedStream = null,
  onOpenInHub,
  onDismissStream,
  onOpenExtensions,
  onShieldsPanelChange,
  focusAddressNonce = 0,
  isSaved = false,
  onToggleSaved,
  sidebarArea,
  windowControls,
  onTopBarPointerDown,
  onTopBarPointerMove,
  onTopBarPointerUp,
  onTopBarDoubleClick,
}: BrowserToolbarProps) {
  const [prevUrl, setPrevUrl] = useState(currentUrl)
  const [inputValue, setInputValue] = useState(() =>
    currentUrl === 'about:blank' || !currentUrl ? '' : currentUrl
  )
  const [isShieldsOpen, setIsShieldsOpen] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCopyUrl = async () => {
    if (!currentUrl || currentUrl === 'about:blank') return
    try {
      await navigator.clipboard.writeText(currentUrl)
      playHapticClick()
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  const onShieldsPanelChangeRef = useRef(onShieldsPanelChange)
  onShieldsPanelChangeRef.current = onShieldsPanelChange
  useEffect(() => {
    onShieldsPanelChangeRef.current?.(isShieldsOpen)
  }, [isShieldsOpen])

  useEffect(() => {
    if (focusAddressNonce === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusAddressNonce])

  if (currentUrl !== prevUrl) {
    setPrevUrl(currentUrl)
    setInputValue(currentUrl === 'about:blank' || !currentUrl ? '' : currentUrl)
  }


  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    setIsDropdownOpen(false)
    const trimmed = inputValue.trim()
    if (!trimmed) return
    const resolved = handleBrowserSubmit(trimmed, onNavigate)
    setInputValue(resolved.url)
  }

  const handleClear = () => {
    playHapticClick()
    setInputValue('')
    inputRef.current?.focus()
    setIsDropdownOpen(true)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsDropdownOpen(false)
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
    currentUrl.startsWith('chrome-extension://') ||
    currentUrl.startsWith('http://localhost') ||
    currentUrl.startsWith('about:') ||
    !currentUrl

  return (
    <header
      className={`browser-toolbar ${sidebarArea || windowControls ? 'is-unified-header' : ''}`}
      role="toolbar"
      aria-label="Browser Navigation Bar"
      data-tauri-drag-region
      onPointerDown={onTopBarPointerDown}
      onPointerMove={onTopBarPointerMove}
      onPointerUp={onTopBarPointerUp}
      onPointerCancel={onTopBarPointerUp}
      onDoubleClick={onTopBarDoubleClick}
    >
      {sidebarArea && (
        <div className="browser-toolbar-sidebar-slot" data-tauri-drag-region>
          {sidebarArea}
        </div>
      )}
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
          placeholder="Search or enter address"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setIsDropdownOpen(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.currentTarget.select()
            setIsDropdownOpen(true)
          }}
          onBlur={() => {
            setTimeout(() => setIsDropdownOpen(false), 200)
          }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Address or search query"
          title={pageTitle || undefined}
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

        {currentUrl && currentUrl !== 'about:blank' && (
          <button
            type="button"
            className={`browser-omnibar-copy-btn ${copied ? 'is-copied' : ''}`}
            onClick={handleCopyUrl}
            aria-label={copied ? 'Copied' : 'Copy address'}
            title={copied ? 'Copied to clipboard!' : 'Copy address'}
            data-testid="browser-omnibar-copy"
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          </button>
        )}

        {onToggleSaved && /^https?:\/\//i.test(currentUrl) && (
          <button
            type="button"
            className={`browser-omnibar-star ${isSaved ? 'is-saved' : ''}`}
            onClick={() => {
              playHapticClick()
              onToggleSaved()
            }}
            aria-label={isSaved ? 'Remove from start page' : 'Add to start page'}
            aria-pressed={isSaved}
            title={isSaved ? 'Remove from start page (Ctrl+D)' : 'Add to start page (Ctrl+D)'}
            data-testid="browser-omnibar-star"
          >
            <IconStar size={15} filled={isSaved} />
          </button>
        )}

        <OmnibarDropdown
          query={inputValue}
          isOpen={isDropdownOpen}
          onSelect={(url) => {
            setInputValue(url)
            setIsDropdownOpen(false)
            onNavigate(url)
          }}
          onClose={() => setIsDropdownOpen(false)}
          shortcuts={getShortcuts()}
        />
      </form>

      {storeListing && (
        <div className="browser-stream-detector-slot" data-testid="browser-store-slot">
          <ExtensionStorePill key={storeListing.id} listing={storeListing} onManage={onOpenExtensions} />
        </div>
      )}

      {/* Active Stream Detector Pill Mount */}
      {detectedStream && !storeListing && (
        <div className="browser-stream-detector-slot" data-testid="browser-stream-slot">
          <StreamDetectorPill
            stream={detectedStream}
            onOpenInHub={onOpenInHub}
            onDismiss={onDismissStream}
          />
        </div>
      )}

      <div className="browser-shields-wrapper">
        <button
          type="button"
          className={`browser-shields-btn ${shieldsEnabled ? 'is-active' : 'is-disabled'}`}
          onClick={handleToggleShieldsPopover}
          aria-label="Shields"
          aria-expanded={isShieldsOpen}
          title={shieldsEnabled ? 'Shields on: blocking ads and trackers' : shieldsSite && shieldsGlobalEnabled ? `Shields off for ${shieldsSite}` : 'Shields off'}
          data-testid="browser-shields-button"
        >
          <div className="browser-shields-lion-icon" aria-hidden="true">
            <IconShieldCheck size={17} />
          </div>
          {!shieldsEnabled && (
            <span className="browser-shields-count-badge" data-testid="browser-shields-badge">
              OFF
            </span>
          )}
        </button>

        {isShieldsOpen && (
          <ShieldsPopover
            enabled={shieldsGlobalEnabled}
            site={shieldsSite}
            siteEnabled={shieldsEnabled}
            onToggleShields={() => onToggleShields?.()}
            onToggleSite={() => onToggleShieldsForSite?.()}
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
          setIsShieldsOpen(false)
          onOpenExtensions?.()
        }}
        aria-label="Extensions"
        title="Extensions"
        data-testid="browser-extensions-btn"
      >
        <IconPuzzlePiece size={16} />
      </button>

      {/* Drag spacer and window controls only when toolbar acts as topbar */}
      {windowControls && (
        <>
          <div className="browser-toolbar-drag-spacer" data-tauri-drag-region />
          <div className="browser-toolbar-win-controls" data-tauri-drag-region>
            {windowControls}
          </div>
        </>
      )}

      {isLoading && <div className="browser-loading-bar" aria-hidden="true" data-testid="browser-loading-bar" />}
    </header>
  )
}
