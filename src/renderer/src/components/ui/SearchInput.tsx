import { type CSSProperties, useState } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/**
 * Search input matching PeakFlow desktop design specs.
 * bg #111, border 1px #1a1a1a, radius 12px, 13px, focus border #fff.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  'aria-label': ariaLabel
}: SearchInputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)

  const style: CSSProperties = {
    width: '100%',
    background: '#111111',
    border: `1px solid ${focused ? '#ffffff' : '#1a1a1a'}`,
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 400,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    color: '#ffffff',
    outline: 'none',
    transition: 'border-color 0.2s ease'
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      style={style}
      className={className}
      aria-label={ariaLabel}
    />
  )
}
