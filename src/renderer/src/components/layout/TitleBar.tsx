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

  const handleBugReport = useCallback(() => {
    window.peakflow.invoke('bugreport:send-email')
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
        <button
          onClick={handleBugReport}
          style={buttonBaseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#141414'
            e.currentTarget.style.color = '#eab308'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#666666'
          }}
          aria-label="Report a Bug"
          title="Report a Bug"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.355.522a.5.5 0 0 1 .623.333l.291.956A5 5 0 0 1 8 1c.964 0 1.862.27 2.625.741l.27-.882a.5.5 0 1 1 .958.274l-.375 1.23A5.03 5.03 0 0 1 12.86 3.6l1.014-.406a.5.5 0 1 1 .372.93l-1.09.436Q13.5 5.04 13.5 5.5v.028a5 5 0 0 1-.347 1.83l1.122.449a.5.5 0 0 1-.372.93l-1.07-.428A5.03 5.03 0 0 1 11.063 10h.937a.5.5 0 0 1 0 1h-1.2a5 5 0 0 1-1.3 1.523V14a.5.5 0 0 1-1 0v-1.053A5 5 0 0 1 8 13a5 5 0 0 1-.5-.03V14a.5.5 0 0 1-1 0v-1.477A5 5 0 0 1 5.2 11H4a.5.5 0 0 1 0-1h.937a5.03 5.03 0 0 1-1.77-1.79l-1.07.428a.5.5 0 0 1-.372-.93l1.122-.449A5 5 0 0 1 2.5 5.528V5.5q0-.46.152-.937L1.562 4.13a.5.5 0 1 1 .372-.93l1.014.406A5.03 5.03 0 0 1 4.397 2.3l-.375-1.23a.5.5 0 0 1 .333-.548M6 5.5a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0m4 0a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z" />
          </svg>
        </button>

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
