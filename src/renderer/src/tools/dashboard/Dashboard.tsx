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
import { IPC_INVOKE } from '@shared/ipc-types'
import type { LicenseActivationResult } from '@shared/ipc-types'

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
        <div style={{ ...header, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={brandName}>PeakFlow</h1>
            <div style={tagline}>Mac-level productivity for Windows</div>
          </div>
          <button
            onClick={() => setShowShare(!showShare)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              background: showShare ? 'rgba(74,224,138,0.15)' : 'rgba(74,224,138,0.1)',
              color: '#4ae08a',
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
                  color: licenseStatus.type === 'success' ? '#4ae08a' : '#f05858'
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

  // Badge logic — only shown for installed tools
  let badgeLabel = ''
  let badgeBg = ''
  let badgeColor = ''

  if (installed) {
    if (toolLicensed && isToolAllowed) {
      badgeLabel = 'Licensed'
      badgeBg = 'rgba(74,224,138,0.15)'
      badgeColor = '#4ae08a'
    } else if (daysRemaining > 0) {
      badgeLabel = `${daysRemaining}d trial`
      badgeBg = daysRemaining > 7 ? 'rgba(74,224,138,0.15)' : 'rgba(234,179,8,0.15)'
      badgeColor = daysRemaining > 7 ? '#4ae08a' : '#eab308'
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill={tool.accent}>
          <path d={tool.icon} />
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
