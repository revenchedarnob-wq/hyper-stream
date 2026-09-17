import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri-bridge'
import { IconPuzzlePiece, IconX, IconLock } from './Icons'
import { playHapticClick, playHapticGlass, playHapticPop } from '@/lib/sound'
import './extension-store.css'

export interface BrowserExtension {
  id: string
  name: string
  tagline: string
  description: string
  category: 'adblock' | 'streaming' | 'appearance' | 'tools'
  rating: number
  usersCount: string
  installed: boolean
  enabled: boolean
  iconBg: string
  author: string
  version: string
  downloadUrl?: string
}

const DEFAULT_EXTENSIONS: BrowserExtension[] = [
  {
    id: 'adguard',
    name: 'AdGuard AdBlocker',
    tagline: 'World premier ad and tracker blocker with clean video streaming',
    description: 'Blocks banner ads, sponsored cards, intrusive GDPR cookie banners, and video pre-roll interruptions without black screens.',
    category: 'adblock',
    rating: 4.8,
    usersCount: '10M+',
    installed: true,
    enabled: true,
    iconBg: '#68BC71',
    author: 'AdGuard Software',
    version: '5.5.2',
    downloadUrl: 'https://github.com/AdguardTeam/AdguardBrowserExtension/releases/download/v5.5.2.3/edge.zip',
  },
  {
    id: 'ublock-origin',
    name: 'uBlock Origin',
    tagline: 'Efficient, wide-spectrum content blocker',
    description: 'High-performance content filtering engine that respects memory and CPU limits. Zero telemetry.',
    category: 'adblock',
    rating: 4.9,
    usersCount: '35M+',
    installed: true,
    enabled: true,
    iconBg: '#800000',
    author: 'Raymond Hill (gorhill)',
    version: '1.74.0',
    downloadUrl: 'https://github.com/gorhill/uBlock/releases/download/1.74.0/uBlock0_1.74.0.chromium.zip',
  },
  {
    id: 'sponsorblock',
    name: 'SponsorBlock for YouTube',
    tagline: 'Skip sponsor segments, intros, and subscribe nags',
    description: 'Crowdsourced database automatically skipping sponsor spots, unpaid self-promotions, and intermission cards.',
    category: 'streaming',
    rating: 4.9,
    usersCount: '6M+',
    installed: false,
    enabled: false,
    iconBg: '#CC0000',
    author: 'Ajay Ramachandran',
    version: '6.1.7',
    downloadUrl: 'https://github.com/ajayyy/SponsorBlock/releases/download/6.1.7/EdgeExtension.zip',
  },
  {
    id: 'dark-reader',
    name: 'Dark Reader',
    tagline: 'Luxury midnight OLED dark mode for every website',
    description: 'Inverts bright white backgrounds into rich, color-graded dark themes with adjustable contrast and warmth.',
    category: 'appearance',
    rating: 4.8,
    usersCount: '8M+',
    installed: false,
    enabled: false,
    iconBg: '#1F2430',
    author: 'Alexander Shutau',
    version: '4.9.132',
    downloadUrl: 'https://github.com/darkreader/darkreader/releases/download/v4.9.132/darkreader-chrome.zip',
  },
  {
    id: 'return-dislike',
    name: 'Return YouTube Dislike',
    tagline: 'Restores the dislike count on all YouTube videos',
    description: 'Fetches accurate dislike ratios and counts directly from archived and community telemetry APIs.',
    category: 'streaming',
    rating: 4.7,
    usersCount: '4.5M+',
    installed: false,
    enabled: false,
    iconBg: '#2BA640',
    author: 'Dmitry Selivanov',
    version: '4.0.6',
    downloadUrl: 'https://github.com/Anarios/return-youtube-dislike/releases/download/v4.0.6/return-youtube-dislike-chrome-4.0.6.zip',
  },
  {
    id: 'enhancer-youtube',
    name: 'Enhancer for YouTube',
    tagline: 'Audio booster up to 500% and playback speed controls',
    description: 'Configurable volume booster, custom playback speed presets, and automatic cinema view.',
    category: 'tools',
    rating: 4.8,
    usersCount: '3M+',
    installed: false,
    enabled: false,
    iconBg: '#FF0033',
    author: 'Maksym S.',
    version: '2.0.124',
  },
]

const STORAGE_KEY = 'hyperstream_browser_extensions_v1'

