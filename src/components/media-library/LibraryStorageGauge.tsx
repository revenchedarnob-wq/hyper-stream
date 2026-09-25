import React from 'react'
import { IconHardDrive, IconFolder } from '../stream-hub/Icons'

interface LibraryStorageGaugeProps {
  totalCount: number
  storageFreeGb?: number
  usedGb?: number
  onOpenFolder?: () => void
}

export const LibraryStorageGauge: React.FC<LibraryStorageGaugeProps> = React.memo(({
  totalCount,
  storageFreeGb,
  usedGb,
  onOpenFolder,
}) => {
  return (
    <div className="storage-gauge-card">
      <div className="storage-gauge-left">
        <div className="storage-gauge-icon">
          <IconHardDrive size={14} />
        </div>
        <div className="storage-gauge-label-group">
          <span className="storage-gauge-title">NVMe Storage</span>
          <span className="storage-gauge-badge">{totalCount} files</span>
        </div>
      </div>

      <div className="storage-gauge-center">
        <div className="storage-gauge-track-wrapper">
          <div className="storage-gauge-track">
            <div className="storage-seg-single" style={{ width: '18%' }} />
          </div>
        </div>
        <div className="storage-gauge-sub">
          <span>{typeof usedGb === 'number' ? `${usedGb.toFixed(1)} GB used` : 'Library Ready'}</span>
          <span className="meta-dot">·</span>
          <span>{typeof storageFreeGb === 'number' && storageFreeGb > 0 ? `${storageFreeGb.toFixed(1)} GB free` : 'Storage Ready'}</span>
        </div>
      </div>

      <div className="storage-gauge-right">
        <button
          type="button"
          className="storage-folder-btn"
          onClick={onOpenFolder}
          title="Reveal Storage Folder in Explorer"
        >
          <IconFolder size={13} />
          <span>Open Folder</span>
        </button>
      </div>
    </div>
  )
})
