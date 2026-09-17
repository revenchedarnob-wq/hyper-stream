import React from 'react'
import './settings.css'
import {
  playHapticClick,
  playHapticGlass,
  playHapticPop,
  playHapticSwoosh,
} from '@/lib/sound'
import { pickStorageFolder } from '@/lib/tauri-bridge'
import { detectHardwareProfile, formatGpuName } from '@/lib/hardware-profiler'
import {
  IconZap,
  IconSparkles,
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconCpu,
} from '../stream-hub/Icons'

interface SettingsProps {
  isPotatoMode: boolean
  onTogglePotatoMode: () => void
  isBloomEnabled: boolean
  onToggleBloom: () => void
  audioMuted: boolean
  onToggleAudio: () => void
  currentWallpaper?: string
  onSelectWallpaper?: (url: string) => void
  wallpapers?: Array<{ id: string; name: string; url: string; theme?: 'light' | 'dark' }>
  isNative?: boolean
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
}: SettingsProps) {
  const [downloadDir, setDownloadDir] = React.useState<string>(() => {
    return localStorage.getItem('hyperstream_download_dir') || 'C:\\Users\\User\\Downloads\\HyperStream'
  })
  const [autoFallback, setAutoFallback] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_auto_fallback')
    return val !== null ? val === 'true' : true
  })
  const [clipboardAutoDetect, setClipboardAutoDetect] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_clipboard_detect')
    return val !== null ? val === 'true' : true
  })
  const [discordWebhook, setDiscordWebhook] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_discord_webhook')
    return val !== null ? val === 'true' : true
  })
  const [plexAutoScan, setPlexAutoScan] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_plex_scan')
    return val !== null ? val === 'true' : true
  })
  const [aria2MultiSocket, setAria2MultiSocket] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_aria2_socket')
    return val !== null ? val === 'true' : true
  })
  const [interactionCues, setInteractionCues] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_interaction_cues')
    return val !== null ? val === 'true' : true
  })
  const [trayBackground, setTrayBackground] = React.useState(() => {
    const val = localStorage.getItem('hyperstream_tray_background')
    return val !== null ? val === 'true' : true
  })
  const [showAdvancedSpecs, setShowAdvancedSpecs] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'appearance' | 'audio' | 'engine' | 'automations'>('appearance')
  const hardwareProfile = React.useMemo(() => detectHardwareProfile(), [])

  const handlePickDirectory = async () => {
    playHapticClick()
    const chosen = await pickStorageFolder()
    if (chosen) {
      setDownloadDir(chosen)
      localStorage.setItem('hyperstream_download_dir', chosen)
      playHapticGlass()
    }
  }

  return (
    <div className="settings-view">
      {/* Sleek Minimal Header */}
      <header className="settings-header">
        <div className="settings-title-row">
          <h1 className="settings-title">Settings</h1>
        </div>

        {/* Crisp Segmented Tabs */}
        <div className="settings-nav-bar" role="tablist" aria-label="Settings Categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'appearance'}
            id="tab-appearance"
            aria-controls="panel-appearance"
            className={`settings-nav-tab ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => {
              playHapticClick()
              setActiveTab('appearance')
            }}
          >
            <span>Appearance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audio'}
            id="tab-audio"
            aria-controls="panel-audio"
            className={`settings-nav-tab ${activeTab === 'audio' ? 'active' : ''}`}
            onClick={() => {
              playHapticClick()
              setActiveTab('audio')
            }}
          >
            <span>Sound</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'engine'}
            id="tab-engine"
            aria-controls="panel-engine"
            className={`settings-nav-tab ${activeTab === 'engine' ? 'active' : ''}`}
            onClick={() => {
              playHapticClick()
              setActiveTab('engine')
            }}
          >
            <span>Engine & Storage</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'automations'}
            id="tab-automations"
            aria-controls="panel-automations"
            className={`settings-nav-tab ${activeTab === 'automations' ? 'active' : ''}`}
            onClick={() => {
              playHapticClick()
              setActiveTab('automations')
            }}
          >
            <span>Automations</span>
          </button>
        </div>
      </header>

      {/* Main Settings Scroll Body */}
      <div className="settings-content-scroll">
        {/* APPEARANCE TAB */}
        {activeTab === 'appearance' && (
          <div className="settings-tab-panel" id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance">
            {/* Rendering Profile */}
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Rendering Profile</h2>
                <span className="profile-hardware-chip" title={hardwareProfile.gpuRenderer}>
                  <IconCpu size={12} className="hardware-chip-icon" />
                  <span>{formatGpuName(hardwareProfile.gpuRenderer)} · {hardwareProfile.logicalCores} Cores</span>
                </span>
              </div>

              <div className="rendering-profile-grid" role="radiogroup" aria-label="Rendering Profile Options">
                {/* Efficiency Mode Card */}
                <div
                  role="radio"
                  aria-checked={isPotatoMode}
                  tabIndex={0}
                  className={`profile-card profile-card-potato ${isPotatoMode ? 'selected' : ''}`}
                  onClick={() => {
                    if (!isPotatoMode) {
                      playHapticPop()
                      onTogglePotatoMode()
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (!isPotatoMode) {
                        playHapticPop()
                        onTogglePotatoMode()
                      }
                    }
                  }}
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
                      <div className="profile-subtitle">Minimal GPU · Pre-baked effects</div>
                    </div>
                  </div>
                  <span className="profile-radio-dot">
                    {isPotatoMode && <IconCheck size={11} />}
                  </span>
                </div>

                {/* Studio Glass Card */}
                <div
                  role="radio"
                  aria-checked={!isPotatoMode}
                  tabIndex={0}
                  className={`profile-card profile-card-studio ${!isPotatoMode ? 'selected' : ''}`}
                  onClick={() => {
                    if (isPotatoMode) {
                      playHapticGlass()
                      onTogglePotatoMode()
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (isPotatoMode) {
                        playHapticGlass()
                        onTogglePotatoMode()
                      }
                    }
                  }}
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
                      <div className="profile-subtitle">Live refraction · Full fidelity</div>
                    </div>
                  </div>
                  <span className="profile-radio-dot">
                    {!isPotatoMode && <IconCheck size={11} />}
                  </span>
                </div>
              </div>

              {/* Collapsible Technical Details */}
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
                  <span>Technical specifications</span>
                  <IconChevronDown
                    size={12}
                    className={`specs-chevron ${showAdvancedSpecs ? 'open' : ''}`}
                  />
                </button>

                {showAdvancedSpecs && (
                  <div className="advanced-specs-body">
                    <div className="spec-item">
                      <span className="spec-label">Substrate</span>
                      <span className="spec-val">
                        {isPotatoMode ? 'Pre-baked 2K Bokeh' : 'Direct DWM Acrylic'}
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Blur Passes</span>
                      <span className="spec-val">
                        {isPotatoMode ? '0 passes (static)' : 'Specular & diffusion'}
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Target Hardware</span>
                      <span className="spec-val">
                        {isPotatoMode ? 'Integrated / Battery' : 'Discrete GPU'}
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Detected GPU</span>
                      <span className="spec-val" title={hardwareProfile.gpuRenderer}>
                        {formatGpuName(hardwareProfile.gpuRenderer)}
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">CPU Concurrency</span>
                      <span className="spec-val">
                        {hardwareProfile.logicalCores} Logical Cores
                      </span>
                    </div>
                    <div className="spec-item">
                      <span className="spec-label">Auto Recommendation</span>
                      <span className="spec-val">
                        {hardwareProfile.recommendedRenderingProfile === 'potato' ? 'Efficiency Mode' : 'Studio Glass'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Display Effects */}
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Display Effects</h2>
              </div>

              <div className="settings-card-group">
                {/* Performance Fallback */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Automatic Performance Fallback</div>
                    <div className="settings-row-desc">
                      Dynamically reduces glass blur during heavy CPU or GPU loads
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoFallback}
                      aria-label="Automatic Performance Fallback"
                      className={`tactile-toggle ${autoFallback ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !autoFallback
                        setAutoFallback(next)
                        try {
                          localStorage.setItem('hyperstream_auto_fallback', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>

                {/* Specular Bloom */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Ambient Specular Bloom</div>
                    <div className="settings-row-desc">
                      Subtle edge lighting and optical glow on active panels
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isBloomEnabled}
                      aria-label="Ambient Specular Bloom"
                      className={`tactile-toggle ${isBloomEnabled ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        onToggleBloom()
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Wallpaper Canvas */}
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Wallpaper Environment</h2>
              </div>

              {wallpapers && onSelectWallpaper ? (
                <div className="wallpaper-gallery-grid" role="radiogroup" aria-label="Desktop Wallpapers">


                  {wallpapers.map((wp) => {
                    const isSelected = currentWallpaper === wp.url

                    return (
                      <div
                        key={wp.id}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        className={`wallpaper-card ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          playHapticGlass()
                          onSelectWallpaper(wp.url)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            playHapticGlass()
                            onSelectWallpaper(wp.url)
                          }
                        }}
                      >
                        <div
                          className="wallpaper-thumb"
                          style={{ backgroundImage: `url("${wp.url}")` }}
                        >
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
                </div>
              ) : null}
            </section>
          </div>
        )}

        {/* SOUND TAB */}
        {activeTab === 'audio' && (
          <div className="settings-tab-panel" id="panel-audio" role="tabpanel" aria-labelledby="tab-audio">
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Sound & Haptics</h2>
              </div>

              <div className="settings-card-group">
                {/* Master Audio */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Interface Sound Effects</div>
                    <div className="settings-row-desc">
                      Acoustic clicks, pops, and glass feedback for controls
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!audioMuted}
                      aria-label="Interface Sound Effects"
                      className={`tactile-toggle ${!audioMuted ? 'is-on' : ''}`}
                      onClick={() => {
                        onToggleAudio()
                        if (audioMuted) {
                          playHapticGlass()
                        }
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>

                {/* Sound Test Bench */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Audition Tones</div>
                    <div className="settings-row-desc">
                      Preview procedural interaction sound frequencies
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <div className="haptic-audition-group">
                      <button
                        type="button"
                        className="audition-btn"
                        onClick={() => playHapticClick()}
                      >
                        Click
                      </button>
                      <button
                        type="button"
                        className="audition-btn"
                        onClick={() => playHapticPop()}
                      >
                        Pop
                      </button>
                      <button
                        type="button"
                        className="audition-btn"
                        onClick={() => playHapticGlass()}
                      >
                        Glass
                      </button>
                      <button
                        type="button"
                        className="audition-btn"
                        onClick={() => playHapticSwoosh()}
                      >
                        Swoosh
                      </button>
                    </div>
                  </div>
                </div>

                {/* Operational Cues */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Completion Chimes</div>
                    <div className="settings-row-desc">
                      Play acoustic notifications when media transfers finish
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={interactionCues}
                      aria-label="Completion Chimes"
                      className={`tactile-toggle ${interactionCues ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !interactionCues
                        setInteractionCues(next)
                        try {
                          localStorage.setItem('hyperstream_interaction_cues', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ENGINE & STORAGE TAB */}
        {activeTab === 'engine' && (
          <div className="settings-tab-panel" id="panel-engine" role="tabpanel" aria-labelledby="tab-engine">
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Storage Destination</h2>
              </div>

              <div className="settings-card-group">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Download Folder</div>
                    <div className="settings-path-box" title={downloadDir}>
                      <IconFolder size={13} className="path-icon" />
                      <span className="path-text">{downloadDir}</span>
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      className="action-btn"
                      onClick={handlePickDirectory}
                    >
                      Browse
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Ingestion Engine</h2>
              </div>

              <div className="settings-card-group">
                {/* Hardware Acceleration */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Hardware Acceleration</div>
                    <div className="settings-row-desc">
                      Direct3D 12 and NVIDIA NVENC Turbo video muxing
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <span className="settings-badge engine-badge">Active</span>
                  </div>
                </div>

                {/* Clipboard Stream Detection */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Clipboard Detection</div>
                    <div className="settings-row-desc">
                      Automatically detect video links copied to clipboard
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={clipboardAutoDetect}
                      aria-label="Clipboard Detection"
                      className={`tactile-toggle ${clipboardAutoDetect ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !clipboardAutoDetect
                        setClipboardAutoDetect(next)
                        try {
                          localStorage.setItem('hyperstream_clipboard_detect', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>

                {/* Multi-Socket Engine */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Multi-Socket Acceleration</div>
                    <div className="settings-row-desc">
                      16 parallel connections per stream via Aria2 engine
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aria2MultiSocket}
                      aria-label="Multi-Socket Acceleration"
                      className={`tactile-toggle ${aria2MultiSocket ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !aria2MultiSocket
                        setAria2MultiSocket(next)
                        try {
                          localStorage.setItem('hyperstream_aria2_socket', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* AUTOMATIONS TAB */}
        {activeTab === 'automations' && (
          <div className="settings-tab-panel" id="panel-automations" role="tabpanel" aria-labelledby="tab-automations">
            <section className="settings-section">
              <div className="settings-section-header">
                <h2 className="settings-section-title">Automations & Background</h2>
              </div>

              <div className="settings-card-group">
                {/* Discord Webhook */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Discord Notifications</div>
                    <div className="settings-row-desc">
                      Send embed alerts with capture details upon completion
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={discordWebhook}
                      aria-label="Discord Notifications"
                      className={`tactile-toggle ${discordWebhook ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !discordWebhook
                        setDiscordWebhook(next)
                        try {
                          localStorage.setItem('hyperstream_discord_webhook', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>

                {/* Plex Auto-Scan */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Plex & Jellyfin Auto-Scan</div>
                    <div className="settings-row-desc">
                      Refresh connected media libraries when files are finalized
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plexAutoScan}
                      aria-label="Plex & Jellyfin Auto-Scan"
                      className={`tactile-toggle ${plexAutoScan ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !plexAutoScan
                        setPlexAutoScan(next)
                        try {
                          localStorage.setItem('hyperstream_plex_scan', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>

                {/* System Tray */}
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">System Tray Ingestion</div>
                    <div className="settings-row-desc">
                      Keep transfers active in background when window is closed
                    </div>
                  </div>
                  <div className="settings-row-action">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={trayBackground}
                      aria-label="System Tray Ingestion"
                      className={`tactile-toggle ${trayBackground ? 'is-on' : ''}`}
                      onClick={() => {
                        playHapticClick()
                        const next = !trayBackground
                        setTrayBackground(next)
                        try {
                          localStorage.setItem('hyperstream_tray_background', String(next))
                        } catch {}
                      }}
                    >
                      <span className="tactile-toggle-thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings