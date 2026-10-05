import { type MouseEvent } from 'react'
import { IconPlus, IconX, IconGlobe, IconCompass } from './Icons'
import { playHapticClick, playHapticPop } from '@/lib/sound'

export interface BrowserTab {
  id: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  isSaved?: boolean
}

export interface BrowserTabStripProps {
  tabs: BrowserTab[]
  activeTabId: string
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void
  /** Unified header: Brand and sidebar toggle slot on the left. */
  sidebarArea?: React.ReactNode
  /** Unified header: Windows 11 window controls on the right. */
  windowControls?: React.ReactNode
  onTopBarPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerMove?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarPointerUp?: (e: React.PointerEvent<HTMLElement>) => void
  onTopBarDoubleClick?: (e: React.MouseEvent<HTMLElement>) => void
}

export function BrowserTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  sidebarArea,
  windowControls,
  onTopBarPointerDown,
  onTopBarPointerMove,
  onTopBarPointerUp,
  onTopBarDoubleClick,
}: BrowserTabStripProps) {
  const isUnified = Boolean(windowControls)

  const handleTabClick = (id: string) => {
    if (id !== activeTabId) {
      playHapticClick()
      onSelectTab(id)
    }
  }

  const handleTabAuxClick = (e: MouseEvent, id: string) => {
    // Middle click closes tab
    if (e.button === 1 && tabs.length > 1) {
      e.preventDefault()
      e.stopPropagation()
      playHapticPop()
      onCloseTab(id)
    }
  }

  const handleClose = (e: MouseEvent, id: string) => {
    e.stopPropagation()
    playHapticPop()
    onCloseTab(id)
  }

  const handleNewTab = () => {
    playHapticClick()
    onNewTab()
  }

  return (
    <div
      className={`browser-tab-strip ${isUnified ? 'is-unified-header' : ''}`}
      role="tablist"
      aria-label="Browser tabs"
      data-testid="browser-tab-strip"
      data-tauri-drag-region
      onPointerDown={onTopBarPointerDown}
      onPointerMove={onTopBarPointerMove}
      onPointerUp={onTopBarPointerUp}
      onPointerCancel={onTopBarPointerUp}
      onDoubleClick={onTopBarDoubleClick}
    >
      {sidebarArea && (
        <div className="browser-tab-strip-sidebar-slot" data-tauri-drag-region>
          {sidebarArea}
        </div>
      )}

      <div className="browser-tab-list" data-tauri-drag-region>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isHome = tab.url === 'about:blank' || !tab.url
          const displayTitle = tab.title || (isHome ? 'New Tab' : tab.url.replace(/^https?:\/\//, ''))

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`browser-tab ${isActive ? 'is-active' : ''} ${tab.isLoading ? 'is-loading' : ''}`}
              onClick={() => handleTabClick(tab.id)}
              onAuxClick={(e) => handleTabAuxClick(e, tab.id)}
              title={`${displayTitle} (${isHome ? 'Start Page' : tab.url})`}
              data-testid={`browser-tab-${tab.id}`}
            >
              <div className="browser-tab-icon" aria-hidden="true">
                {tab.isLoading ? (
                  <div className="browser-tab-spinner" />
                ) : isHome ? (
                  <IconCompass size={13} />
                ) : (
                  <IconGlobe size={13} />
                )}
              </div>

              <span className="browser-tab-title">{displayTitle}</span>

              {tabs.length > 1 && (
                <button
                  type="button"
                  className="browser-tab-close-btn"
                  onClick={(e) => handleClose(e, tab.id)}
                  aria-label={`Close tab ${displayTitle}`}
                  title="Close tab (Ctrl+W)"
                  data-testid={`browser-tab-close-${tab.id}`}
                >
                  <IconX size={11} />
                </button>
              )}
            </div>
          )
        })}

        <button
          type="button"
          className="browser-tab-new-btn"
          onClick={handleNewTab}
          aria-label="Open new tab"
          title="New tab (Ctrl+T)"
          data-testid="browser-tab-new-btn"
        >
          <IconPlus size={13} />
        </button>
      </div>

      <div className="browser-tab-drag-spacer" data-tauri-drag-region />

      {windowControls && (
        <div className="browser-tab-win-controls" data-tauri-drag-region>
          {windowControls}
        </div>
      )}
    </div>
  )
}
