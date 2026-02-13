import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

/**
 * Root layout shell providing the dark cinematic atmosphere:
 * - Ambient radial glow (centered, subtle white)
 * - Base #0a0a0a background
 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <div
      className="relative flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--bg-app)' }}
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
      <div className="relative z-10 flex flex-col h-full">{children}</div>
    </div>
  )
}
