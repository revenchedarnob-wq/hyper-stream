import { useEffect, useState } from 'react'
import { playHapticClick } from '@/lib/sound'

export interface ZoomHudProps {
  zoom: number
  visible: boolean
  onReset: () => void
}

export function ZoomHud({ zoom, visible, onReset }: ZoomHudProps) {
  const [fading, setFading] = useState(!visible)

  useEffect(() => {
    if (visible) {
      setFading(false)
    } else {
      const timer = setTimeout(() => setFading(true), 300)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!visible && fading) return null

  const pct = Math.round(zoom * 100)
  const isDefault = pct === 100

  return (
    <div
      className={`browser-zoom-hud ${visible ? 'is-visible' : 'is-fading'}`}
      role="status"
      aria-live="polite"
      data-testid="browser-zoom-hud"
    >
      <span className="browser-zoom-hud-value">{pct}%</span>
      {!isDefault && (
        <button
          type="button"
          className="browser-zoom-hud-reset"
          onClick={() => {
            playHapticClick()
            onReset()
          }}
          title="Reset zoom to 100% (Ctrl+0)"
          data-testid="browser-zoom-reset"
        >
          Reset
        </button>
      )}
    </div>
  )
}
