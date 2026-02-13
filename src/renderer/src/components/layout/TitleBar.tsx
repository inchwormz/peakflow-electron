import { useCallback, type CSSProperties } from 'react'

/** Electron-specific CSS property for frameless window drag regions */
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

interface TitleBarProps {
  title?: string
  showMinimize?: boolean
  showMaximize?: boolean
  showClose?: boolean
}

export function TitleBar({
  title = 'PeakFlow',
  showMinimize = true,
  showMaximize = true,
  showClose = true
}: TitleBarProps): React.JSX.Element {
  const handleMinimize = useCallback(() => {
    window.peakflow.invoke('window:minimize')
  }, [])

  const handleMaximize = useCallback(() => {
    window.peakflow.invoke('window:toggle-maximize')
  }, [])

  const handleClose = useCallback(() => {
    window.peakflow.invoke('window:close')
  }, [])

  return (
    <div
      className="flex items-center justify-between h-8 select-none shrink-0"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-dim)'
      } as DragStyle}
    >
      {/* Title */}
      <span
        className="pl-3 text-xs font-medium tracking-wide truncate"
        style={{ color: 'var(--text-secondary)', fontFamily: "'Outfit', sans-serif" }}
      >
        {title}
      </span>

      {/* Window controls */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as DragStyle}>
        {showMinimize && (
          <button
            onClick={handleMinimize}
            className="inline-flex items-center justify-center w-11 h-full border-none outline-none cursor-pointer transition-colors duration-150"
            style={{ background: 'transparent', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>
        )}

        {showMaximize && (
          <button
            onClick={handleMaximize}
            className="inline-flex items-center justify-center w-11 h-full border-none outline-none cursor-pointer transition-colors duration-150"
            style={{ background: 'transparent', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            aria-label="Maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
        )}

        {showClose && (
          <button
            onClick={handleClose}
            className="inline-flex items-center justify-center w-11 h-full border-none outline-none cursor-pointer transition-colors duration-150"
            style={{ background: 'transparent', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--danger)'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="10" y2="10" />
              <line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
