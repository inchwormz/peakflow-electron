import type { CSSProperties } from 'react'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  size?: 'standard' | 'small'
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Toggle switch matching PeakFlow desktop design specs.
 * Standard: 36x20px track, 14x14px dot
 * Small:    30x16px track, 12x12px dot
 */
export function Toggle({
  checked,
  onChange,
  size = 'standard',
  disabled = false,
  'aria-label': ariaLabel
}: ToggleProps): React.JSX.Element {
  const isSmall = size === 'small'

  const trackWidth = isSmall ? 30 : 36
  const trackHeight = isSmall ? 16 : 20
  const dotSize = isSmall ? 12 : 14
  const trackRadius = isSmall ? 8 : 10
  const dotOffset = 3
  const dotTravel = trackWidth - dotSize - dotOffset * 2

  const trackStyle: CSSProperties = {
    position: 'relative',
    width: trackWidth,
    height: trackHeight,
    borderRadius: trackRadius,
    background: checked ? '#4ae08a' : '#1a1a1a',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background 0.25s ease',
    border: 'none',
    outline: 'none',
    padding: 0,
    flexShrink: 0
  }

  const dotStyle: CSSProperties = {
    position: 'absolute',
    top: dotOffset,
    left: dotOffset,
    width: dotSize,
    height: dotSize,
    borderRadius: '50%',
    background: checked ? '#ffffff' : '#444444',
    transform: checked ? `translateX(${dotTravel}px)` : 'translateX(0)',
    transition: 'transform 0.25s ease, background 0.25s ease'
  }

  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={trackStyle}
    >
      <div style={dotStyle} />
    </button>
  )
}
