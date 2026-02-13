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

  const buttonBaseStyle: CSSProperties = {
    background: 'transparent',
    color: '#666666',
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s'
  }

  return (
    <div
      className="flex items-center justify-between h-8 select-none shrink-0"
      style={
        {
          WebkitAppRegion: 'drag',
          background: 'var(--bg-app)',
          borderBottom: '1px solid #1a1a1a',
          fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
        } as DragStyle
      }
    >
      {/* Title */}
      <span
        className="pl-3 truncate"
        style={{
          color: '#666666',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.5px',
          fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
        }}
      >
        {title}
      </span>

      {/* Window controls */}
      <div
        className="flex items-center gap-1 pr-2"
        style={{ WebkitAppRegion: 'no-drag' } as DragStyle}
      >
        {showMinimize && (
          <button
            onClick={handleMinimize}
            style={buttonBaseStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#141414'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#666666'
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
            style={buttonBaseStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#141414'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#666666'
            }}
            aria-label="Maximize"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
        )}

        {showClose && (
          <button
            onClick={handleClose}
            style={buttonBaseStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f05858'
              e.currentTarget.style.color = '#ffffff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#666666'
            }}
            aria-label="Close"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <line x1="0" y1="0" x2="10" y2="10" />
              <line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
