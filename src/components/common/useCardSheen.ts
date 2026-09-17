import { useCallback } from 'react'

/**
 * Lightweight pointermove handler for dynamic specular cursor sheen.
 * Sets CSS variables --sheen-x and --sheen-y on the hovered card.
 * Uses requestAnimationFrame throttling to guarantee zero layout thrashing.
 */
export function useCardSheen() {
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    requestAnimationFrame(() => {
      target.style.setProperty('--sheen-x', `${x}px`)
      target.style.setProperty('--sheen-y', `${y}px`)
    })
  }, [])

  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const target = e.currentTarget
    requestAnimationFrame(() => {
      target.style.setProperty('--sheen-x', '-1000px')
      target.style.setProperty('--sheen-y', '-1000px')
    })
  }, [])

  return { onPointerMove, onPointerLeave }
}
