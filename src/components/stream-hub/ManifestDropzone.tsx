import React, { useRef, useState } from 'react'
import { IconUploadCloud, IconFileCode } from './Icons'
import { playHapticClick } from '@/lib/sound'
import { extractLinks } from './capture-options'

interface LinkDropzoneProps {
  /** Receives the unique links found in the dropped text or files. */
  onLinks: (urls: string[]) => void
  onNoLinks: () => void
  disabled?: boolean
}

async function readDropped(data: DataTransfer | FileList): Promise<string> {
  const parts: string[] = []
  const files = data instanceof FileList ? data : data.files
  for (const file of Array.from(files)) {
    // Only small text files: link lists, not media.
    if (file.size <= 2 * 1024 * 1024) parts.push(await file.text())
  }
  if (!(data instanceof FileList)) {
    parts.push(data.getData('text/uri-list'), data.getData('text/plain'))
  }
  return parts.join('\n')
}

/** Batch import: drop a .txt list of links, or drag links from a browser. */
export const ManifestDropzone: React.FC<LinkDropzoneProps> = ({ onLinks, onNoLinks, disabled }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handle = async (source: DataTransfer | FileList) => {
    const links = extractLinks(await readDropped(source))
    if (links.length > 0) onLinks(links)
    else onNoLinks()
  }

  return (
    <div
      className={`manifest-dropzone ${isDragOver ? 'drag-active' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragOver(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setIsDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        if (!disabled) void handle(e.dataTransfer)
      }}
      onClick={() => {
        if (disabled) return
        playHapticClick()
        fileInputRef.current?.click()
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          fileInputRef.current?.click()
        }
      }}
      tabIndex={0}
      role="button"
      aria-disabled={disabled}
      aria-label="Add many links at once: drop a text file with links, or press Enter to choose one"
      title="Drop a .txt file with one link per line, or drag links here"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.csv,.url,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void handle(e.target.files)
          e.target.value = ''
        }}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="dropzone-icon-circle" aria-hidden="true">
        {isDragOver ? <IconFileCode size={20} /> : <IconUploadCloud size={20} />}
      </div>
      <div className="dropzone-text-primary">{isDragOver ? 'Drop to add links' : 'Add many links'}</div>
      <div className="dropzone-text-secondary">
        <span>Drop a .txt list or drag links here</span>
      </div>
    </div>
  )
}
