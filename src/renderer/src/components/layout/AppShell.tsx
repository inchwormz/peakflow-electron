import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

/**
 * Root layout shell providing the dark cinematic atmosphere:
 * - Film grain overlay (SVG noise, very subtle)
 * - Ambient radial glow (top-right corner, warm amber)
 * - Base void background
 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      {/* Ambient radial glow — warm amber in top-right */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 600px 400px at 85% 5%, rgba(232, 162, 55, 0.04), transparent 70%)',
          zIndex: 0
        }}
      />

      {/* Content layer */}
      <div className="relative z-10 flex flex-col w-full h-full">{children}</div>

      {/* Film grain overlay */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          opacity: 0.025,
          zIndex: 9999,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '128px 128px'
        }}
      />
    </div>
  )
}
