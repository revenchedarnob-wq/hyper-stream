import React, { useId } from 'react'
import './water-chamber.css'

export interface WaterChamberProps {
  variant?: 'omni' | 'telem' | 'pipeline' | 'recent' | 'dropzone'
  heightPercent?: number
}

export const WaterChamber: React.FC<WaterChamberProps> = React.memo(({
  variant = 'pipeline',
  heightPercent,
}) => {
  const uniqueId = useId().replace(/:/g, '')

  // Default wave heights per card profile
  const defaultHeight = {
    omni: 52,
    telem: 58,
    pipeline: 66,
    recent: 60,
    dropzone: 72,
  }[variant]

  const height = heightPercent ?? defaultHeight

  const gradId = `wGrad_${uniqueId}`
  const highId = `wHigh_${uniqueId}`

  return (
    <div className={`liquid-water-chamber chamber-${variant}`} aria-hidden="true">
      <div className="water-ambient-caustics" />
      <svg
        className={`liquid-wave-svg wave-${variant}`}
        style={{ height: `${height}%` }}
        viewBox="0 0 1600 240"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--water-wave-top)" />
            <stop offset="35%" stopColor="var(--water-wave-mid)" />
            <stop offset="100%" stopColor="var(--water-wave-bottom)" />
          </linearGradient>
          <linearGradient id={highId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.25)" />
            <stop offset="25%" stopColor="rgba(255, 255, 255, 0.95)" />
            <stop offset="50%" stopColor="rgba(186, 230, 253, 0.98)" />
            <stop offset="75%" stopColor="rgba(255, 255, 255, 0.95)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0.25)" />
          </linearGradient>
        </defs>

        {/* Deeper back undulating wave */}
        <path
          className="wave-layer-back"
          d="M0,70 Q200,110 400,70 T800,70 T1200,70 T1600,70 L1600,240 L0,240 Z"
        />

        {/* Foreground luminous surface tension meniscus */}
        <path
          className="wave-layer-front"
          d="M0,55 Q200,20 400,55 T800,55 T1200,55 T1600,55 L1600,240 L0,240 Z"
          fill={`url(#${gradId})`}
          stroke={`url(#${highId})`}
          strokeWidth="1.8"
        />
      </svg>
      <div className="water-bottom-caustic-pool" />
      <div className="water-floating-bubble b1" />
      <div className="water-floating-bubble b2" />
    </div>
  )
})
