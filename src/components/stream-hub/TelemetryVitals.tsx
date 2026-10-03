import React from 'react'
import { IconActivity, IconLayers, IconHardDrive, IconCpu } from './Icons'
import { formatSpeed } from '@/lib/format'

export interface TelemetryVitalsProps {
  /** Combined download speed in bytes per second. */
  speedBytesPerSec: number
  activeCount: number
  queuedCount: number
  storageFreeGb?: number
  storagePercentage?: number
  /** e.g. "Ready", "Setting up", "Not installed". */
  engineLabel: string
  engineDetail?: string
}

export const TelemetryVitals: React.FC<TelemetryVitalsProps> = React.memo(
  ({ speedBytesPerSec, activeCount, queuedCount, storageFreeGb, storagePercentage, engineLabel, engineDetail }) => {
    const speed = formatSpeed(speedBytesPerSec)
    const [speedNum, speedUnit] = speed ? speed.split(' ') : ['0', 'MB/s']

    return (
      <div className="telemetry-ribbon" role="region" aria-label="Download status">
        <div className="telemetry-segment stat-throughput">
          <div className="telemetry-seg-icon">
            <IconActivity size={14} />
          </div>
          <div className="telemetry-seg-content">
            <div className="telemetry-seg-label">Speed</div>
            <div className="telemetry-seg-value">
              {speedBytesPerSec > 0 && (
                <span
                  className="telemetry-pulse-dot"
                  style={{ background: '#10b981', boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.25)' }}
                  aria-hidden="true"
                />
              )}
              <span className="telemetry-num">{speedNum}</span>
              <span className="telemetry-unit">{speedUnit}</span>
            </div>
          </div>
        </div>

        <div className="telemetry-divider" />

        <div className="telemetry-segment stat-transfers">
          <div className="telemetry-seg-icon">
            <IconLayers size={14} />
          </div>
          <div className="telemetry-seg-content">
            <div className="telemetry-seg-label">Downloading</div>
            <div className="telemetry-seg-value">
              <span className="telemetry-num">{activeCount}</span>
              <span className="telemetry-sub">active</span>
              {queuedCount > 0 && <span className="telemetry-meta-muted">({queuedCount} waiting)</span>}
            </div>
          </div>
        </div>

        <div className="telemetry-divider" />

        <div className="telemetry-segment stat-storage">
          <div className="telemetry-seg-icon">
            <IconHardDrive size={14} />
          </div>
          <div className="telemetry-seg-content">
            <div className="telemetry-seg-label">Free space</div>
            <div className="telemetry-seg-value">
              {storageFreeGb && storageFreeGb > 0 ? (
                <>
                  <span className="telemetry-num">{storageFreeGb.toFixed(1)}</span>
                  <span className="telemetry-unit">GB</span>
                  {!!storagePercentage && <span className="telemetry-meta-muted">{storagePercentage}% free</span>}
                </>
              ) : (
                <span className="telemetry-meta-muted">—</span>
              )}
            </div>
          </div>
        </div>

        <div className="telemetry-divider" />

        <div className="telemetry-segment stat-engine">
          <div className="telemetry-seg-icon">
            <IconCpu size={14} />
          </div>
          <div className="telemetry-seg-content">
            <div className="telemetry-seg-label">Engine</div>
            <div className="telemetry-seg-value" title={engineDetail}>
              <span className="telemetry-status-pill">{engineLabel}</span>
            </div>
          </div>
        </div>
      </div>
    )
  },
)
