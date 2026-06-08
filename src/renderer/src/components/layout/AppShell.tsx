import type { ReactNode } from 'react'
import { useWindowInnerHeight } from '../../hooks/useWindowInnerHeight'

interface AppShellProps {
  children: ReactNode
}

/**
 * Root layout shell providing the dark cinematic atmosphere:
 * - Ambient radial glow (centered, subtle white)
 * - Base #0a0a0a background
 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  useWindowInnerHeight()

  return (
    <div
      className="relative flex flex-col min-h-0 overflow-hidden"
      style={{
        background: 'var(--bg-app)',
        width: 'var(--window-inner-width, 100%)',
        height: 'var(--window-inner-height, 100%)'
      }}
    >
      {/* Ambient glow — decorative radial gradient */}
      <div
        className="fixed pointer-events-none"
        style={{
          width: 500,
          height: 500,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 70%)',
          zIndex: 0
        }}
      />

      {/* Content layer */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
