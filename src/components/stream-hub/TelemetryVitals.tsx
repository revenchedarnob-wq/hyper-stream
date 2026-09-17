import React from 'react'
import { IconActivity, IconLayers, IconHardDrive, IconCpu } from './Icons'

interface TelemetryVitalsProps {
  throughput?: number
  activeCount?: number
  queuedCount?: number
  storageFreeGb?: number
  totalStorageGb?: number
}

export const TelemetryVitals: React.FC<TelemetryVitalsProps> = React.memo(({
  throughput = 42.8,
  activeCount = 2,
  queuedCount = 1,
  storageFreeGb = 1420,
  totalStorageGb = 2000,
}) => {
  const storagePercentage = Math.round((storageFreeGb / totalStorageGb) * 100)

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
            <span className="telemetry-pulse-dot" aria-hidden="true" />
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
          <div className="telemetry-seg-label">NVMe Cache</div>
          <div className="telemetry-seg-value">
            <span className="telemetry-num">{(storageFreeGb / 1000).toFixed(2)}</span>
            <span className="telemetry-unit">TB</span>
            <span className="telemetry-meta-muted">{storagePercentage}% free</span>
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
            <span className="telemetry-status-pill">NVENC Turbo</span>
          </div>
        </div>
      </div>
    </div>
  )
})
