import React from 'react'
import { IconActivity, IconLayers, IconHardDrive, IconCpu } from './Icons'



export interface TelemetryVitalsProps {
  throughput?: number
  activeCount?: number
  queuedCount?: number
  storageFreeGb?: number
  storageFreeTb?: number
  storagePercentage?: number
  engineStatus?: string
}

export const TelemetryVitals: React.FC<TelemetryVitalsProps> = React.memo(({
  throughput = 0,
  activeCount = 0,
  queuedCount = 0,
  storageFreeGb,
  storageFreeTb,
  storagePercentage = 0,
  engineStatus = 'Hardware Acceleration',
}) => {
  const freeGb = typeof storageFreeGb === 'number'
    ? storageFreeGb
    : (typeof storageFreeTb === 'number' ? storageFreeTb * 1024 : 0)

  return (
    <div className="telemetry-ribbon" role="region" aria-label="System ingestion vitals">
      {/* 1. Live Throughput */}
      <div className="telemetry-segment stat-throughput">
        <div className="telemetry-seg-icon">
          <IconActivity size={14} />
        </div>
        <div className="telemetry-seg-content">
          <div className="telemetry-seg-label">Throughput</div>
          <div className="telemetry-seg-value">
            <span
              className="telemetry-pulse-dot"
              style={{
                background: throughput > 0 ? '#10b981' : 'rgba(255, 255, 255, 0.35)',
                boxShadow: throughput > 0 ? '0 0 0 2px rgba(16, 185, 129, 0.25)' : 'none',
              }}
              aria-hidden="true"
            />
            <span className="telemetry-num">{throughput.toFixed(1)}</span>
            <span className="telemetry-unit">MB/s</span>
          </div>
        </div>
      </div>

      <div className="telemetry-divider" />

      {/* 2. Active Transfers */}
      <div className="telemetry-segment stat-transfers">
        <div className="telemetry-seg-icon">
          <IconLayers size={14} />
        </div>
        <div className="telemetry-seg-content">
          <div className="telemetry-seg-label">Active Transfers</div>
          <div className="telemetry-seg-value">
            <span className="telemetry-num">{activeCount}</span>
            <span className="telemetry-sub">active</span>
            {queuedCount > 0 && <span className="telemetry-meta-muted">({queuedCount} queued)</span>}
          </div>
        </div>
      </div>

      <div className="telemetry-divider" />

      {/* 3. Storage Availability */}
      <div className="telemetry-segment stat-storage">
        <div className="telemetry-seg-icon">
          <IconHardDrive size={14} />
        </div>
        <div className="telemetry-seg-content">
          <div className="telemetry-seg-label">Storage Cache</div>
          <div className="telemetry-seg-value">
            <span className="telemetry-num">{freeGb > 0 ? freeGb.toFixed(1) : '0.0'}</span>
            <span className="telemetry-unit">GB</span>
            <span className="telemetry-meta-muted">{storagePercentage > 0 ? `${storagePercentage}% free` : 'Ready'}</span>
          </div>
        </div>
      </div>

      <div className="telemetry-divider" />

      {/* 4. Engine Status */}
      <div className="telemetry-segment stat-engine">
        <div className="telemetry-seg-icon">
          <IconCpu size={14} />
        </div>
        <div className="telemetry-seg-content">
          <div className="telemetry-seg-label">Pipeline Engine</div>
          <div className="telemetry-seg-value">
            <span className="telemetry-status-pill">{engineStatus}</span>
          </div>
        </div>
      </div>
    </div>
  )
})