export interface ExtensionStoreModalProps {
  isOpen: boolean
  onClose: () => void
  onExtensionsChanged?: (extensions: BrowserExtension[]) => void
}

export function ExtensionStoreModal({
  isOpen,
  onClose,
  onExtensionsChanged,
}: ExtensionStoreModalProps) {
  const [extensions, setExtensions] = useState<BrowserExtension[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_EXTENSIONS
  })

  const [activeTab, setActiveTab] = useState<'all' | 'installed' | 'adblock' | 'streaming'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Synchronize with native AppData directory on mount
  useEffect(() => {
    if (!isTauri()) return
    invoke<Array<{ id: string; name: string; version: string; description: string }>>('get_installed_extensions')
      .then((installed) => {
        if (installed && installed.length > 0) {
          const installedIds = new Set(installed.map((item) => item.id))
          setExtensions((prev) =>
            prev.map((ext) => ({
              ...ext,
              installed: installedIds.has(ext.id) || ext.installed,
            }))
          )
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(extensions))
      onExtensionsChanged?.(extensions)
    } catch {}
  }, [extensions, onExtensionsChanged])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    function handleMouseDown(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('mousedown', handleMouseDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleInstallToggle = async (ext: BrowserExtension) => {
    playHapticPop()
    if (ext.installed) {
      // Uninstall
      if (isTauri()) {
        try {
          await invoke('uninstall_browser_extension', { extensionId: ext.id })
        } catch {}
      }
      setExtensions((prev) =>
        prev.map((item) => (item.id === ext.id ? { ...item, installed: false, enabled: false } : item))
      )
      setStatusMessage(`Uninstalled ${ext.name}`)
      setTimeout(() => setStatusMessage(null), 3000)
    } else {
      // Install
      if (isTauri() && ext.downloadUrl) {
        setInstallingId(ext.id)
        setStatusMessage(`Downloading genuine ${ext.name} package...`)
        try {
          await invoke('install_browser_extension', {
            extensionId: ext.id,
            downloadUrl: ext.downloadUrl,
          })
          setExtensions((prev) =>
            prev.map((item) => (item.id === ext.id ? { ...item, installed: true, enabled: true } : item))
          )
          setStatusMessage(`Installed genuine ${ext.name}! Restart browser to apply.`)
        } catch (err) {
          setStatusMessage(`Install failed: ${err}`)
        } finally {
          setInstallingId(null)
          setTimeout(() => setStatusMessage(null), 4000)
        }
      } else {
        setExtensions((prev) =>
          prev.map((item) => (item.id === ext.id ? { ...item, installed: true, enabled: true } : item))
        )
      }
    }
  }

  const handleEnableToggle = (extId: string) => {
    playHapticGlass()
    setExtensions((prev) =>
      prev.map((ext) => {
        if (ext.id !== extId) return ext
        return {
          ...ext,
          enabled: !ext.enabled,
        }
      })
    )
  }

  const handleLoadUnpacked = async () => {
    playHapticClick()
    if (!isTauri()) return
    try {
      const folder = await invoke<string | null>('pick_storage_folder')
      if (folder) {
        setStatusMessage('Loading unpacked extension...')
        await invoke('load_unpacked_extension', { sourcePath: folder })
        const installed = await invoke<Array<{ id: string; name: string; version: string; description: string }>>(
          'get_installed_extensions'
        )
        if (installed) {
          const installedIds = new Set(installed.map((item) => item.id))
          setExtensions((prev) =>
            prev.map((ext) => ({
              ...ext,
              installed: installedIds.has(ext.id) || ext.installed,
            }))
          )
        }
        setStatusMessage('Unpacked extension registered into native profile!')
        setTimeout(() => setStatusMessage(null), 3500)
      }
    } catch (err) {
      setStatusMessage(`Error loading unpacked: ${err}`)
      setTimeout(() => setStatusMessage(null), 4000)
    }
  }

  const filteredExtensions = extensions.filter((ext) => {
    if (activeTab === 'installed' && !ext.installed) return false
    if (activeTab === 'adblock' && ext.category !== 'adblock') return false
    if (activeTab === 'streaming' && ext.category !== 'streaming') return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (
        ext.name.toLowerCase().includes(q) ||
        ext.tagline.toLowerCase().includes(q) ||
        ext.description.toLowerCase().includes(q)
      )
    }
    return true
  })

  const installedCount = extensions.filter((e) => e.installed).length

  return (
    <div className="extension-store-overlay" data-testid="extension-store-overlay">
      <div
        className="extension-store-modal"
        ref={modalRef}
        role="dialog"
        aria-label="Browser Extension Store"
      >
        <header className="extension-store-header">
          <div className="extension-store-title-group">
            <div className="extension-store-brand-icon">
              <IconPuzzlePiece size={20} />
            </div>
            <div>
              <div className="extension-store-title-row">
                <h2 className="extension-store-title">Extension Store</h2>
                <span className="extension-store-installed-pill">
                  {installedCount} Active
                </span>
                {statusMessage && (
                  <span className="extension-store-status-banner">
                    {statusMessage}
                  </span>
                )}
              </div>
              <p className="extension-store-subtitle">
                Native Chromium extension management with real unpacked package loading
              </p>
            </div>
          </div>

          <div className="extension-header-actions">
            {isTauri() && (
              <button
                type="button"
                className="extension-load-unpacked-btn"
                onClick={handleLoadUnpacked}
                title="Load unpacked extension from your hard drive"
              >
                Load Unpacked...
              </button>
            )}
            <button
              type="button"
              className="extension-store-close-btn"
              onClick={() => {
                playHapticClick()
                onClose()
              }}
              aria-label="Close Extension Store"
            >
              <IconX size={16} />
            </button>
          </div>
        </header>

        <div className="extension-store-controls">
          <div className="extension-store-tabs">
            <button
              type="button"
              className={`extension-tab-btn ${activeTab === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setActiveTab('all')
              }}
            >
              All Extensions
            </button>
            <button
              type="button"
              className={`extension-tab-btn ${activeTab === 'installed' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setActiveTab('installed')
              }}
            >
              Installed ({installedCount})
            </button>
            <button
              type="button"
              className={`extension-tab-btn ${activeTab === 'adblock' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setActiveTab('adblock')
              }}
            >
              Adblockers
            </button>
            <button
              type="button"
              className={`extension-tab-btn ${activeTab === 'streaming' ? 'is-active' : ''}`}
              onClick={() => {
                playHapticClick()
                setActiveTab('streaming')
              }}
            >
              Streaming
            </button>
          </div>

          <input
            type="text"
            className="extension-search-input"
            placeholder="Search extensions (e.g. AdGuard, uBlock, Dark Reader)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="extension-card-grid">
          {filteredExtensions.map((ext) => (
            <div
              key={ext.id}
              className={`extension-card ${ext.installed ? 'is-installed' : ''}`}
            >
              <div className="extension-card-top">
                <div
                  className="extension-avatar"
                  style={{ background: ext.iconBg }}
                >
                  <IconPuzzlePiece size={20} color="#ffffff" />
                </div>

                <div className="extension-meta">
                  <div className="extension-name-row">
                    <h3 className="extension-name">{ext.name}</h3>
                    <span className="extension-version">v{ext.version}</span>
                  </div>
                  <span className="extension-tagline">{ext.tagline}</span>
                  <div className="extension-stats-row">
                    <span className="extension-rating">★ {ext.rating}</span>
                    <span className="extension-users">{ext.usersCount} users</span>
                    <span className="extension-author">by {ext.author}</span>
                  </div>
                </div>
              </div>

              <p className="extension-desc">{ext.description}</p>

              <div className="extension-card-actions">
                {ext.installed ? (
                  <div className="extension-installed-controls">
                    <label className="extension-toggle-label">
                      <span className="extension-toggle-text">
                        {ext.enabled ? 'Enabled' : 'Paused'}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ext.enabled}
                        className={`extension-switch-btn ${ext.enabled ? 'is-active' : ''}`}
                        onClick={() => handleEnableToggle(ext.id)}
                      >
                        <span className="extension-switch-knob" />
                      </button>
                    </label>

                    <button
                      type="button"
                      className="extension-remove-btn"
                      onClick={() => handleInstallToggle(ext)}
                    >
                      Uninstall
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="extension-install-btn"
                    disabled={installingId === ext.id}
                    onClick={() => handleInstallToggle(ext)}
                  >
                    {installingId === ext.id ? 'Installing...' : 'Install Extension'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="extension-store-footer">
          <div className="extension-store-status-note">
            <IconLock size={13} />
            <span>Extensions execute natively via Chromium WebView2 profile loader</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
