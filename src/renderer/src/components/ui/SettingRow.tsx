import type { CSSProperties, ReactNode } from 'react'

interface SettingRowProps {
  /** Label text displayed on the left side */
  label: string
  /** Control or value displayed on the right side */
  children: ReactNode
  /** Whether to show the bottom border (default: true) */
  showBorder?: boolean
  className?: string
}

/**
 * A flex row for settings panels: label on the left, control on the right.
 * 13px label in #888, separated by 1px #111 border.
 */
export function SettingRow({
  label,
  children,
  showBorder = true,
  className
}: SettingRowProps): React.JSX.Element {
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: showBorder ? '1px solid #111111' : 'none',
    gap: 12
  }

  const labelStyle: CSSProperties = {
    fontSize: 13,
    color: '#888888',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontWeight: 400,
    whiteSpace: 'nowrap',
    flexShrink: 0
  }

  const valueStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0
  }

  return (
    <div style={rowStyle} className={className}>
      <span style={labelStyle}>{label}</span>
      <div style={valueStyle}>{children}</div>
    </div>
  )
}
