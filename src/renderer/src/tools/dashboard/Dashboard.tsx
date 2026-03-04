/**
 * Dashboard — PeakFlow suite hub window.
 *
 * Shows all 6 tools in a grid. Clicking a tool opens its dedicated window.
 * Displays trial/license status and version info.
 */

import { useState, useCallback, useEffect, useRef, type CSSProperties, type FormEvent } from 'react'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { StatusBar } from '@renderer/components/layout/StatusBar'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { ShareAndEarn } from '@renderer/components/sharing/ShareAndEarn'
import peakflowLogo from '@renderer/assets/peakflow-logo.png'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { LicenseActivationResult } from '@shared/ipc-types'

// ─── Tool metadata ──────────────────────────────────────────────────────────

interface ToolMeta {
  id: ToolId
  accent: string
  description: string
  icon: string[] // SVG stroke path data (24x24 viewBox)
}

const TOOLS: ToolMeta[] = [
  {
    id: ToolId.LiquidFocus,
    accent: '#ffe17c',
    description: 'Pomodoro timer & task tracking',
    // Timer — circle + clock hands
    icon: [
      'M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z',
      'M12 6v6l4 2'
    ]
  },
  {
    id: ToolId.FocusDim,
    accent: '#ffe17c',
    description: 'Dim everything except active window',
    // Viewfinder brackets
    icon: [
      'M2 7V2h5',
      'M17 2h5v5',
      'M22 17v5h-5',
      'M7 22H2v-5'
    ]
  },
  {
    id: ToolId.QuickBoard,
    accent: '#ffe17c',
    description: 'Smart clipboard manager',
    // Stacked layers
    icon: [
      'M12 2L2 7l10 5 10-5-10-5z',
      'M2 17l10 5 10-5',
      'M2 12l10 5 10-5'
    ]
  },
  {
    id: ToolId.ScreenSlap,
    accent: '#ffe17c',
    description: 'Full-screen meeting alerts',
    // Lightning bolt
    icon: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z']
  },
  {
    id: ToolId.MeetReady,
    accent: '#ffe17c',
    description: 'Camera & mic check before meetings',
    // Video camera
    icon: [
      'M23 7l-7 5 7 5V7z',
      'M1 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5z'
    ]
  },
  {
    id: ToolId.SoundSplit,
    accent: '#ffe17c',
    description: 'Per-app volume control',
    // Mixer sliders
    icon: [
      'M4 21V14', 'M4 10V3',
      'M12 21V12', 'M12 8V3',
      'M20 21V16', 'M20 12V3',
      'M1 14h6', 'M9 8h6', 'M17 16h6'
    ]
  }
]

// ─── Component ──────────────────────────────────────────────────────────────

interface TrialStatus {
  isLicensed: boolean
  daysRemaining: number
}

interface ToolAccessMap {
  [toolId: string]: { allowed: boolean; isLicensed: boolean; isToolLicensed: boolean; daysRemaining: number; installed: boolean }
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
  const [toolAccess, setToolAccess] = useState<ToolAccessMap>({})
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseStatus, setLicenseStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' })
  const [showShare, setShowShare] = useState(false)
  const licenseInputRef = useRef<HTMLInputElement>(null)

  const openTool = useCallback((toolId: ToolId) => {
    window.peakflow.invoke(IPC_INVOKE.WINDOW_OPEN, { toolId })
  }, [])

  /** Fetch per-tool access + install state for all tools */
  const refreshToolAccess = useCallback(async () => {
    const map: ToolAccessMap = {}
    await Promise.all(
      Object.values(ToolId).map(async (id) => {
        try {
          const [status, installState] = await Promise.all([
            window.peakflow.invoke(IPC_INVOKE.SECURITY_CHECK_TOOL_ACCESS, id),
            window.peakflow.invoke(IPC_INVOKE.TOOL_GET_INSTALL_STATE, id)
          ])
          const s = (status && typeof status === 'object') ? status as Record<string, unknown> : {}
          const inst = (installState && typeof installState === 'object') ? installState as Record<string, unknown> : {}
          map[id] = {
            allowed: s.allowed === true,
            isLicensed: s.isLicensed === true,
            isToolLicensed: s.isToolLicensed === true,
            daysRemaining: typeof s.daysRemaining === 'number' ? s.daysRemaining as number : -1,
            installed: inst.installed === true
          }
        } catch { /* ignore */ }
      })
    )
    setToolAccess(map)
  }, [])

