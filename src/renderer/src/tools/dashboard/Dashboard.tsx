/**
 * Dashboard — PeakFlow suite hub window.
 *
 * Shows all 6 tools in a grid. Clicking a tool opens its dedicated window.
 * Displays trial/license status and version info.
 */

import { useState, useCallback, useEffect, type CSSProperties } from 'react'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { StatusBar } from '@renderer/components/layout/StatusBar'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { IPC_INVOKE } from '@shared/ipc-types'

// ─── Tool metadata ──────────────────────────────────────────────────────────

interface ToolMeta {
  id: ToolId
  accent: string
  description: string
  icon: string // SVG path data (24x24 viewBox)
}

const TOOLS: ToolMeta[] = [
  {
    id: ToolId.LiquidFocus,
    accent: '#4ae08a',
    description: 'Pomodoro timer & task tracking',
    // Clock icon
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z'
  },
  {
    id: ToolId.FocusDim,
    accent: '#a78bfa',
    description: 'Dim everything except active window',
    // Eye icon
    icon: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'
  },
  {
    id: ToolId.QuickBoard,
    accent: '#5eb8ff',
    description: 'Smart clipboard manager',
    // Clipboard icon
    icon: 'M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z'
  },
  {
    id: ToolId.ScreenSlap,
    accent: '#f05858',
    description: 'Full-screen meeting alerts',
    // Calendar alert icon
    icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM12 10h5v5h-5z'
  },
  {
    id: ToolId.MeetReady,
    accent: '#eab308',
    description: 'Camera & mic check before meetings',
    // Video icon
    icon: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z'
  },
  {
    id: ToolId.SoundSplit,
    accent: '#f472b6',
    description: 'Per-app volume control',
    // Volume icon
    icon: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'
  }
]

// ─── Component ──────────────────────────────────────────────────────────────

interface TrialStatus {
  isLicensed: boolean
  daysRemaining: number
}

/** Map AccessStatus from SECURITY_CHECK_ACCESS to our simpler TrialStatus. */
function toTrialStatus(raw: Record<string, unknown>): TrialStatus | null {
  if (typeof raw.daysRemaining !== 'number') return null
  return {
    isLicensed: raw.isLicensed === true,
    daysRemaining: raw.daysRemaining as number
  }
}

export function Dashboard(): React.JSX.Element {
  const [hoveredTool, setHoveredTool] = useState<string | null>(null)
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null)

  const openTool = useCallback((toolId: ToolId) => {
    window.peakflow.invoke(IPC_INVOKE.WINDOW_OPEN, { toolId })
  }, [])

  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.SECURITY_CHECK_ACCESS)
      .then((status) => {
        if (status && typeof status === 'object') {
          const ts = toTrialStatus(status as Record<string, unknown>)
          if (ts) setTrialStatus(ts)
        }
      })
      .catch(() => {})
  }, [])

  // ── Styles ──────────────────────────────────────────────────────────────

  const container: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 24px',
    overflow: 'hidden'
  }

  const header: CSSProperties = {
    marginBottom: 24,
    flexShrink: 0
  }

  const brandName: CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: -0.5,
    color: '#ffffff',
    fontFamily: "'Outfit', sans-serif",
    margin: 0,
    lineHeight: 1.2
  }

  const tagline: CSSProperties = {
    fontSize: 12,
    color: 'var(--text-dim)',
    marginTop: 4,
    fontWeight: 400
  }

  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
    flex: 1,
    overflow: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#1a1a1a transparent'
  }

  return (
    <>
      <TitleBar title="PeakFlow" showMaximize={false} />
      <div style={container}>
        <div style={header}>
          <h1 style={brandName}>PeakFlow</h1>
          <div style={tagline}>Mac-level productivity for Windows</div>
        </div>

        <div style={grid}>
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              isHovered={hoveredTool === tool.id}
              trialStatus={trialStatus}
              onHover={() => setHoveredTool(tool.id)}
              onLeave={() => setHoveredTool(null)}
              onClick={() => openTool(tool.id)}
            />
          ))}
        </div>
      </div>
      <StatusBar />
    </>
  )
}

// ─── Tool Card ──────────────────────────────────────────────────────────────

function ToolCard({
  tool,
  isHovered,
  trialStatus,
  onHover,
  onLeave,
  onClick
}: {
  tool: ToolMeta
  isHovered: boolean
  trialStatus: TrialStatus | null
  onHover: () => void
  onLeave: () => void
  onClick: () => void
}): React.JSX.Element {
  const card: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '16px 14px',
    borderRadius: 12,
    background: isHovered ? 'var(--bg-elevated)' : 'var(--bg-surface)',
    border: `1px solid ${isHovered ? tool.accent + '40' : 'var(--border-surface)'}`,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative',
    overflow: 'hidden'
  }

  const iconWrap: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: tool.accent + '15',
    flexShrink: 0
  }

  const name: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: isHovered ? '#ffffff' : 'var(--text-secondary)',
    fontFamily: "'Outfit', sans-serif",
    transition: 'color 0.2s'
  }

  const desc: CSSProperties = {
    fontSize: 11,
    color: 'var(--text-dim)',
    lineHeight: 1.4
  }

  const badgeStyle: CSSProperties | null =
    trialStatus && !trialStatus.isLicensed
      ? {
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: 0.5,
          padding: '2px 6px',
          borderRadius: 6,
          background:
            trialStatus.daysRemaining > 7
              ? 'rgba(74,224,138,0.15)'
              : trialStatus.daysRemaining > 0
                ? 'rgba(234,179,8,0.15)'
                : 'rgba(240,88,88,0.15)',
          color:
            trialStatus.daysRemaining > 7
              ? '#4ae08a'
              : trialStatus.daysRemaining > 0
                ? '#eab308'
                : '#f05858'
        }
      : null

  return (
    <div style={card} onMouseEnter={onHover} onMouseLeave={onLeave} onClick={onClick}>
      {badgeStyle && (
        <div style={badgeStyle}>
          {trialStatus!.daysRemaining > 0
            ? `${trialStatus!.daysRemaining}d trial`
            : 'Trial ended'}
        </div>
      )}
      <div style={iconWrap}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill={tool.accent}>
          <path d={tool.icon} />
        </svg>
      </div>
      <div style={name}>{TOOL_DISPLAY_NAMES[tool.id]}</div>
      <div style={desc}>{tool.description}</div>
    </div>
  )
}
