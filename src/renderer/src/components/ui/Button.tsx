import { type CSSProperties, type ReactNode, useState } from 'react'

type ButtonVariant = 'primary' | 'active' | 'danger' | 'ghost' | 'join' | 'circle'

interface ButtonProps {
  variant?: ButtonVariant
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  size?: number // for circle variant: 32 or 36
  className?: string
  'aria-label'?: string
}

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: 'none',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
  transition: 'background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s'
}

function getVariantStyles(
  variant: ButtonVariant,
  hovered: boolean,
  size: number
): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: hovered ? '#222222' : '#141414',
        border: `1px solid ${hovered ? '#444444' : '#222222'}`,
        color: '#ffffff',
        borderRadius: 14,
        padding: '8px 18px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '2px',
        textTransform: 'uppercase'
      }

    case 'active':
      return {
        background: '#ffffff',
        border: '1px solid #ffffff',
        color: '#0a0a0a',
        borderRadius: 14,
        padding: '8px 18px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '2px',
        textTransform: 'uppercase'
      }

    case 'danger':
      return {
        background: hovered ? '#2a1515' : '#1a0a0a',
        border: `1px solid ${hovered ? '#f05858' : '#2a1515'}`,
        color: '#f05858',
        borderRadius: 14,
        padding: '8px 18px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '2px',
        textTransform: 'uppercase'
      }

    case 'ghost':
      return {
        background: hovered ? '#141414' : 'transparent',
        border: '1px solid transparent',
        color: hovered ? '#ffffff' : '#888888',
        borderRadius: 10,
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: 400
      }

    case 'join':
      return {
        background: hovered ? '#0977e6' : '#0a84ff',
        border: '1px solid transparent',
        color: '#ffffff',
        borderRadius: 14,
        padding: '8px 18px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '1px',
        textTransform: 'uppercase'
      }

    case 'circle':
      return {
        background: hovered ? '#141414' : 'transparent',
        border: `1px solid ${hovered ? '#222222' : '#1a1a1a'}`,
        color: hovered ? '#ffffff' : '#666666',
        borderRadius: '50%',
        width: size,
        height: size,
        padding: 0,
        fontSize: 14,
        fontWeight: 400
      }
  }
}

/**
 * Button component matching PeakFlow desktop design specs.
 * Variants: primary, active, danger, ghost, join, circle
 */
export function Button({
  variant = 'primary',
  children,
  onClick,
  disabled = false,
  size = 32,
  className,
  'aria-label': ariaLabel
}: ButtonProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const style: CSSProperties = {
    ...baseStyle,
    ...getVariantStyles(variant, hovered && !disabled, size),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
