import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { IconSearch, IconX, IconArrowLeft, IconArrowRight } from './Icons'
import { playHapticClick } from '@/lib/sound'

export interface FindInPageBarProps {
  isOpen: boolean
  onClose: () => void
  onFind: (query: string, backwards?: boolean) => void
  matchCount?: number
  currentMatch?: number
}

export function FindInPageBar({
  isOpen,
  onClose,
  onFind,
  matchCount = 0,
  currentMatch = 0,
}: FindInPageBarProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      setQuery('')
    }
  }, [isOpen])

  const handleNext = () => {
    if (!query) return
    playHapticClick()
    onFind(query, false)
  }

  const handlePrev = () => {
    if (!query) return
    playHapticClick()
    onFind(query, true)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) handlePrev()
      else handleNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const handleChange = (val: string) => {
    setQuery(val)
    if (val) {
      onFind(val, false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="find-in-page-bar" role="search" aria-label="Find in page" data-testid="find-in-page-bar">
      <div className="find-in-page-icon" aria-hidden="true">
        <IconSearch size={14} />
      </div>

      <input
        ref={inputRef}
        type="text"
        className="find-in-page-input"
        placeholder="Find in page..."
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Search text in page"
        data-testid="find-in-page-input"
      />

      {query && (
        <span className="find-in-page-count" data-testid="find-in-page-count">
          {matchCount > 0 ? `${currentMatch || 1}/${matchCount}` : 'No matches'}
        </span>
      )}

      <div className="find-in-page-actions">
        <button
          type="button"
          className="find-in-page-btn"
          onClick={handlePrev}
          disabled={!query}
          aria-label="Previous match (Shift+Enter)"
          title="Previous match (Shift+Enter)"
          data-testid="find-prev-btn"
        >
          <IconArrowLeft size={13} />
        </button>

        <button
          type="button"
          className="find-in-page-btn"
          onClick={handleNext}
          disabled={!query}
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
          data-testid="find-next-btn"
        >
          <IconArrowRight size={13} />
        </button>

        <button
          type="button"
          className="find-in-page-btn close-btn"
          onClick={() => {
            playHapticClick()
            onClose()
          }}
          aria-label="Close find bar (Esc)"
          title="Close (Esc)"
          data-testid="find-close-btn"
        >
          <IconX size={13} />
        </button>
      </div>
    </div>
  )
}
