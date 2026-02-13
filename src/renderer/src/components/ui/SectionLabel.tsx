import type { CSSProperties, ReactNode } from 'react'

interface SectionLabelProps {
  children: ReactNode
  className?: string
}

const labelStyle: CSSProperties = {
  fontSize: 8,
  fontWeight: 600,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  color: '#444444',
  margin: '16px 0 8px',
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
  lineHeight: 1
}

/**
 * Section label for grouping settings / controls.
 * 8px, 600 weight, uppercase, #444, letter-spacing 2.5px.
 */
export function SectionLabel({ children, className }: SectionLabelProps): React.JSX.Element {
  return (
    <div style={labelStyle} className={className}>
      {children}
    </div>
  )
}
