/**
 * FramelessNav — Reusable navigation bar for frameless Electron windows.
 *
 * Provides a drag region for window movement with automatic no-drag zones
 * for interactive elements. Avoids the common pitfall where an absolute
 * drag region covers buttons in different view modes.
 *
 * Usage:
 *   <FramelessNav
 *     left={<>
 *       <NavIconBtn onClick={goBack} title="Back">◀</NavIconBtn>
 *       <span>Settings</span>
 *     </>}
 *     right={<>
 *       <NavIconBtn onClick={minimize}>—</NavIconBtn>
 *       <NavIconBtn onClick={close} hoverColor="#f05858">✕</NavIconBtn>
 *     </>}
 *   />
 *
 * The entire nav bar is the drag region. The left/right slots are no-drag
 * zones, so all interactive content within them is always clickable.
 */

import { type CSSProperties, type ReactNode } from 'react'

type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

// ─── Design Tokens (matches dark cinematic DS used across tools) ────────────

const NAV_DS = {
  textDim: '#666666',
  textPrimary: '#f0f0f5',
  border: '#1a1a1a',
  bgHover: '#141414',
  error: '#f05858',
  white: '#ffffff'
} as const

// ─── Main Component ─────────────────────────────────────────────────────────

interface FramelessNavProps {
  /** Content for the left side (title, back button, badges) */
  left?: ReactNode
  /** Content for the right side (action buttons, close/minimize) */
  right?: ReactNode
  /** Custom padding (default: '20px 24px 0') */
  padding?: string
  /** Custom height for the drag region (default: 60) */
  dragHeight?: number
}

export function FramelessNav({
  left,
  right,
  padding = '20px 24px 0',
  dragHeight = 60
}: FramelessNavProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding,
        flexShrink: 0,
        position: 'relative',
        minHeight: dragHeight,
        WebkitAppRegion: 'drag'
      } as DragStyle}
    >
      {/* Left slot — no-drag so buttons/links are always clickable */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          zIndex: 2,
          WebkitAppRegion: 'no-drag'
        } as DragStyle}
      >
        {left}
      </div>

      {/* Right slot — no-drag for window controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexShrink: 0,
          zIndex: 2,
          WebkitAppRegion: 'no-drag'
        } as DragStyle}
      >
        {right}
      </div>
    </div>
  )
}

// ─── NavIconBtn — Standard circular icon button for nav bars ────────────────

interface NavIconBtnProps {
  onClick: () => void
  title: string
  /** Color on hover (default: white, use '#f05858' for close buttons) */
  hoverColor?: string
  children: ReactNode
  style?: CSSProperties
}

export function NavIconBtn({
  onClick,
  title,
  hoverColor = NAV_DS.white,
  children,
  style: extraStyle
}: NavIconBtnProps): React.JSX.Element {
  return (
    <button
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1px solid ${NAV_DS.border}`,
        background: 'transparent',
        color: NAV_DS.textDim,
        cursor: 'pointer',
        fontSize: 14,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        flexShrink: 0,
        fontFamily: 'inherit',
        padding: 0,
        outline: 'none',
        ...extraStyle
      }}
      title={title}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.borderColor = '#333'
        el.style.color = hoverColor
        el.style.background = NAV_DS.bgHover
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.borderColor = NAV_DS.border
        el.style.color = NAV_DS.textDim
        el.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}
