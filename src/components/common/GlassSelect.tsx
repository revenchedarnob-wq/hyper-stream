import React, { useState, useRef, useEffect } from 'react'
import './glass-select.css'
import { IconChevronDown, IconCheck } from '../stream-hub/Icons'
import { playHapticClick, playHapticGlass } from '@/lib/sound'

export interface SelectOption {
  value: string
  label: string
}

interface GlassSelectProps {
  id?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}

export const GlassSelect: React.FC<GlassSelectProps> = ({
  id,
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value) || options[0]

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const toggleDropdown = () => {
    playHapticGlass()
    setIsOpen((prev) => !prev)
  }

  const handleSelect = (val: string) => {
    playHapticClick()
    onChange(val)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className={`glass-select-wrapper ${isOpen ? 'is-open' : ''} ${className}`}>
      <button
        id={id}
        type="button"
        className={`glass-select-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={toggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || selectedOption?.label}
      >
        <span className="glass-select-label">{selectedOption?.label}</span>
        <span className="glass-select-chevron">
          <IconChevronDown size={13} />
        </span>
      </button>

      {isOpen && (
        <div className="glass-select-menu" role="listbox">
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`glass-select-item ${isSelected ? 'is-selected' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSelect(option.value)
                }}
                onClick={() => handleSelect(option.value)}
                role="option"
                aria-selected={isSelected}
              >
                <span>{option.label}</span>
                {isSelected && <IconCheck size={12} className="glass-select-check-icon" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
