import { type MouseEvent } from 'react'
import { IconPlus, IconX, IconGlobe, IconHome } from './Icons'
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
}

export function BrowserTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: BrowserTabStripProps) {
  const handleTabClick = (id: string) => {
    if (id !== activeTabId) {
      playHapticClick()
      onSelectTab(id)
    }
  }

  const handleTabAuxClick = (e: MouseEvent, id: string) => {
    // Middle click closes tab
    if (e.button === 1) {
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
    <div className="browser-tab-strip" role="tablist" aria-label="Browser tabs" data-testid="browser-tab-strip">
      <div className="browser-tab-list">
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
                  <IconHome size={13} />
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
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  )
}
