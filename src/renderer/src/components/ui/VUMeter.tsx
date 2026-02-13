import type { CSSProperties } from 'react'

interface VUMeterProps {
  /** Level from 0 to 100 */
  level: number
  /** Track height in pixels (default: 4) */
  height?: number
  className?: string
}

/**
 * VU meter for audio levels matching PeakFlow desktop design specs.
 * Container: 3-6px height, bg #1a1a1a, radius 2-3px.
 * Fill color based on level:
 *   <60%  → green (#4ae08a)
 *   60-85% → yellow (#eab308)
 *   >85%  → red (#f05858)
 */
export function VUMeter({
  level,
  height = 4,
  className
}: VUMeterProps): React.JSX.Element {
  const clampedLevel = Math.max(0, Math.min(100, level))

  let fillColor: string
  if (clampedLevel < 60) {
    fillColor = '#4ae08a'
  } else if (clampedLevel <= 85) {
    fillColor = '#eab308'
  } else {
    fillColor = '#f05858'
  }

  const containerStyle: CSSProperties = {
    width: '100%',
    height,
    background: '#1a1a1a',
    borderRadius: Math.max(2, height / 2),
    overflow: 'hidden'
  }

  const fillStyle: CSSProperties = {
    width: `${clampedLevel}%`,
    height: '100%',
    background: fillColor,
    borderRadius: Math.max(2, height / 2),
    transition: 'width 0.1s ease'
  }

  return (
    <div style={containerStyle} className={className} role="meter" aria-valuenow={clampedLevel} aria-valuemin={0} aria-valuemax={100}>
      <div style={fillStyle} />
    </div>
  )
}
