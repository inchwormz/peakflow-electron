import type { CSSProperties, ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

const cardStyle: CSSProperties = {
  background: 'rgba(10, 10, 10, 0.5)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 28
}

/**
 * Glassmorphism card matching the LiquidFocus design variant.
 * Semi-transparent bg, 20px blur, rgba border, 28px radius.
 */
export function GlassCard({ children, className, style }: GlassCardProps): React.JSX.Element {
  return (
    <div style={{ ...cardStyle, ...style }} className={className}>
      {children}
    </div>
  )
}
