import React from 'react'
import './settings.css'
import { playHapticClick, playHapticGlass, playHapticPop, playHapticSwoosh } from '@/lib/sound'
import {
  clearBrowsingData,
  errorMessage,
  getInstalledExtensions,
  getDefaultDownloadDir,
  isTauri,
  pickStorageFolder,
  revealInExplorer,
  setMaxConcurrent,
  SEND_TO_HYPERSTREAM_BOOKMARKLET,
  getExtensionStatus,
  type ExtensionStatus,
} from '@/lib/tauri-bridge'
import { detectHardwareProfile, formatGpuName } from '@/lib/hardware-profiler'
import { listen } from '@tauri-apps/api/event'
import { ExtensionSetupDialog } from '@/components/extension/ExtensionSetup'
import { saveSettings, type DefaultQuality } from '@/lib/settings'
import { useEngine, useSettings } from '@/lib/hooks'
import { GlassSelect } from '../common/GlassSelect'
import { IconZap, IconSparkles, IconCheck, IconChevronDown, IconFolder, IconCpu, IconPlus, IconTrash } from '../stream-hub/Icons'
import type { WallpaperOption } from '@/lib/wallpapers'
import { analyzeImageTheme, optimizeUploadedImage } from '@/lib/wallpapers'

interface SettingsProps {
  isPotatoMode: boolean
  onTogglePotatoMode: () => void
  isBloomEnabled: boolean
  onToggleBloom: () => void
  audioMuted: boolean
  onToggleAudio: () => void
  currentWallpaper?: string
  onSelectWallpaper?: (url: string) => void
  wallpapers?: WallpaperOption[]
  onAddCustomWallpaper?: (wallpaper: WallpaperOption) => void
  onDeleteCustomWallpaper?: (id: string) => void
}

type SettingsTab = 'downloads' | 'browser' | 'appearance' | 'audio'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'downloads', label: 'Downloads' },
  { id: 'browser', label: 'Browser' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'audio', label: 'Sound' },
]

const QUALITY_OPTIONS: { value: DefaultQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: 'Up to 4K' },
  { value: '1440', label: 'Up to 1440p' },
  { value: '1080', label: 'Up to 1080p' },
  { value: '720', label: 'Up to 720p' },
  { value: '480', label: 'Up to 480p' },
  { value: 'audio', label: 'Audio only' },
]

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`tactile-toggle ${checked ? 'is-on' : ''}`}
      onClick={() => {
        playHapticClick()
        onChange(!checked)
      }}
    >
      <span className="tactile-toggle-thumb" />
    </button>
  )
}

function Row({ label, desc, children }: { label: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      {children && <div className="settings-row-action">{children}</div>}
    </div>
  )
}

