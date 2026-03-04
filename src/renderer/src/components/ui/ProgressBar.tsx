import type { CSSProperties } from 'react'

interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  value: number
  /** Track height in pixels (default: 3) */
  height?: number
  /** Fill color (default: #ffe17c) */
  color?: string
  className?: string
}

/**
 * Progress bar matching PeakFlow desktop design specs.
 * Container: 2-3px height, bg #1a1a1a, radius 1-2px.
 * Fill: bg #ffe17c, transition width 0.2s.
 */
export function ProgressBar({
  value,
  height = 3,
  color = '#ffe17c',
  className
}: ProgressBarProps): React.JSX.Element {
  const clampedValue = Math.max(0, Math.min(100, value))

  const containerStyle: CSSProperties = {
    width: '100%',
    height,
    background: '#1a1a1a',
    borderRadius: Math.max(1, height / 2),
    overflow: 'hidden'
  }

  const fillStyle: CSSProperties = {
    width: `${clampedValue}%`,
    height: '100%',
    background: color,
    borderRadius: Math.max(1, height / 2),
    transition: 'width 0.2s ease'
  }

  return (
    <div style={containerStyle} className={className} role="progressbar" aria-valuenow={clampedValue} aria-valuemin={0} aria-valuemax={100}>
      <div style={fillStyle} />
    </div>
  )
}
