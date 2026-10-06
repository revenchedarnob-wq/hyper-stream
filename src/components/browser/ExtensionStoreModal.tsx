import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
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
  IconLock,
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
    accent: '#800000',
  },
  {
    storeId: 'bgnkhhnnamicmpeenaelnjfhikgbkllg',
    name: 'AdGuard AdBlocker',
    tagline: 'Blocks ads, trackers and annoyances.',
    author: 'AdGuard Software',
    accent: '#68BC71',
  },
  {
    storeId: 'mnjggcdmjocbbbhaepdhchncahnbgone',
    name: 'SponsorBlock for YouTube',
    tagline: 'Skips sponsor segments, intros and reminders.',
    author: 'Ajay Ramachandran',
    accent: '#CC0000',
  },
  {
    storeId: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    name: 'Dark Reader',
    tagline: 'Dark mode for every website.',
    author: 'Alexander Shutau',
    accent: '#1F2430',
  },
  {
    storeId: 'gebbhagfogifgggkldgodflihgfeippi',
    name: 'Return YouTube Dislike',
    tagline: 'Shows dislike counts on YouTube again.',
    author: 'Return YouTube Dislike',
    accent: '#2BA640',
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

function ExtensionIcon({ icon, name, accent }: { icon?: string | null; name: string; accent?: string }) {
  if (icon) {
    return (
      <div className="extension-avatar-frame">
        <img className="extension-avatar extension-avatar-img" src={icon} alt="" draggable={false} />
      </div>
    )
  }
  return (
    <div
      className="extension-avatar-frame"
      style={{
        background: accent ? `linear-gradient(135deg, ${accent}40, ${accent}15)` : undefined,
        borderColor: accent ? `${accent}55` : undefined,
      }}
      aria-hidden="true"
    >
      <div className="extension-avatar" style={{ background: accent ?? '#334155' }}>
        {name ? (
          <span className="extension-avatar-letter">{name.charAt(0).toUpperCase()}</span>
        ) : (
          <IconPuzzlePiece size={18} color="#ffffff" />
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

  const modalNode = (
    <div className="extension-store-overlay" data-testid="extension-store-overlay">
      <div className="extension-store-modal" ref={modalRef} role="dialog" aria-label="Browser extensions">
        {/* Header Bar */}
        <header className="extension-store-header">
          <div className="extension-store-title-group">
            <div className="extension-store-brand-icon">
              <IconPuzzlePiece size={20} />
            </div>
            <div className="extension-store-title-text">
              <div className="extension-store-title-row">
                <h2 className="extension-store-title">Extensions</h2>
                {native && (
                  <span className="extension-store-count-badge">
                    <span className="extension-store-count-dot" />
                    {installed.length} installed
                  </span>
                )}
              </div>
              <p className="extension-store-subtitle">
                {native
                  ? 'Chrome and Edge extensions for the built-in browser. Changes apply right away.'
                  : 'Extensions are available in the desktop app.'}
              </p>
            </div>
          </div>

          <div className="extension-store-header-right">
            {/* Segmented Control Tab Switcher */}
            <div className="extension-store-tabs extension-store-tabs-bar" role="tablist">
              {(['installed', 'recommended'] as Tab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  className={`extension-tab-btn ${activeTab === id ? 'is-active' : ''}`}
                  onClick={() => {
                    playHapticClick()
                    setTab(id)
                  }}
                >
                  {id === 'installed' ? `Installed (${installed.length})` : 'Recommended'}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="extension-store-close-btn"
              onClick={() => {
                playHapticGlass()
                onClose()
              }}
              aria-label="Close extensions"
              title="Close (Esc)"
            >
              <IconX size={15} />
            </button>
          </div>
        </header>

        {/* Toolbar & Quick Actions (Desktop only) */}
        {native && (
          <div className="extension-store-controls">
            <div className="extension-omni-row">
              <form className="extension-add-form" onSubmit={handleAddLink}>
                <div className="extension-input-wrapper">
                  <IconPuzzlePiece size={15} className="extension-input-icon" />
                  <input
                    type="text"
                    className="extension-search-input"
                    placeholder="Paste a Chrome Web Store or Edge Add-ons link"
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
                      <IconX size={13} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="extension-install-btn"
                  disabled={!link.trim() || busy !== null}
                >
                  {busy === link.trim() && busy ? (
                    <span className="extension-btn-spinner-row">
                      <span className="extension-spinner" />
                      <span>Adding…</span>
                    </span>
                  ) : (
                    <span>Add</span>
                  )}
                </button>
              </form>
            </div>

            <div className="extension-add-links">
              <span className="extension-catalogs-label">Browse</span>
              <button
                type="button"
                className="extension-catalog-chip"
                onClick={() => openStore(CHROME_STORE_URL)}
                title="Open Chrome Web Store in browser"
              >
                <IconChrome size={13} className="extension-catalog-brand-icon is-chrome" />
                <span>Chrome Web Store</span>
                <IconExternalLink size={10} className="extension-catalog-arrow" />
              </button>
              <button
                type="button"
                className="extension-catalog-chip"
                onClick={() => openStore(EDGE_STORE_URL)}
                title="Open Edge Add-ons in browser"
              >
                <IconEdge size={13} className="extension-catalog-brand-icon is-edge" />
                <span>Edge Add-ons</span>
                <IconExternalLink size={10} className="extension-catalog-arrow" />
              </button>
              <span className="extension-add-links-sep" aria-hidden="true" />
              <button
                type="button"
                className="extension-catalog-chip is-unpacked"
                disabled={busy !== null}
                onClick={() => void handleLoadUnpacked()}
                title="Load unpacked extension from disk"
              >
                <IconFolder size={13} />
                <span>Load unpacked…</span>
              </button>
            </div>

            {/* Smart Advisory: Duplicate Ad Blockers */}
            {blockerCount >= 2 && (
              <div className="extension-notice is-warn" role="status" data-testid="duplicate-blockers">
                <div className="extension-notice-icon-box">
                  <IconAlertTriangle size={15} />
                </div>
                <div className="extension-notice-content">
                  <div className="extension-notice-headline">Ad Blocker Overlap Detected</div>
                  <div className="extension-notice-body">
                    {blockerCount} ad blockers are running ({blockerNames.join(', ')}). They do the same job, and each
                    one uses memory. Turn off or remove all but one to keep the browser light.
                  </div>
                </div>
              </div>
            )}

            {/* Status / Error Toast Notice */}
            {notice && (
              <div
                className={`extension-notice is-${notice.kind}`}
                role={notice.kind === 'error' ? 'alert' : 'status'}
              >
                <div className="extension-notice-icon-box">
                  {notice.kind === 'error' ? <IconAlertTriangle size={15} /> : <IconCheck size={15} />}
                </div>
                <div className="extension-notice-content">
                  <div className="extension-notice-body">{notice.text}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extension Content Body */}
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
                  <IconPuzzlePiece size={32} />
                </div>
                <h4 className="extension-empty-heading">No extensions installed</h4>
                <p className="extension-empty">
                  No extensions yet. Add one from the Recommended tab, or open a Chrome Web Store page and click Add to HyperStream.
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
                      <h3 className="extension-name">{ext.name}</h3>
                      {ext.version && <span className="extension-version">v{ext.version}</span>}
                      {ext.store && (
                        <span className={`extension-source is-${ext.store}`}>
                          {ext.store === 'chrome' ? (
                            <>
                              <IconChrome size={10} /> Chrome Web Store
                            </>
                          ) : (
                            <>
                              <IconEdge size={10} /> Edge Add-ons
                            </>
                          )}
                        </span>
                      )}
                      {ext.legacyFormat && (
                        <span
                          className="extension-source is-legacy"
                          title="Built for Manifest V2, which browsers are phasing out. It may stop working after a WebView2 update."
                        >
                          Older format
                        </span>
                      )}
                    </div>
                    {ext.error ? (
                      <span className="extension-row-error">{ext.error}</span>
                    ) : (
                      <span className="extension-tagline">{ext.description || 'Loaded from a folder'}</span>
                    )}
                  </div>
                  <div className="extension-row-actions">
                    {(ext.hasOptions || ext.hasPopup) && !ext.error && (
                      <button
                        type="button"
                        className="extension-action-btn is-settings"
                        disabled={busy === ext.id || !ext.enabled}
                        onClick={() => void handleOpenSettings(ext)}
                        title="Extension settings"
                        aria-label={`Settings for ${ext.name}`}
                      >
                        <IconSettings size={13} />
                        <span>Settings</span>
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
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="extension-card-grid">
            {RECOMMENDED_EXTENSIONS.map((ext) => {
              const added = isInstalled(ext.storeId)
              return (
                <div key={ext.storeId} className={`extension-card ${added ? 'is-installed' : ''}`}>
                  <div className="extension-card-top">
                    <ExtensionIcon
                      icon={installed.find((e) => e.storeId === ext.storeId || e.id === ext.storeId)?.icon}
                      name={ext.name}
                      accent={ext.accent}
                    />
                    <div className="extension-meta">
                      <div className="extension-card-title-row">
                        <h3 className="extension-name">{ext.name}</h3>
                        <span className="extension-author">by {ext.author}</span>
                      </div>
                      <span className="extension-tagline">{ext.tagline}</span>
                    </div>
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
                          <IconCheck size={13} />
                          <span>Installed</span>
                        </>
                      ) : busy === ext.storeId ? (
                        <span className="extension-btn-spinner-row">
                          <span className="extension-spinner" />
                          <span>Adding…</span>
                        </span>
                      ) : (
                        <>
                          <IconPlus size={13} />
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

        {/* Footer Bar */}
        <footer className="extension-store-footer">
          <div className="extension-store-status-note">
            <IconLock size={13} className="extension-footer-lock-icon" />
            <span>Installed straight from the Chrome Web Store or Edge Add-ons, and kept up to date.</span>
          </div>
          {native && installed.some((e) => e.store) && (
            <button
              type="button"
              className="extension-update-btn"
              disabled={busy !== null}
              onClick={() => void handleCheckUpdates()}
              title="Check all installed extensions for updates"
            >
              <IconReload size={13} className={busy === 'updates' ? 'is-spinning' : ''} />
              <span>{busy === 'updates' ? 'Checking…' : 'Check for updates'}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode
}