function DownloadsPanel() {
  const settings = useSettings()
  const engine = useEngine()
  const [defaultDir, setDefaultDir] = React.useState('')
  const [notice, setNotice] = React.useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [folderError, setFolderError] = React.useState<string | null>(null)

  React.useEffect(() => {
    void getDefaultDownloadDir().then(setDefaultDir)
  }, [])

  const folder = settings.downloadDir || defaultDir

  const pickFolder = async () => {
    playHapticClick()
    const chosen = await pickStorageFolder()
    if (chosen) {
      saveSettings({ downloadDir: chosen })
      playHapticGlass()
    }
  }

  const changeConcurrency = (value: string) => {
    const limit = Number(value)
    saveSettings({ maxConcurrent: limit })
    setMaxConcurrent(limit).catch((err) => setNotice({ text: errorMessage(err), tone: 'error' }))
  }

  const runEngine = async (action: () => Promise<void>, done: string) => {
    setNotice(null)
    await action()
    setNotice({ text: done, tone: 'info' })
  }

  const ytdlp = engine.status?.ytdlp
  const ffmpeg = engine.status?.ffmpeg
  const deno = engine.status?.deno
  const percent =
    engine.progress?.total && engine.progress.total > 0
      ? Math.round((engine.progress.downloaded / engine.progress.total) * 100)
      : null

  return (
    <div className="settings-tab-panel" id="panel-downloads" role="tabpanel" aria-labelledby="tab-downloads">
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Save To</h2>
        </div>
        <div className="settings-card-group">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-label">Download folder</div>
              <div className="settings-path-box" title={folder}>
                <IconFolder size={13} className="path-icon" />
                <span className="path-text">{folder || 'Videos\\HyperStream'}</span>
              </div>
              {folderError && <div className="settings-row-desc settings-desc-error">{folderError}</div>}
            </div>
            <div className="settings-row-action settings-row-buttons">
              {folder && isTauri() && (
                <button type="button" className="action-btn" onClick={() => { setFolderError(null); revealInExplorer(folder).catch((err) => setFolderError(errorMessage(err))) }}>
                  Open
                </button>
              )}
              {settings.downloadDir && (
                <button type="button" className="action-btn" onClick={() => saveSettings({ downloadDir: '' })}>
                  Reset
                </button>
              )}
              <button type="button" className="action-btn" onClick={() => void pickFolder()} disabled={!isTauri()}>
                Change
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Defaults</h2>
        </div>
        <div className="settings-card-group">
          <Row label="Default quality" desc="Used for new links and batch imports. You can change it per link.">
            <GlassSelect
              id="settings-default-quality"
              value={settings.defaultQuality}
              options={QUALITY_OPTIONS}
              onChange={(v) => saveSettings({ defaultQuality: v as DefaultQuality })}
              ariaLabel="Default quality"
            />
          </Row>
          <Row
            label="Maximum compatibility"
            desc="Prefer H.264 video and AAC audio in MP4 so files play everywhere, including older TVs and editors."
          >
            <Toggle
              label="Maximum compatibility"
              checked={settings.preferCompatible}
              onChange={(next) => saveSettings({ preferCompatible: next })}
            />
          </Row>
          <Row label="Downloads at once" desc="How many downloads run at the same time. The rest wait in line.">
            <GlassSelect
              id="settings-max-concurrent"
              value={String(settings.maxConcurrent)}
              options={CONCURRENCY_OPTIONS}
              onChange={changeConcurrency}
              ariaLabel="Downloads at once"
            />
          </Row>
          <Row label="Clipboard detection" desc="Offer to download a link you copied when you open Stream Hub.">
            <Toggle
              label="Clipboard detection"
              checked={settings.clipboardDetect}
              onChange={(next) => saveSettings({ clipboardDetect: next })}
            />
          </Row>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Download Engine</h2>
          {engine.status && (
            <span className={`settings-badge ${engine.status.all_ready ? 'engine-badge' : 'engine-badge-missing'}`}>
              {engine.status.all_ready ? 'Ready' : 'Not installed'}
            </span>
          )}
        </div>
        <div className="settings-card-group">
          <Row label="yt-dlp" desc={ytdlp?.version ? `Version ${ytdlp.version}` : isTauri() ? 'Not installed' : 'Desktop app only'}>
            <span className="settings-engine-source">{ytdlp?.available ? (ytdlp.managed ? 'Managed' : 'System') : ''}</span>
          </Row>
          <Row label="FFmpeg" desc={ffmpeg?.version ? `Version ${ffmpeg.version}` : isTauri() ? 'Not installed' : 'Desktop app only'}>
            <span className="settings-engine-source">{ffmpeg?.available ? (ffmpeg.managed ? 'Managed' : 'System') : ''}</span>
          </Row>
          <Row
            label="YouTube helper (Deno)"
            desc={deno?.version ? `Version ${deno.version}` : isTauri() ? 'Installs automatically. Without it YouTube may offer fewer qualities.' : 'Desktop app only'}
          >
            <span className="settings-engine-source">{deno?.available ? (deno.managed ? 'Managed' : 'System') : ''}</span>
          </Row>
          <Row
            label={engine.status?.all_ready ? 'Check for updates' : 'Install engine'}
            desc={
              engine.busy
                ? `Working${engine.progress ? ` — ${engine.progress.component}${percent !== null ? ` ${percent}%` : ''}` : '…'}`
                : engine.error
                  ? <span className="settings-desc-error">{engine.error}</span>
                  : notice
                    ? <span className={notice.tone === 'error' ? 'settings-desc-error' : undefined}>{notice.text}</span>
                    : 'Sites change often. Keeping yt-dlp current fixes most download errors. It also updates itself weekly.'
            }
          >
            <button
              type="button"
              className="action-btn"
              disabled={!isTauri() || engine.busy}
              onClick={() =>
                void (engine.status?.all_ready
                  ? runEngine(engine.update, 'Engine is up to date.')
                  : runEngine(engine.install, 'Engine installed.'))
              }
            >
              {engine.busy ? 'Working…' : engine.status?.all_ready ? 'Update' : 'Install'}
            </button>
          </Row>
        </div>
      </section>
    </div>
  )
}

