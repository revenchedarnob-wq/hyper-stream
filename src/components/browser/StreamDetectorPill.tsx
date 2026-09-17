import type { DetectedStream } from './types'
import { IconBolt, IconScissors, IconDownloadCloud, IconX } from './Icons'
import { formatDetectedStreamBadge } from './url-utils'
import { playHapticClick } from '@/lib/sound'
import './browser.css'

export interface StreamDetectorPillProps {
  stream: DetectedStream | null
  onOpenInHub: (url: string) => void
  onOpenInStudio: (url: string) => void
  onDismiss?: () => void
}

export function StreamDetectorPill({
  stream,
  onOpenInHub,
  onOpenInStudio,
  onDismiss
}: StreamDetectorPillProps) {
  if (!stream) {
    return null
  }

  const badgeText = formatDetectedStreamBadge(stream)

  const handleOpenInHub = () => {
    playHapticClick()
    onOpenInHub(stream.url)
  }

  const handleOpenInStudio = () => {
    playHapticClick()
    onOpenInStudio(stream.url)
  }

  const handleDismiss = () => {
    playHapticClick()
    onDismiss?.()
  }

  return (
    <div className="stream-detector-pill" role="status" aria-live="polite">
      <div className="stream-pulse-container" aria-hidden="true">
        <div className="stream-pulse-ring" />
        <div className="stream-pulse-dot" />
      </div>

      <div className="stream-bolt-icon" aria-hidden="true">
        <IconBolt size={14} />
      </div>

      <span className="stream-format-badge">{badgeText}</span>

      <button
        type="button"
        className="stream-action-chip primary"
        onClick={handleOpenInHub}
        title="Send stream to Ingestion Hub"
      >
        <IconDownloadCloud size={12} />
        <span>Send to Hub</span>
      </button>

      <button
        type="button"
        className="stream-action-chip studio"
        onClick={handleOpenInStudio}
        title="Open stream in Studio Editor"
      >
        <IconScissors size={12} />
        <span>Studio</span>
      </button>

      {onDismiss && (
        <button
          type="button"
          className="stream-dismiss-btn"
          onClick={handleDismiss}
          aria-label="Dismiss stream detector notification"
        >
          <IconX size={12} />
        </button>
      )}
    </div>
  )
}
