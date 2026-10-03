import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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

interface MenuPosition {
  top?: number
  bottom?: number
  right: number
  maxHeight: number
}

const MENU_GAP = 6
const EDGE_MARGIN = 12
const PREFERRED_MAX_HEIGHT = 320

/** Places the menu below the trigger, or above it when there is more room there. */
function computeMenuPosition(trigger: DOMRect): MenuPosition {
  const viewportH = window.innerHeight
  const spaceBelow = viewportH - trigger.bottom - MENU_GAP - EDGE_MARGIN
  const spaceAbove = trigger.top - MENU_GAP - EDGE_MARGIN
  const right = Math.max(EDGE_MARGIN, window.innerWidth - trigger.right)
  if (spaceBelow >= Math.min(PREFERRED_MAX_HEIGHT, 160) || spaceBelow >= spaceAbove) {
    return { top: trigger.bottom + MENU_GAP, right, maxHeight: Math.min(PREFERRED_MAX_HEIGHT, spaceBelow) }
  }
  return { bottom: viewportH - trigger.top + MENU_GAP, right, maxHeight: Math.min(PREFERRED_MAX_HEIGHT, spaceAbove) }
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
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value) || options[0]

  // The menu is portalled out of the card so overflow:hidden parents can't clip it.
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      setPosition(null)
      return
    }
    setPosition(computeMenuPosition(containerRef.current.getBoundingClientRect()))
  }, [isOpen])

  // Close on outside click, scroll (the anchor moves) or window resize
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setIsOpen(false)
    }
    const handleScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setIsOpen(false)
    }
    const handleResize = () => setIsOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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

  // Portal into the themed window container so the menu keeps its colour tokens.
  const portalHost =
    (containerRef.current?.closest('.window-container') as HTMLElement | null) ??
    (typeof document !== 'undefined' ? document.body : null)
  const potato = !!containerRef.current?.closest('.potato-mode')

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

      {isOpen &&
        position &&
        portalHost &&
        createPortal(
          <div
            ref={menuRef}
            className={`glass-select-menu ${position.bottom !== undefined ? 'opens-up' : ''} ${potato ? 'is-potato' : ''}`}
            role="listbox"
            style={{
              top: position.top,
              bottom: position.bottom,
              right: position.right,
              maxHeight: position.maxHeight,
            }}
          >
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
          </div>,
          portalHost,
        )}
    </div>
  )
}