/**
 * The "Send to HyperStream" bookmark for Chrome/Edge. React refuses `javascript:` hrefs, so the
 * link's address is set directly; clicking it here does nothing, dragging it out makes the bookmark.
 */
function SendToHyperStreamRow() {
  const [copied, setCopied] = React.useState(false)
  const setHref = React.useCallback((el: HTMLAnchorElement | null) => {
    el?.setAttribute('href', SEND_TO_HYPERSTREAM_BOOKMARKLET)
  }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SEND_TO_HYPERSTREAM_BOOKMARKLET)
      playHapticGlass()
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Row
      label="Send to HyperStream"
      desc="Download from Chrome or Edge: drag this button to the bookmarks bar, or copy it and paste it as a new bookmark's address. On a video page, click the bookmark; the page opens here, ready to capture."
    >
      <a ref={setHref} className="action-btn" draggable onClick={(e) => e.preventDefault()} title="Drag to your bookmarks bar">
        Send to HyperStream
      </a>
      <button type="button" className="action-btn" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </Row>
  )
}

function BrowserExtensionRow() {
  const [status, setStatus] = React.useState<ExtensionStatus | null>(null)
  const [adding, setAdding] = React.useState(false)
  const refresh = React.useCallback(() => {
    void getExtensionStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])
  React.useEffect(() => {
    refresh()
    const unlisten = listen('extension-connected', refresh)
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [refresh])

  const name = status?.browser?.name ?? 'your browser'
  const desc = !status?.browser
    ? 'Finds videos on the pages you visit and sends downloads here from Chrome, Edge or Brave.'
    : !status.supported
      ? `The extension works in Chrome, Edge and Brave. Your default browser is ${name}; to use it in another browser, load the folder from its extensions page.`
      : status.installed
        ? `Added to ${name}. Right-click a video or link and choose Download with HyperStream.`
        : `Finds videos on the pages you visit and sends downloads here from ${name} with one click.`

  return (
    <Row label="Browser extension" desc={desc}>
      {status?.supported && !status.installed && (
        <button type="button" className="action-btn" onClick={() => setAdding(true)}>
          Add to {name}
        </button>
      )}
      <button
        type="button"
        className="action-btn"
        disabled={!status?.folder}
        onClick={() => status?.folder && void revealInExplorer(status.folder)}
        title="For adding it to another browser by hand"
      >
        Show folder
      </button>
      {adding && (
        <ExtensionSetupDialog
          browserName={name}
          addNow
          onClose={() => {
            setAdding(false)
            refresh()
          }}
        />
      )}
    </Row>
  )
}

function BrowserPanel() {
  const settings = useSettings()
  const [extensionCount, setExtensionCount] = React.useState<number | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [notice, setNotice] = React.useState<{ text: string; tone: 'info' | 'error' } | null>(null)

  React.useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void getInstalledExtensions()
      .then((list) => {
        if (!cancelled) setExtensionCount(list.length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The confirm step times out so a stray second click later can't wipe data.
  React.useEffect(() => {
    if (!confirmClear) return
    const timer = window.setTimeout(() => setConfirmClear(false), 5000)
    return () => window.clearTimeout(timer)
  }, [confirmClear])

  const clear = async () => {
    if (!confirmClear) {
      playHapticClick()
      setConfirmClear(true)
      setNotice(null)
      return
    }
    setConfirmClear(false)
    setClearing(true)
    try {
      await clearBrowsingData()
      playHapticGlass()
      setNotice({ text: 'Browsing data cleared. You are signed out of all sites.', tone: 'info' })
    } catch (err) {
      setNotice({ text: errorMessage(err), tone: 'error' })
    } finally {
      setClearing(false)
    }
  }

  const allowSite = (site: string) => {
    playHapticClick()
    saveSettings({ shieldsAllowedSites: settings.shieldsAllowedSites.filter((s) => s !== site) })
  }

  return (
    <div className="settings-tab-panel" id="panel-browser" role="tabpanel" aria-labelledby="tab-browser">
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Shields</h2>
        </div>
        <div className="settings-card-group">
          <Row label="Block ads and trackers" desc="Blocks known ad and tracking servers in the built-in browser.">
            <Toggle
              label="Block ads and trackers"
              checked={settings.shieldsEnabled}
              onChange={(next) => saveSettings({ shieldsEnabled: next })}
            />
          </Row>
          {settings.shieldsAllowedSites.length === 0 ? (
            <Row label="Sites with Shields off" desc="None. Turn Shields off for a site from the shield button in the browser." />
          ) : (
            settings.shieldsAllowedSites.map((site) => (
              <Row key={site} label={site} desc="Shields are off on this site.">
                <button type="button" className="action-btn" onClick={() => allowSite(site)}>
                  Turn on
                </button>
              </Row>
            ))
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Other browsers</h2>
        </div>
        <div className="settings-card-group">
          <BrowserExtensionRow />
          <SendToHyperStreamRow />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Privacy</h2>
        </div>
        <div className="settings-card-group">
          <Row
            label="Clear browsing data"
            desc={
              notice ? (
                <span className={notice.tone === 'error' ? 'settings-desc-error' : undefined}>{notice.text}</span>
              ) : (
                'Deletes cookies, cache and history, and signs you out of every site. Downloads that need an account will need you to sign in again.'
              )
            }
          >
            <button
              type="button"
              className={`action-btn ${confirmClear ? 'action-btn-danger' : ''}`}
              disabled={!isTauri() || clearing}
              onClick={() => void clear()}
            >
              {clearing ? 'Clearing…' : confirmClear ? 'Click to confirm' : 'Clear'}
            </button>
          </Row>
          <Row
            label="Extensions"
            desc={
              extensionCount === null
                ? 'Install Chrome Web Store and Edge Add-ons extensions from the puzzle button in the browser.'
                : `${extensionCount} installed. Manage them from the puzzle button in the browser.`
            }
          />
        </div>
      </section>
    </div>
  )
}

export function Settings({
  isPotatoMode,
  onTogglePotatoMode,
  isBloomEnabled,
  onToggleBloom,
  audioMuted,
  onToggleAudio,
  currentWallpaper,
  onSelectWallpaper,
  wallpapers,
  onAddCustomWallpaper,
  onDeleteCustomWallpaper,
}: SettingsProps) {
  const settings = useSettings()
  const [showAdvancedSpecs, setShowAdvancedSpecs] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('downloads')
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const hardwareProfile = React.useMemo(() => detectHardwareProfile(), [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    try {
      playHapticPop()
      const optimizedUrl = await optimizeUploadedImage(file)
      const detectedTheme = await analyzeImageTheme(optimizedUrl)
      const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 24)
      const newWallpaper: WallpaperOption = {
        id: `custom-${Date.now()}`,
        name: cleanName || 'Custom Wallpaper',
        url: optimizedUrl,
        theme: detectedTheme,
        isCustom: true,
      }
      onAddCustomWallpaper?.(newWallpaper)
      onSelectWallpaper?.(newWallpaper.url)
      playHapticGlass()
    } catch (err) {
      console.error('Failed to upload custom wallpaper:', err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const selectProfile = (potato: boolean) => {
    if (potato === isPotatoMode) return
    if (potato) playHapticPop()
    else playHapticGlass()
    onTogglePotatoMode()
  }

  const profileKeyDown = (potato: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      selectProfile(potato)
    }
  }

  return (
    <div className="settings-view">
      <header className="settings-header">
        <div className="settings-title-row">
          <h1 className="settings-title">Settings</h1>
        </div>

        <div className="settings-nav-bar" role="tablist" aria-label="Settings categories">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              className={`settings-nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                playHapticClick()
                setActiveTab(tab.id)
              }}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="settings-content-scroll">
        {activeTab === 'downloads' && <DownloadsPanel />}
        {activeTab === 'browser' && <BrowserPanel />}

        {activeTab === 'appearance' && (
          <div className="settings-tab-panel" id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance">
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Rendering Profile</h2>
                <span className="profile-hardware-chip" title={hardwareProfile.gpuRenderer}>
                  <IconCpu size={12} className="hardware-chip-icon" />
                  <span>
                    {formatGpuName(hardwareProfile.gpuRenderer)} · {hardwareProfile.logicalCores} Cores
                  </span>
                </span>
              </div>

              <div className="rendering-profile-grid" role="radiogroup" aria-label="Rendering profile">
                <div
                  role="radio"
                  aria-checked={isPotatoMode}
                  tabIndex={0}
                  className={`profile-card profile-card-potato ${isPotatoMode ? 'selected' : ''}`}
                  onClick={() => selectProfile(true)}
                  onKeyDown={profileKeyDown(true)}
                >
                  <div className="profile-card-left">
                    <span className="profile-icon potato">
                      <IconZap size={14} />
                    </span>
                    <div className="profile-card-text">
                      <div className="profile-title-row">
                        <span className="profile-title">Efficiency Mode</span>
                        {hardwareProfile.recommendedRenderingProfile === 'potato' && (
                          <span className="profile-rec-tag">Recommended</span>
                        )}
                      </div>
                      <div className="profile-subtitle">Lighter effects · Best on battery</div>
                    </div>
                  </div>
                  <span className="profile-radio-dot">{isPotatoMode && <IconCheck size={11} />}</span>
                </div>

                <div
                  role="radio"
                  aria-checked={!isPotatoMode}
                  tabIndex={0}
                  className={`profile-card profile-card-studio ${!isPotatoMode ? 'selected' : ''}`}
                  onClick={() => selectProfile(false)}
                  onKeyDown={profileKeyDown(false)}
                >
                  <div className="profile-card-left">
                    <span className="profile-icon studio">
                      <IconSparkles size={14} />
                    </span>
                    <div className="profile-card-text">
                      <div className="profile-title-row">
                        <span className="profile-title">Studio Glass</span>
                        {hardwareProfile.recommendedRenderingProfile === 'studio' && (
                          <span className="profile-rec-tag">Recommended</span>
                        )}
                      </div>
                      <div className="profile-subtitle">Live blur · Full effects</div>
                    </div>
                  </div>
                  <span className="profile-radio-dot">{!isPotatoMode && <IconCheck size={11} />}</span>
                </div>
              </div>

              <div className="advanced-specs-wrapper">
                <button
                  type="button"
                  className="advanced-specs-toggle"
                  aria-expanded={showAdvancedSpecs}
                  onClick={() => {
                    playHapticClick()
                    setShowAdvancedSpecs((prev) => !prev)
                  }}
                >
                  <span>Details</span>
                  <IconChevronDown size={12} className={`specs-chevron ${showAdvancedSpecs ? 'open' : ''}`} />
                </button>

                {showAdvancedSpecs && (
                  <div className="advanced-specs-body">
                    <div className="spec-item">
                      <span className="spec-label">Background</span>
                      <span className="spec-val">{isPotatoMode ? 'Pre-blurred image' : 'Live blur'}</span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Detected GPU</span>
                      <span className="spec-val" title={hardwareProfile.gpuRenderer}>
                        {formatGpuName(hardwareProfile.gpuRenderer)}
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">CPU threads</span>
                      <span className="spec-val">{hardwareProfile.logicalCores}</span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Recommended</span>
                      <span className="spec-val">
                        {hardwareProfile.recommendedRenderingProfile === 'potato' ? 'Efficiency Mode' : 'Studio Glass'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Effects</h2>
              </div>
              <div className="settings-card-group">
                <Row label="Glow" desc="Soft edge lighting on active panels">
                  <Toggle label="Glow" checked={isBloomEnabled} onChange={() => onToggleBloom()} />
                </Row>
              </div>
            </section>

            {wallpapers && onSelectWallpaper && (
              <section className="settings-section">
                <div className="settings-section-header">
                  <h2 className="settings-section-title">Wallpaper</h2>
                </div>
                <div className="wallpaper-gallery-grid" role="radiogroup" aria-label="Wallpapers">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif"
                    style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0.01, pointerEvents: 'none' }}
                    onChange={handleFileUpload}
                  />

                  {wallpapers.map((wp) => {
                    const isSelected = currentWallpaper === wp.url
                    const select = () => {
                      playHapticGlass()
                      onSelectWallpaper(wp.url)
                    }
                    return (
                      <div
                        key={wp.id}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        className={`wallpaper-card ${isSelected ? 'active' : ''}`}
                        onClick={select}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            select()
                          }
                        }}
                      >
                        <div className="wallpaper-thumb" style={{ backgroundImage: `url("${wp.thumbUrl ?? wp.url}")` }}>
                          {wp.isCustom && onDeleteCustomWallpaper && (
                            <button
                              type="button"
                              className="wallpaper-delete-btn"
                              title="Delete custom wallpaper"
                              aria-label={`Delete ${wp.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                playHapticPop()
                                onDeleteCustomWallpaper(wp.id)
                              }}
                            >
                              <IconTrash size={11} />
                            </button>
                          )}
                          {isSelected && (
                            <span className="wallpaper-active-dot">
                              <IconCheck size={10} />
                            </span>
                          )}
                        </div>
                        <div className="wallpaper-caption">
                          <span className="wallpaper-name">{wp.name}</span>
                        </div>
                      </div>
                    )
                  })}

                  <div
                    role="button"
                    tabIndex={0}
                    className="wallpaper-card wallpaper-upload-card"
                    title="Upload any image — automatic 2K scaling, blur & theme adaptation"
                    onClick={() => {
                      playHapticClick()
                      fileInputRef.current?.click()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                  >
                    <div className="wallpaper-thumb wallpaper-upload-thumb">
                      <div className="wallpaper-upload-icon-circle">
                        <IconPlus size={16} />
                      </div>
                      <span className="wallpaper-upload-hint">
                        {isUploading ? 'Applying blur…' : 'Upload Image'}
                      </span>
                    </div>
                    <div className="wallpaper-caption">
                      <span className="wallpaper-name">Custom 2K+</span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="settings-tab-panel" id="panel-audio" role="tabpanel" aria-labelledby="tab-audio">
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Sound</h2>
              </div>
              <div className="settings-card-group">
                <Row label="Interface sounds" desc="Soft clicks and chimes when you use controls">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!audioMuted}
                    aria-label="Interface sounds"
                    className={`tactile-toggle ${!audioMuted ? 'is-on' : ''}`}
                    onClick={() => {
                      onToggleAudio()
                      if (audioMuted) playHapticGlass()
                    }}
                  >
                    <span className="tactile-toggle-thumb" />
                  </button>
                </Row>
                <Row label="Preview sounds">
                  <div className="haptic-audition-group">
                    <button type="button" className="audition-btn" onClick={() => playHapticClick()}>
                      Click
                    </button>
                    <button type="button" className="audition-btn" onClick={() => playHapticPop()}>
                      Pop
                    </button>
                    <button type="button" className="audition-btn" onClick={() => playHapticGlass()}>
                      Glass
                    </button>
                    <button type="button" className="audition-btn" onClick={() => playHapticSwoosh()}>
                      Swoosh
                    </button>
                  </div>
                </Row>
                <Row label="Download finished chime" desc="Play a chime when a download completes">
                  <Toggle
                    label="Download finished chime"
                    checked={settings.completionSound}
                    onChange={(next) => saveSettings({ completionSound: next })}
                  />
                </Row>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
