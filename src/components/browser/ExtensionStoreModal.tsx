import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import {
  errorMessage,
  extensionPageUrl,
  getInstalledExtensions,
  installStoreExtension,
  isTauri,
  loadUnpackedExtension,
  pickStorageFolder,
  setExtensionEnabled,
  uninstallExtension,
  updateExtensions,
  type InstalledExtension,
} from '@/lib/tauri-bridge'
import {
  IconPuzzlePiece,
  IconX,
  IconPlus,
  IconCheck,
  IconReload,
  IconTrash,
  IconSettings,
  IconExternalLink,
  IconFolder,
  IconAlertTriangle,
  IconChrome,
  IconEdge,
} from './Icons'
import { playHapticClick, playHapticPop, playHapticGlass } from '@/lib/sound'
import { useSettings } from '@/lib/hooks'
import { isAdBlocker } from './ad-blockers'
import './extension-store.css'

export interface RecommendedExtension {
  /** Chrome Web Store id; installs always fetch the latest version. */
  storeId: string
  name: string
  tagline: string
  author: string
  accent: string
}

export const RECOMMENDED_EXTENSIONS: RecommendedExtension[] = [
  {
    storeId: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
    name: 'uBlock Origin Lite',
    tagline: 'Light, efficient content blocker. No telemetry.',
    author: 'Raymond Hill',
    accent: '#ef4444',
  },
  {
    storeId: 'bgnkhhnnamicmpeenaelnjfhikgbkllg',
    name: 'AdGuard AdBlocker',
    tagline: 'Blocks ads, trackers and annoyances.',
    author: 'AdGuard Software',
    accent: '#10b981',
  },
  {
    storeId: 'mnjggcdmjocbbbhaepdhchncahnbgone',
    name: 'SponsorBlock for YouTube',
    tagline: 'Skips sponsor segments, intros and reminders.',
    author: 'Ajay Ramachandran',
    accent: '#f87171',
  },
  {
    storeId: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    name: 'Dark Reader',
    tagline: 'Dark mode for every website.',
    author: 'Alexander Shutau',
    accent: '#818cf8',
  },
  {
    storeId: 'gebbhagfogifgggkldgodflihgfeippi',
    name: 'Return YouTube Dislike',
    tagline: 'Shows dislike counts on YouTube again.',
    author: 'Return YouTube Dislike',
    accent: '#38bdf8',
  },
]

const CHROME_STORE_URL = 'https://chromewebstore.google.com/category/extensions'
const EDGE_STORE_URL = 'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home'

export interface ExtensionStoreModalProps {
  isOpen: boolean
  onClose: () => void
  /** Opens a page in the built-in browser (store pages, extension settings). */
  onOpenPage?: (url: string) => void
}

type Tab = 'installed' | 'recommended'
interface Notice {
  kind: 'ok' | 'error'
  text: string
}

