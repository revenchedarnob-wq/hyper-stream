import { useEffect, useRef, useState } from 'react'
import { IconShieldCheck, IconX } from './Icons'
import { browserShieldsStats, getInstalledExtensions } from '@/lib/tauri-bridge'
import { playHapticClick, playHapticGlass } from '@/lib/sound'
import { isAdBlocker } from './ad-blockers'
import './browser.css'

/** Content blockers that stop ad requests before Shields sees them. */
export interface ShieldsPopoverProps {
  /** Shields on for all sites. */
  enabled: boolean
  /** Current site (host without "www."); empty on the start page. */
  site?: string
  /** Shields apply to the current site. */
  siteEnabled?: boolean
  onToggleShields: () => void
  onToggleSite?: () => void
  onClose: () => void
}

function Switch({ checked, label, disabled, onToggle }: { checked: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`shields-toggle-btn ${checked ? 'is-active' : ''}`}
      onClick={() => {
        playHapticGlass()
        onToggle()
      }}
    >
      <span className="shields-toggle-knob" />
    </button>
  )
}

export function ShieldsPopover({ enabled, site = '', siteEnabled = enabled, onToggleShields, onToggleSite, onClose }: ShieldsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [blocked, setBlocked] = useState<number | null>(null)
  const [otherBlocker, setOtherBlocker] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    function handleMouseDown(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  // Live count while the popover is open (pages keep loading ads after they finish).
  useEffect(() => {
    if (!site) return
    let cancelled = false
    const refresh = () =>
      void browserShieldsStats().then((count) => {
        if (!cancelled) setBlocked(count)
      })
    refresh()
    const timer = window.setInterval(refresh, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [site])

  useEffect(() => {
    let cancelled = false
    void getInstalledExtensions()
      .then((list) => {
        const blocker = list.find((ext) => ext.enabled && isAdBlocker(ext))
        if (!cancelled) setOtherBlocker(blocker?.name ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const close = () => {
    playHapticClick()
    onClose()
  }

  const on = site ? siteEnabled : enabled

  return (
    <>
      <div className="brave-shields-backdrop" onClick={close} aria-hidden="true" data-testid="shields-backdrop" />
      <div ref={popoverRef} className="brave-shields-popover" role="dialog" aria-label="Shields">
        <header className="shields-popover-header">
          <div className="shields-header-brand">
            <div className={`shields-lion-badge ${on ? 'is-enabled' : 'is-disabled'}`}>
              <IconShieldCheck size={20} />
            </div>
            <div className="shields-header-titles">
              <h3 className="shields-popover-title">Shields</h3>
              <div className={`shields-status-subtitle ${on ? 'is-up' : 'is-down'}`}>
                <span className="shields-status-dot" />
                <span>{on ? 'On' : 'Off'}{site ? ` · ${site}` : ''}</span>
              </div>
            </div>
          </div>
          <button type="button" className="shields-close-btn" onClick={close} aria-label="Close Shields">
            <IconX size={14} />
          </button>
        </header>

        {site && (
          <div className="shields-master-row">
            <div className="shields-master-info">
              <div className="shields-master-header">
                <span className="shields-master-label">Block on this site</span>
                {siteEnabled && blocked !== null && (
                  <span className={`shields-blocked-badge ${blocked === 0 ? 'is-zero' : ''}`}>
                    {blocked} blocked
                  </span>
                )}
              </div>
              <span className="shields-master-desc">
                {!enabled
                  ? 'Shields are off for all sites.'
                  : siteEnabled
                    ? blocked === null
                      ? 'Turn off if this site stops working.'
                      : `${blocked} ${blocked === 1 ? 'request' : 'requests'} blocked on this page${
                          otherBlocker ? `, plus whatever ${otherBlocker} caught first` : ''
                        }. Turn off if the site stops working.`
                    : 'Ads and trackers are allowed on this site.'}
              </span>
            </div>
            <Switch
              checked={enabled && siteEnabled}
              disabled={!enabled}
              label={`Block ads and trackers on ${site}`}
              onToggle={() => onToggleSite?.()}
            />
          </div>
        )}

        <div className="shields-master-row">
          <div className="shields-master-info">
            <span className="shields-master-label">Block ads and trackers</span>
            <span className="shields-master-desc">Blocks known ad and tracking servers on every site.</span>
          </div>
          <Switch checked={enabled} label="Block ads and trackers" onToggle={onToggleShields} />
        </div>
      </div>
    </>
  )
}
