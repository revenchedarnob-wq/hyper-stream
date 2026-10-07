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

const CHROME_STORE_URL = 'https://chromewebstore.google.com/category/extensions'
const EDGE_STORE_URL = 'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home'

export interface ExtensionStoreModalProps {
  isOpen: boolean
  onClose: () => void
  /** Opens a page in the built-in browser (store pages, extension settings). */
  onOpenPage?: (url: string) => void
}

interface Notice {
  kind: 'ok' | 'error'
  text: string
}

function ExtensionIcon({
  icon,
  name,
}: {
  icon?: string | null
  name: string
}) {
  const [imgFailed, setImgFailed] = useState(false)

  if (icon && !imgFailed) {
    return (
      <div className="extension-icon-frame">
        <img
          className="extension-official-icon"
          src={icon}
          alt={name ? `${name} icon` : 'Extension icon'}
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      </div>
    )
  }

  return (
    <div className="extension-icon-frame is-fallback" aria-hidden="true">
      <IconPuzzlePiece size={16} />
    </div>
  )
}

export function ExtensionStoreModal({ isOpen, onClose, onOpenPage }: ExtensionStoreModalProps) {
  // Always invoke hooks unconditionally at the very top (Rules of Hooks)
  const native = isTauri()
  const settings = useSettings()
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [loaded, setLoaded] = useState(!native)
  const [link, setLink] = useState('')
  const [showAddDrawer, setShowAddDrawer] = useState(false)
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

  // Every extra ad blocker is another always-running process doing Shields' job.
  const blockers = installed.filter((e) => e.enabled && isAdBlocker(e))
  const blockerCount = blockers.length + (settings.shieldsEnabled ? 1 : 0)
  const blockerNames = [...(settings.shieldsEnabled ? ['Shields'] : []), ...blockers.map((e) => e.name)]
  const activeCount = installed.filter((e) => e.enabled).length

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
      setShowAddDrawer(false)
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

  const backdropElement = (
    <div
      className="extension-store-backdrop"
      onClick={close}
      aria-hidden="true"
      data-testid="extension-store-overlay"
    />
  )

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(backdropElement, document.body) : backdropElement}
      <div
        ref={modalRef}
        className="extension-store-modal extension-store-flyout"
        role="dialog"
        aria-label="Browser extensions"
        data-testid="extension-store-modal"
      >
        {/* Header Bar */}
        <header className="extension-store-header">
          <div className="extension-store-header-brand">
            <div className="extension-header-icon-box" aria-hidden="true">
              <IconPuzzlePiece size={15} />
            </div>
            <div className="extension-store-header-titles">
              <h3 className="extension-store-title">Extensions</h3>
              <span className="extension-store-count-badge">
                {installed.length === 0 ? 'None installed' : `${activeCount} enabled · ${installed.length} total`}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="extension-store-close-btn"
            onClick={close}
            aria-label="Close extensions"
            title="Close (Esc)"
          >
            <IconX size={13} />
          </button>
        </header>

        {!native && (
          <div className="extension-desktop-notice">
            <p className="extension-store-subtitle">
              Extensions are available in the desktop app.
            </p>
          </div>
        )}

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
          <div className="extension-list">
            {!loaded ? (
              <div className="extension-empty-state">
                <span className="extension-spinner is-large" />
                <p className="extension-empty">Loading extensions…</p>
              </div>
            ) : installed.length === 0 ? (
              <div className="extension-empty-state">
                <div className="extension-empty-icon-wrap" aria-hidden="true">
                  <IconPuzzlePiece size={22} />
                </div>
                <h4 className="extension-empty-heading">No extensions installed</h4>
                <p className="extension-empty">
                  Add extensions directly from the Chrome Web Store, Edge Add-ons, or load an unpacked folder.
                </p>
                <div className="extension-empty-catalog-actions">
                  <button
                    type="button"
                    className="extension-empty-catalog-btn is-chrome"
                    onClick={() => openStore(CHROME_STORE_URL)}
                  >
                    <IconChrome size={13} />
                    <span>Chrome Web Store</span>
                    <IconExternalLink size={10} />
                  </button>
                  <button
                    type="button"
                    className="extension-empty-catalog-btn is-edge"
                    onClick={() => openStore(EDGE_STORE_URL)}
                  >
                    <IconEdge size={13} />
                    <span>Edge Add-ons</span>
                    <IconExternalLink size={10} />
                  </button>
                </div>
              </div>
            ) : (
              installed.map((ext) => (
                <div key={ext.id} className={`extension-row ${ext.enabled ? '' : 'is-off'}`}>
                  <ExtensionIcon icon={ext.icon} name={ext.name} />
                  <div className="extension-meta">
                    <div className="extension-name-row">
                      <h4 className="extension-name" title={ext.name}>{ext.name}</h4>
                    </div>
                    {ext.error ? (
                      <span className="extension-row-error">{ext.error}</span>
                    ) : (
                      <span className="extension-tagline" title={ext.description || ''}>
                        {ext.description || `${ext.version ? `v${ext.version} · ` : ''}${ext.store === 'chrome' ? 'Chrome Store' : ext.store === 'edge' ? 'Edge Add-ons' : 'Extension'}`}
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
                      className="extension-action-btn is-remove"
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
        </div>

        {/* Streamlined Footer Bar (Spacious, No Clipping) */}
        <footer className="extension-store-footer">
          <div className="extension-store-footer-bar">
            <button
              type="button"
              className="extension-footer-btn is-store"
              onClick={() => openStore(CHROME_STORE_URL)}
              title="Open Chrome Web Store in browser"
            >
              <IconChrome size={13} className="is-chrome" />
              <span>Web Store</span>
              <IconExternalLink size={10} className="is-arrow" />
            </button>

            {native && (
              <>
                <button
                  type="button"
                  className="extension-footer-btn"
                  onClick={() => void handleLoadUnpacked()}
                  disabled={busy !== null}
                  title="Load unpacked extension folder"
                >
                  <IconFolder size={12} />
                  <span>Unpacked</span>
                </button>

                <button
                  type="button"
                  className={`extension-footer-btn ${showAddDrawer ? 'is-active' : ''}`}
                  onClick={() => {
                    playHapticClick()
                    setShowAddDrawer(!showAddDrawer)
                  }}
                  title="Install extension by link or store ID"
                >
                  <IconPlus size={12} />
                  <span>Add by link</span>
                </button>
              </>
            )}
          </div>

          {/* Smooth Expandable Add-by-Link Drawer */}
          {native && (showAddDrawer || link) && (
            <div className="extension-store-controls-drawer">
              <form className="extension-add-form" onSubmit={handleAddLink}>
                <div className="extension-input-wrapper">
                  <IconPuzzlePiece size={12} className="extension-input-icon" />
                  <input
                    type="text"
                    className="extension-search-input"
                    placeholder="Paste Chrome Web Store or Edge link…"
                    aria-label="Extension link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
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
                    <span className="extension-spinner" />
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
                <IconReload size={10} className={busy === 'updates' ? 'is-spinning' : ''} />
                <span>{busy === 'updates' ? 'Checking…' : 'Check for updates'}</span>
              </button>
            </div>
          )}
        </footer>
      </div>
    </>
  )
}
