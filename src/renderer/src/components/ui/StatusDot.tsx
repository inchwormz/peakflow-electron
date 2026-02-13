import type { CSSProperties } from 'react'

type StatusDotColor = 'green' | 'yellow' | 'red' | 'gray'

interface StatusDotProps {
  color?: StatusDotColor
  className?: string
}

const colorMap: Record<StatusDotColor, string> = {
  green: '#4ae08a',
  yellow: '#eab308',
  red: '#f05858',
  gray: '#555555'
}

/**
 * 8x8px status indicator dot.
 * Colors: green (#4ae08a), yellow (#eab308), red (#f05858), gray (#555).
 */
export function StatusDot({ color = 'green', className }: StatusDotProps): React.JSX.Element {
  const style: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: colorMap[color],
    flexShrink: 0
  }

  return <div style={style} className={className} />
}
