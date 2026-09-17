import React from 'react'
import { IconHardDrive, IconFolder } from '../stream-hub/Icons'

interface LibraryStorageGaugeProps {
  totalCount: number
  onOpenFolder?: () => void
}

export const LibraryStorageGauge: React.FC<LibraryStorageGaugeProps> = React.memo(({
  totalCount,
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
          <span>37.4 GB used</span>
          <span className="meta-dot">·</span>
          <span>1.85 TB free (E:)</span>
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