function ExtensionIcon({
  storeId,
  icon,
  name,
}: {
  storeId?: string
  icon?: string | null
  name: string
  accent?: string
}) {
  if (icon) {
    return (
      <div className="extension-avatar-frame">
        <img className="extension-avatar extension-avatar-img" src={icon} alt="" draggable={false} />
      </div>
    )
  }

  // Bespoke iconography tailored to each recommended extension in HyperStream style
  if (storeId === 'ddkjiahejlhfcafbddmgiahcphecmpfh') {
    return (
      <div className="extension-avatar-frame is-ublock" aria-hidden="true">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>
    )
  }

  if (storeId === 'bgnkhhnnamicmpeenaelnjfhikgbkllg') {
    return (
      <div className="extension-avatar-frame is-adguard" aria-hidden="true">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>
    )
  }

  if (storeId === 'mnjggcdmjocbbbhaepdhchncahnbgone') {
    return (
      <div className="extension-avatar-frame is-sponsorblock" aria-hidden="true">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 19 22 12 13 5 13 19" />
          <polygon points="2 19 11 12 2 5 2 19" />
        </svg>
      </div>
    )
  }

  if (storeId === 'eimadpbcbfnmbkopoojfekhnkhdbieeh') {
    return (
      <div className="extension-avatar-frame is-darkreader" aria-hidden="true">
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </div>
    )
  }

  if (storeId === 'gebbhagfogifgggkldgodflihgfeippi') {
    return (
      <div className="extension-avatar-frame is-dislike" aria-hidden="true">
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h-1.5a1.5 1.5 0 0 1-1.5-1.5v-2.38z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="extension-avatar-frame" aria-hidden="true">
      <div className="extension-avatar">
        {name ? (
          <span className="extension-avatar-letter">{name.charAt(0).toUpperCase()}</span>
        ) : (
          <IconPuzzlePiece size={16} />
        )}
      </div>
    </div>
  )
}

export function ExtensionStoreModal({ isOpen, onClose, onOpenPage }: ExtensionStoreModalProps) {
  // Always invoke hooks unconditionally at the very top (Rules of Hooks)
  const native = isTauri()
  const settings = useSettings()
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab | null>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dismissBlockerWarning, setDismissBlockerWarning] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setLoaded(true)
      return
    }
    try {
      setInstalled(await getInstalledExtensions())
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) })
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setNotice(null)
    setDismissBlockerWarning(false)
    void refresh()
  }, [isOpen, refresh])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    function handleMouseDown(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Every extra ad blocker is another always-running process (often 100 MB+) doing Shields' job.
  const blockers = installed.filter((e) => e.enabled && isAdBlocker(e))
  const blockerCount = blockers.length + (settings.shieldsEnabled ? 1 : 0)
  const blockerNames = [...(settings.shieldsEnabled ? ['Shields'] : []), ...blockers.map((e) => e.name)]

  const activeTab: Tab = tab ?? (installed.length > 0 ? 'installed' : 'recommended')
  const isInstalled = (storeId: string) => installed.some((e) => e.storeId === storeId || e.id === storeId)

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key)
    setNotice(null)
    try {
      const done = await action()
      if (done) setNotice({ kind: 'ok', text: done })
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const install = (input: string, name?: string) =>
    run(input, async () => {
      playHapticPop()
      const id = await installStoreExtension(input)
      const added = (await getInstalledExtensions()).find((e) => e.id === id || e.storeId === id)
      setTab('installed')
      return `${added?.name ?? name ?? 'Extension'} added.`
    })

  const handleAddLink = (e: FormEvent) => {
    e.preventDefault()
    const input = link.trim()
    if (!input || busy) return
    void install(input).then(() => setLink(''))
  }

  const handleLoadUnpacked = async () => {
    playHapticClick()
    const folder = await pickStorageFolder()
    if (!folder) return
    await run('unpacked', async () => {
      await loadUnpackedExtension(folder)
      setTab('installed')
      return 'Extension loaded.'
    })
  }

  const handleToggle = (ext: InstalledExtension) =>
    run(ext.id, async () => {
      playHapticClick()
      await setExtensionEnabled(ext.id, !ext.enabled)
    })

  const handleRemove = (ext: InstalledExtension) =>
    run(ext.id, async () => {
      playHapticPop()
      await uninstallExtension(ext.id)
      return `${ext.name} removed.`
    })

  const handleOpenSettings = (ext: InstalledExtension) =>
    run(ext.id, async () => {
      playHapticClick()
      const url = await extensionPageUrl(ext.id, ext.hasOptions ? 'options' : 'popup')
      onOpenPage?.(url)
    })

  const handleCheckUpdates = () =>
    run('updates', async () => {
      playHapticClick()
      const count = await updateExtensions()
      return count === 0 ? 'Everything is up to date.' : `Updated ${count} ${count === 1 ? 'extension' : 'extensions'}.`
    })

  const openStore = (url: string) => {
    playHapticClick()
    onOpenPage?.(url)
  }

  const close = () => {
    playHapticGlass()
    onClose()
  }

  return (
    <>
      <div
        className="extension-store-backdrop"
        onClick={close}
        aria-hidden="true"
        data-testid="extension-store-overlay"
      />
      <div
        ref={modalRef}
        className="extension-store-modal extension-store-flyout"
        role="dialog"
        aria-label="Browser extensions"
        data-testid="extension-store-modal"
      >
        {/* Header Bar */}
        <header className="extension-store-header">
          <div className="extension-store-header-top">
            <div className="extension-store-header-brand">
              <div className="extension-store-lion-badge">
                <IconPuzzlePiece size={18} />
              </div>
              <div className="extension-store-header-titles">
                <h3 className="extension-store-title">Extensions</h3>
                <div className={`extension-store-status-subtitle ${installed.length > 0 ? 'is-up' : 'is-idle'}`}>
                  <span className="extension-store-status-dot" />
                  <span>{installed.length === 0 ? 'No extensions installed' : `${installed.length} active`}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="extension-store-close-btn"
              onClick={close}
              aria-label="Close extensions"
              title="Close (Esc)"
            >
              <IconX size={14} />
            </button>
          </div>

          {!native && (
            <p className="extension-store-subtitle">
              Extensions are available in the desktop app.
            </p>
          )}

          {/* Navigation Bar: Segmented Tabs */}
          <div className="extension-store-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'installed'}
              className={`extension-tab-btn ${activeTab === 'installed' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setTab('installed')
              }}
            >
              {`Installed (${installed.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recommended'}
              className={`extension-tab-btn ${activeTab === 'recommended' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setTab('recommended')
              }}
            >
              Recommended
            </button>
          </div>
        </header>

        {/* Smart Advisory: Duplicate Ad Blockers */}
        {blockerCount >= 2 && !dismissBlockerWarning && (
          <div className="extension-notice is-warn" role="status" data-testid="duplicate-blockers">
            <div className="extension-notice-icon-box">
              <IconAlertTriangle size={13} />
            </div>
            <div className="extension-notice-content">
              <div className="extension-notice-headline">
                Multiple ad blockers active ({blockerNames.join(', ')})
              </div>
              <div className="extension-notice-body">
                {blockerCount} ad blockers are running. Keep just one active for peak speed.
              </div>
            </div>
            <button
              type="button"
              className="extension-notice-dismiss"
              onClick={() => setDismissBlockerWarning(true)}
              aria-label="Dismiss warning"
              title="Dismiss tip"
            >
              <IconX size={12} />
            </button>
          </div>
        )}

        {/* Status / Error Toast Notice */}
        {notice && (
          <div
            className={`extension-notice is-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            <div className="extension-notice-icon-box">
              {notice.kind === 'error' ? <IconAlertTriangle size={13} /> : <IconCheck size={13} />}
            </div>
            <div className="extension-notice-content">
              <div className="extension-notice-body">{notice.text}</div>
            </div>
          </div>
        )}

        {/* Extension Content Body */}
        <div className="extension-store-body">
          {activeTab === 'installed' ? (
            <div className="extension-list">
              {!loaded ? (
                <div className="extension-empty-state">
                  <span className="extension-spinner is-large" />
                  <p className="extension-empty">Loading extensions…</p>
                </div>
              ) : installed.length === 0 ? (
                <div className="extension-empty-state">
                  <div className="extension-empty-icon-wrap">
                    <IconPuzzlePiece size={24} />
                  </div>
                  <h4 className="extension-empty-heading">No extensions installed</h4>
                  <p className="extension-empty">
                    Add recommended extensions or browse the Chrome Web Store.
                  </p>
                  <button
                    type="button"
                    className="extension-tab-switch-cta"
                    onClick={() => {
                      playHapticClick()
                      setTab('recommended')
                    }}
                  >
                    Explore Recommended
                  </button>
                </div>
              ) : (
                installed.map((ext) => (
                  <div key={ext.id} className={`extension-row ${ext.enabled ? '' : 'is-off'}`}>
                    <ExtensionIcon icon={ext.icon} name={ext.name} />
                    <div className="extension-meta">
                      <div className="extension-name-row">
                        <h3 className="extension-name" title={ext.name}>{ext.name}</h3>
                        {ext.version && <span className="extension-version">v{ext.version}</span>}
                        {ext.store && (
                          <span className={`extension-source is-${ext.store}`}>
                            {ext.store === 'chrome' ? 'Chrome' : 'Edge'}
                          </span>
                        )}
                        {ext.legacyFormat && (
                          <span
                            className="extension-source is-legacy"
                            title="Built for Manifest V2, which browsers are phasing out."
                          >
                            MV2
                          </span>
                        )}
                      </div>
                      {ext.error ? (
                        <span className="extension-row-error">{ext.error}</span>
                      ) : (
                        <span className="extension-tagline" title={ext.description || ''}>
                          {ext.description || 'Loaded extension'}
                        </span>
                      )}
                    </div>
                    <div className="extension-row-actions">
                      {(ext.hasOptions || ext.hasPopup) && !ext.error && (
                        <button
                          type="button"
                          className="extension-action-btn is-settings"
                          disabled={busy === ext.id || !ext.enabled}
                          onClick={() => void handleOpenSettings(ext)}
                          title="Extension options"
                          aria-label={`Settings for ${ext.name}`}
                        >
                          <IconSettings size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ext.enabled}
                        aria-label={`${ext.enabled ? 'Turn off' : 'Turn on'} ${ext.name}`}
                        className={`extension-switch-btn ${ext.enabled ? 'is-active' : ''}`}
                        disabled={busy === ext.id}
                        onClick={() => void handleToggle(ext)}
                        title={ext.enabled ? 'Enabled' : 'Disabled'}
                      >
                        <span className="extension-switch-knob" />
                      </button>
                      <button
                        type="button"
                        className="extension-remove-btn"
                        disabled={busy === ext.id}
                        onClick={() => void handleRemove(ext)}
                        aria-label={`Remove ${ext.name}`}
                        title={`Remove ${ext.name}`}
                      >
                        <IconTrash size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="extension-card-grid extension-recommended-list">
              {RECOMMENDED_EXTENSIONS.map((ext) => {
                const added = isInstalled(ext.storeId)
                return (
                  <div key={ext.storeId} className={`extension-card extension-recommended-row ${added ? 'is-installed' : ''}`}>
                    <ExtensionIcon
                      storeId={ext.storeId}
                      icon={installed.find((e) => e.storeId === ext.storeId || e.id === ext.storeId)?.icon}
                      name={ext.name}
                      accent={ext.accent}
                    />
                    <div className="extension-meta">
                      <h3 className="extension-name" title={ext.name}>{ext.name}</h3>
                      <span className="extension-tagline">{ext.tagline}</span>
                      <span className="extension-author">by {ext.author}</span>
                    </div>
                    <div className="extension-card-actions">
                      <button
                        type="button"
                        className={`extension-install-btn ${added ? 'is-added' : ''}`}
                        disabled={!native || added || busy !== null}
                        onClick={() => void install(ext.storeId, ext.name)}
                        aria-label={added ? `${ext.name} installed` : `Add ${ext.name}`}
                      >
                        {added ? (
                          <>
                            <IconCheck size={12} />
                            <span>Installed</span>
                          </>
                        ) : busy === ext.storeId ? (
                          <span className="extension-btn-spinner-row">
                            <span className="extension-spinner" />
                            <span>Adding…</span>
                          </span>
                        ) : (
                          <>
                            <IconPlus size={12} />
                            <span>Add</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <footer className="extension-store-footer">
          {/* Quick Catalogs Strip */}
          <div className="extension-store-catalogs-strip">
            <button
              type="button"
              className="extension-catalog-pill"
              onClick={() => openStore(CHROME_STORE_URL)}
              title="Open Chrome Web Store in browser"
            >
              <IconChrome size={12} className="is-chrome" />
              <span>Chrome Web Store</span>
              <IconExternalLink size={10} className="is-arrow" />
            </button>

            <button
              type="button"
              className="extension-catalog-pill"
              onClick={() => openStore(EDGE_STORE_URL)}
              title="Open Edge Add-ons in browser"
            >
              <IconEdge size={12} className="is-edge" />
              <span>Edge Add-ons</span>
              <IconExternalLink size={10} className="is-arrow" />
            </button>

            {native && (
              <button
                type="button"
                className="extension-catalog-pill is-unpacked"
                disabled={busy !== null}
                onClick={() => void handleLoadUnpacked()}
                title="Load unpacked extension folder"
              >
                <IconFolder size={12} />
                <span>Load unpacked…</span>
              </button>
            )}
          </div>

          {/* Quick link paste bar (Desktop Only) */}
          {native && (
            <div className="extension-store-controls">
              <form className="extension-add-form" onSubmit={handleAddLink}>
                <div className="extension-input-wrapper">
                  <IconPuzzlePiece size={12} className="extension-input-icon" />
                  <input
                    type="text"
                    className="extension-search-input"
                    placeholder="Paste a Chrome Web Store or Edge link"
                    aria-label="Extension link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {link && (
                    <button
                      type="button"
                      className="extension-input-clear-btn"
                      onClick={() => setLink('')}
                      aria-label="Clear link input"
                    >
                      <IconX size={11} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="extension-install-btn is-compact"
                  disabled={!link.trim() || busy !== null}
                >
                  {busy === link.trim() && busy ? (
                    <span className="extension-btn-spinner-row">
                      <span className="extension-spinner" />
                    </span>
                  ) : (
                    <span>Add</span>
                  )}
                </button>
              </form>
            </div>
          )}

          {native && installed.some((e) => e.store) && (
            <div className="extension-store-footer-meta">
              <button
                type="button"
                className="extension-update-btn"
                disabled={busy !== null}
                onClick={() => void handleCheckUpdates()}
                title="Check all installed extensions for updates"
              >
                <IconReload size={11} className={busy === 'updates' ? 'is-spinning' : ''} />
                <span>{busy === 'updates' ? 'Checking…' : 'Check for updates'}</span>
              </button>
            </div>
          )}
        </footer>
      </div>
    </>
  )
}
