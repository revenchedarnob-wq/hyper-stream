import React, { useState, useRef } from 'react'
import { IconUploadCloud, IconFileCode } from './Icons'
import { playHapticClick } from '@/lib/sound'

interface ManifestDropzoneProps {
  onFilesDropped: (files: FileList) => void
}

export const ManifestDropzone: React.FC<ManifestDropzoneProps> = ({ onFilesDropped }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped(e.dataTransfer.files)
    }
  }

  const handleClick = () => {
    playHapticClick()
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesDropped(e.target.files)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      className={`manifest-dropzone ${isDragOver ? 'drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label="Drop stream manifest files here or press Enter to browse files"
      title="Click or drop stream files here (.m3u8, .mpd, playlists)"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".m3u8,.mpd,.txt,.json,.mkv,.mp4"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="dropzone-icon-circle" aria-hidden="true">
        {isDragOver ? <IconFileCode size={20} /> : <IconUploadCloud size={20} />}
      </div>

      <div className="dropzone-text-primary">
        {isDragOver ? 'Drop files to ingest' : 'Drop stream files'}
      </div>

      <div className="dropzone-text-secondary">
        <span className="dropzone-ext-pill">.m3u8</span>
        <span className="dropzone-ext-dot">·</span>
        <span className="dropzone-ext-pill">.mpd</span>
        <span className="dropzone-ext-dot">·</span>
        <span>playlist URLs</span>
      </div>
    </div>
  )
}