  const installAndOpen = useCallback(async (toolId: ToolId) => {
    await window.peakflow.invoke(IPC_INVOKE.TOOL_INSTALL, toolId)
    await refreshToolAccess()
    window.peakflow.invoke(IPC_INVOKE.WINDOW_OPEN, { toolId })
  }, [refreshToolAccess])

  const handleActivate = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    const key = licenseKey.trim()
    if (!key) { licenseInputRef.current?.focus(); return }
    setLicenseStatus({ type: 'loading', message: 'Validating...' })
    try {
      const result = (await window.peakflow.invoke(IPC_INVOKE.SECURITY_ACTIVATE_LICENSE, key)) as LicenseActivationResult
      if (result.success) {
        setLicenseStatus({ type: 'success', message: result.message || 'License activated!' })
        // Re-query per-tool access so badges update correctly
        const globalStatus = await window.peakflow.invoke(IPC_INVOKE.SECURITY_CHECK_ACCESS)
        if (globalStatus && typeof globalStatus === 'object') {
          const ts = toTrialStatus(globalStatus as Record<string, unknown>)
          if (ts) setTrialStatus(ts)
        }
        await refreshToolAccess()
      } else {
        setLicenseStatus({ type: 'error', message: result.message || 'Invalid license key.' })
      }
    } catch (err) {
      setLicenseStatus({ type: 'error', message: err instanceof Error ? err.message : 'Activation failed.' })
    }
  }, [licenseKey, refreshToolAccess])

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
    refreshToolAccess()
  }, [refreshToolAccess])

  // ── Styles ──────────────────────────────────────────────────────────────

  const container: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 24px',
    overflow: 'hidden auto'
  }

  const header: CSSProperties = {
    marginBottom: 24,
    flexShrink: 0
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
      <TitleBar title="" showMaximize={false} />
      <div style={container}>
        <div style={{ ...header, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <img
            src={peakflowLogo}
            alt="PeakFlow"
            style={{ height: 32, imageRendering: 'pixelated' }}
          />
          <button
            onClick={() => setShowShare(!showShare)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              background: showShare ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'Outfit', sans-serif",
              flexShrink: 0,
              marginTop: 4,
              transition: 'background 0.2s'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 00-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 12 7.4l3.38 4.6L17 10.83 14.92 8H20v6z" />
            </svg>
            Share &amp; Earn
          </button>
        </div>

        <div style={grid}>
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              isHovered={hoveredTool === tool.id}
              trialStatus={trialStatus}
              toolAccess={toolAccess[tool.id]}
              onHover={() => setHoveredTool(tool.id)}
              onLeave={() => setHoveredTool(null)}
              onClick={() => openTool(tool.id)}
              onInstall={() => installAndOpen(tool.id)}
            />
          ))}
        </div>

        {/* Share & Earn — toggled from header button */}
        {showShare && (
          <ShareAndEarn
            ownedTools={Object.entries(toolAccess)
              .filter(([, v]) => v.isToolLicensed)
              .map(([k]) => k as ToolId)}
          />
        )}

        {/* License key section — visible during trial */}
        {trialStatus && !trialStatus.isLicensed && (
          <div style={{ flexShrink: 0, marginTop: 12 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-surface)'
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: "'Outfit', sans-serif", fontWeight: 600, marginBottom: 8 }}>
                Have a license key?
              </div>
              <form onSubmit={handleActivate} style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={licenseInputRef}
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="Enter license key..."
                  disabled={licenseStatus.type === 'loading' || licenseStatus.type === 'success'}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-surface)',
                    color: 'var(--text-primary)',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    padding: '8px 10px',
                    borderRadius: 6,
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  disabled={licenseStatus.type === 'loading' || licenseStatus.type === 'success'}
                  style={{
                    flexShrink: 0,
                    background: 'var(--accent)',
                    color: 'var(--bg-void)',
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '8px 14px',
                    borderRadius: 6,
                    opacity: licenseStatus.type === 'loading' || licenseStatus.type === 'success' ? 0.5 : 1
                  }}
                >
                  {licenseStatus.type === 'loading' ? 'Validating...' : 'Activate'}
                </button>
              </form>
              {licenseStatus.type !== 'idle' && licenseStatus.type !== 'loading' && (
                <div style={{
                  fontSize: 10,
                  marginTop: 6,
                  color: licenseStatus.type === 'success' ? '#ffffff' : '#f05858'
                }}>
                  {licenseStatus.message}
                </div>
              )}
            </div>
          </div>
        )}
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
  toolAccess,
  onHover,
  onLeave,
  onClick,
  onInstall
}: {
  tool: ToolMeta
  isHovered: boolean
  trialStatus: TrialStatus | null
  toolAccess?: { allowed: boolean; isLicensed: boolean; isToolLicensed: boolean; daysRemaining: number; installed: boolean }
  onHover: () => void
  onLeave: () => void
  onClick: () => void
  onInstall: () => void
}): React.JSX.Element {
  const installed = toolAccess?.installed ?? false
  const isToolAllowed = toolAccess?.allowed ?? true
  const toolLicensed = toolAccess?.isToolLicensed ?? false
  const daysRemaining = toolAccess?.daysRemaining ?? -1

  const card: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '16px 14px',
    borderRadius: 12,
    background: isHovered ? 'var(--bg-elevated)' : 'var(--bg-surface)',
    border: `1px solid ${isHovered ? tool.accent + '40' : 'var(--border-surface)'}`,
    cursor: installed ? 'pointer' : 'default',
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
    fontSize: 13,
    fontWeight: 400,
    color: isHovered ? '#ffffff' : 'var(--text-secondary)',
    fontFamily: "'Silkscreen', cursive",
    transition: 'color 0.2s'
  }

  const desc: CSSProperties = {
    fontSize: 11,
    color: 'var(--text-dim)',
    lineHeight: 1.4
  }

  // Badge logic — only shown for installed tools
  let badgeLabel = ''
  let badgeBg = ''
  let badgeColor = ''

  if (installed) {
    if (toolLicensed && isToolAllowed) {
      badgeLabel = 'Licensed'
      badgeBg = 'rgba(255,255,255,0.1)'
      badgeColor = '#ffffff'
    } else if (daysRemaining > 0) {
      badgeLabel = `${daysRemaining}d trial`
      badgeBg = daysRemaining > 7 ? 'rgba(255,255,255,0.1)' : 'rgba(234,179,8,0.15)'
      badgeColor = daysRemaining > 7 ? '#ffffff' : '#eab308'
    } else if (!isToolAllowed) {
      badgeLabel = 'Locked'
      badgeBg = 'rgba(240,88,88,0.15)'
      badgeColor = '#f05858'
    }
  }

  const badgeStyle: CSSProperties | null = badgeLabel ? {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 0.5,
    padding: '2px 6px',
    borderRadius: 6,
    background: badgeBg,
    color: badgeColor
  } : null

  const installBtnStyle: CSSProperties = {
    marginTop: 4,
    padding: '6px 12px',
    borderRadius: 8,
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'Outfit', sans-serif",
    background: tool.accent + '20',
    color: tool.accent,
    transition: 'background 0.2s'
  }

  const handleCardClick = installed ? onClick : undefined

  return (
    <div style={card} onMouseEnter={onHover} onMouseLeave={onLeave} onClick={handleCardClick}>
      {badgeStyle && <div style={badgeStyle}>{badgeLabel}</div>}
      <div style={iconWrap}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tool.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {tool.icon.map((d, i) => <path key={i} d={d} />)}
        </svg>
      </div>
      <div style={name}>{TOOL_DISPLAY_NAMES[tool.id]}</div>
      <div style={desc}>{tool.description}</div>
      {!installed && (
        <button
          style={installBtnStyle}
          onClick={(e) => {
            e.stopPropagation()
            onInstall()
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = tool.accent + '35' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = tool.accent + '20' }}
        >
          Try Free — 14 days
        </button>
      )}
    </div>
  )
}
