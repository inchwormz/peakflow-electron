/**
 * MeetReady — Pre-meeting camera & mic check panel.
 * Matches MeetReady_Redesign.html exactly.
 *
 * Dark cinematic design system:
 *   - #0a0a0a background, Be Vietnam Pro font
 *   - 340px wide panel, frameless
 *   - Camera preview (210px, 16px radius, gradient overlay, "Live" indicator)
 *   - Status cards row: Lighting + Microphone
 *   - Readiness banner (green "All Clear" or yellow warning)
 *   - Settings view: device selection, calendar auto-popup
 *
 * Architecture:
 *   - Camera/mic are entirely renderer-side (Web APIs)
 *   - Calendar integration uses shared google-calendar service via IPC
 *   - Config persistence via config:get / config:set IPC
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import { useMediaDevices } from '../../hooks/useMediaDevices'
import { CameraPreview, type BrightnessResult, type LightingStatus } from './CameraPreview'
import { AudioMeter, type MicResult, type MicStatus } from './AudioMeter'

// ─── Design Tokens (dark cinematic — matches Python COLORS + HTML) ──────────

const DS = {
  bg: '#0a0a0a',
  bgLight: '#111111',
  bgHover: '#141414',
  accent: '#4ae08a',
  text: '#f0f0f5',
  textDim: '#666666',
  textGray: '#888888',
  secLabel: '#444444',
  success: '#4ae08a',
  warning: '#eab308',
  error: '#f05858',
  border: '#1a1a1a',
  elevated: '#1a1a1a',
  white: '#ffffff'
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string
  summary: string
  startTime: string
  endTime: string
  durationMinutes: number
  meetingLink: string | null
  meetingService: string | null
  location: string | null
  description: string | null
  allDay: boolean
}

interface CalendarStatus {
  connected: boolean
  email: string | null
  lastFetched: string | null
  error: string | null
}

interface MeetReadyConfig {
  auto_popup_minutes_before: number
  auto_popup_enabled: boolean
  default_camera: string
  default_mic: string
}

type ViewMode = 'main' | 'settings'

// ─── Helpers ────────────────────────────────────────────────────────────────

const api = window.peakflow

function formatRelativeShort(ms: number): string {
  if (ms < 60_000) return 'now'
  const min = Math.ceil(ms / 60_000)
  if (min === 1) return '1 min'
  if (min < 60) return `${min} min`
  const hrs = Math.floor(min / 60)
  const rem = min % 60
  if (rem === 0) return `${hrs}h`
  return `${hrs}h ${rem}m`
}

function getLightingDotColor(status: LightingStatus): 'green' | 'yellow' | 'red' | 'gray' {
  switch (status) {
    case 'Good':
      return 'green'
    case 'Low Light':
    case 'Bright':
      return 'yellow'
    case 'Too Dark':
    case 'Too Bright':
      return 'red'
    default:
      return 'gray'
  }
}

function getMicDotColor(status: MicStatus): 'green' | 'red' | 'gray' {
  switch (status) {
    case 'Active':
      return 'green'
    case 'Too Loud':
      return 'red'
    default:
      return 'gray'
  }
}

const dotColors: Record<string, string> = {
  green: DS.success,
  yellow: DS.warning,
  red: DS.error,
  gray: '#555555'
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MeetReady(): React.JSX.Element {
  const [view, setView] = useState<ViewMode>('main')
  const [config, setConfig] = useState<MeetReadyConfig>({
    auto_popup_minutes_before: 2,
    auto_popup_enabled: true,
    default_camera: '',
    default_mic: ''
  })
  const [calStatus, setCalStatus] = useState<CalendarStatus>({
    connected: false,
    email: null,
    lastFetched: null,
    error: null
  })
  const [events, setEvents] = useState<CalendarEvent[]>([])

  // Media devices
  const {
    cameras,
    microphones,
    videoStream,
    audioStream,
    startCamera,
    stopCamera,
    startMic,
    stopMic,
    error: mediaError
  } = useMediaDevices()

  // Brightness / mic analysis state
  const [lightStatus, setLightStatus] = useState<LightingStatus>('Unknown')
  const [micStatus, setMicStatus] = useState<MicStatus>('Silent')

  // Pending setting changes (camera/mic index to apply on save)
  const [pendingCamId, setPendingCamId] = useState<string>('')
  const [pendingMicId, setPendingMicId] = useState<string>('')

  // Tick for countdown refresh
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [, forceUpdate] = useState(0)

  // ─── Load initial data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [statusRes, eventsRes, configRes] = await Promise.all([
        api.invoke(IPC_INVOKE.CALENDAR_GET_STATUS) as Promise<CalendarStatus>,
        api.invoke(IPC_INVOKE.CALENDAR_GET_EVENTS) as Promise<CalendarEvent[]>,
        api.invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.MeetReady }) as Promise<MeetReadyConfig | null>
      ])
      setCalStatus(statusRes)
      setEvents(eventsRes ?? [])
      if (configRes) setConfig(configRes)
    } catch (err) {
      console.error('[MeetReady] Failed to load data:', err)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── Auto-start camera and mic once config has loaded ─────────────────

  const mediaStartedRef = useRef(false)
  const prevCamRef = useRef(config.default_camera)
  const prevMicRef = useRef(config.default_mic)

  useEffect(() => {
    if (!mediaStartedRef.current) {
      // First start — use whatever config we have (may still be defaults)
      mediaStartedRef.current = true
      startCamera(config.default_camera || undefined)
      startMic(config.default_mic || undefined)
    } else {
      // Config loaded from IPC — restart only if device preference changed
      if (config.default_camera !== prevCamRef.current) {
        stopCamera()
        startCamera(config.default_camera || undefined)
      }
      if (config.default_mic !== prevMicRef.current) {
        stopMic()
        startMic(config.default_mic || undefined)
      }
    }
    prevCamRef.current = config.default_camera
    prevMicRef.current = config.default_mic

    return () => {
      stopCamera()
      stopMic()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.default_camera, config.default_mic])

  // ─── IPC listeners ──────────────────────────────────────────────────────

  useEffect(() => {
    const unsubEvents = api.on(IPC_SEND.CALENDAR_EVENTS_UPDATED, (evts: unknown) => {
      setEvents(evts as CalendarEvent[])
    })
    const unsubStatus = api.on(IPC_SEND.CALENDAR_STATUS_CHANGED, (st: unknown) => {
      setCalStatus(st as CalendarStatus)
    })
    return () => {
      unsubEvents()
      unsubStatus()
    }
  }, [])

  // ─── Tick for countdown updates ─────────────────────────────────────────

  useEffect(() => {
    tickRef.current = setInterval(() => forceUpdate((n) => n + 1), 1000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  // ─── Callbacks ──────────────────────────────────────────────────────────

  const onBrightness = useCallback((result: BrightnessResult) => {
    setLightStatus(result.status)
  }, [])

  const onMicLevel = useCallback((result: MicResult) => {
    setMicStatus(result.status)
  }, [])

  const updateConfig = async (key: string, value: unknown): Promise<void> => {
    try {
      await api.invoke(IPC_INVOKE.CONFIG_SET, {
        tool: ToolId.MeetReady,
        key,
        value
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
    } catch (err) {
      console.error('[MeetReady] Config update failed:', err)
    }
  }

  const connectCalendar = async (): Promise<void> => {
    try {
      const result = (await api.invoke(IPC_INVOKE.CALENDAR_AUTHENTICATE)) as CalendarStatus
      setCalStatus(result)
      const evts = (await api.invoke(IPC_INVOKE.CALENDAR_GET_EVENTS)) as CalendarEvent[]
      setEvents(evts ?? [])
    } catch (err) {
      console.error('[MeetReady] Auth failed:', err)
    }
  }

  const openSettings = (): void => {
    // Snapshot current device selections for pending edits
    setPendingCamId(config.default_camera)
    setPendingMicId(config.default_mic)
    setView('settings')
  }

  const saveAndCloseSettings = async (): Promise<void> => {
    // Persist device selections
    if (pendingCamId !== config.default_camera) {
      await updateConfig('default_camera', pendingCamId)
      stopCamera()
      startCamera(pendingCamId || undefined)
    }
    if (pendingMicId !== config.default_mic) {
      await updateConfig('default_mic', pendingMicId)
      stopMic()
      startMic(pendingMicId || undefined)
    }
    setView('main')
  }

  // ─── Derived state ──────────────────────────────────────────────────────

  const now = Date.now()
  const futureEvents = events
    .filter((e) => !e.allDay && new Date(e.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  const nextEvent = futureEvents[0] ?? null
  const nextDiff = nextEvent ? new Date(nextEvent.startTime).getTime() - now : null

  // Readiness assessment
  const lightOk = lightStatus === 'Good'
  const micOk = micStatus === 'Active'
  const allGood = lightOk && micOk

  const lightDotColor = getLightingDotColor(lightStatus)
  const micDotColor = getMicDotColor(micStatus)

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* Keyframe animation for the pulsing live dot */}
      <style>{`
        @keyframes meetready-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* ══════ MAIN VIEW ══════ */}
      {view === 'main' && (
        <div style={styles.view}>
          {/* Nav bar */}
          <div style={styles.navBar}>
            <div style={styles.navLeft}>
              <span style={styles.navTitle}>MeetReady</span>
              {nextEvent && nextDiff !== null && nextDiff < 10 * 60_000 && (
                <span style={styles.meetingBadge}>
                  &#128197; {nextEvent.summary.length > 14
                    ? nextEvent.summary.slice(0, 11) + '...'
                    : nextEvent.summary
                  } in {formatRelativeShort(nextDiff)}
                </span>
              )}
            </div>
            <div style={styles.navRight}>
              <NavBtn onClick={openSettings} title="Settings">&#9881;</NavBtn>
              <NavBtn onClick={() => api.invoke(IPC_INVOKE.WINDOW_MINIMIZE)} title="Minimize">
                &#8212;
              </NavBtn>
              <NavBtn onClick={() => api.invoke(IPC_INVOKE.WINDOW_CLOSE)} title="Close" isClose>
                &#10005;
              </NavBtn>
            </div>
          </div>

          {/* Main body */}
          <div style={styles.mainBody}>
            {/* Camera preview */}
            <CameraPreview stream={videoStream} onBrightness={onBrightness} />

            {/* Media error banner */}
            {mediaError && (
              <div
                style={{
                  fontSize: 11,
                  color: DS.error,
                  background: 'rgba(240,88,88,0.1)',
                  padding: '8px 12px',
                  borderRadius: 8,
                  marginTop: 8,
                  textAlign: 'center'
                }}
              >
                {mediaError}
              </div>
            )}

            {/* Status cards row */}
            <div style={styles.statusRow}>
              {/* Lighting card */}
              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Lighting</div>
                <div style={styles.statusInfo}>
                  <div
                    style={{
                      ...styles.statusDot,
                      background: dotColors[lightDotColor]
                    }}
                  />
                  <span style={styles.statusText}>{lightStatus}</span>
                </div>
              </div>

              {/* Microphone card */}
              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Microphone</div>
                <div style={styles.statusInfo}>
                  <div
                    style={{
                      ...styles.statusDot,
                      background: dotColors[micDotColor]
                    }}
                  />
                  <span style={styles.statusText}>{micStatus}</span>
                </div>
                <AudioMeter stream={audioStream} onLevel={onMicLevel} />
              </div>
            </div>

            {/* Readiness banner — pushed to bottom */}
            <div
              style={{
                ...styles.readiness,
                background: allGood ? 'rgba(74,224,138,0.1)' : 'rgba(234,179,8,0.1)',
                color: allGood ? DS.success : DS.warning
              }}
            >
              {allGood ? (
                <>&#10003; All Clear &mdash; You look great</>
              ) : (
                <>
                  &#9888; Check{' '}
                  {[
                    !lightOk ? 'lighting' : null,
                    !micOk ? 'microphone' : null
                  ]
                    .filter(Boolean)
                    .join(' & ')}
                </>
              )}
            </div>
          </div>

          {/* Drag region: exclude right buttons (settings, minimize, close) */}
          <div style={{ ...styles.dragRegion, left: 0, right: 140 } as DragStyle} />
        </div>
      )}

      {/* ══════ SETTINGS VIEW ══════ */}
      {view === 'settings' && (
        <div style={styles.view}>
          {/* Settings nav bar */}
          <div style={styles.navBar}>
            <div style={styles.navLeft}>
              <NavBtn onClick={saveAndCloseSettings} title="Back" style={{ fontSize: 16 }}>
                &#9664;
              </NavBtn>
              <span style={{ ...styles.navTitle, marginLeft: 4 }}>Settings</span>
            </div>
            <div style={styles.navRight} />
          </div>

          {/* Settings body */}
          <div style={styles.settingsBody}>
            {/* DEVICES section */}
            <div style={styles.secLabel}>Devices</div>

            <div style={styles.settingRow}>
              <span style={styles.settingName}>Camera</span>
              <select
                style={styles.selectWrap}
                value={pendingCamId}
                onChange={(e) => setPendingCamId(e.target.value)}
              >
                {cameras.length === 0 && (
                  <option value="">No cameras found</option>
                )}
                {cameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label.length > 22 ? cam.label.slice(0, 19) + '...' : cam.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.settingRow}>
              <span style={styles.settingName}>Microphone</span>
              <select
                style={styles.selectWrap}
                value={pendingMicId}
                onChange={(e) => setPendingMicId(e.target.value)}
              >
                {microphones.length === 0 && (
                  <option value="">No microphones found</option>
                )}
                {microphones.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label.length > 22 ? mic.label.slice(0, 19) + '...' : mic.label}
                  </option>
                ))}
              </select>
            </div>

            {/* CALENDAR section */}
            <div style={styles.secLabel}>Calendar</div>

            <div style={styles.settingRow}>
              <span style={styles.settingName}>Auto-popup</span>
              <ToggleSwitch
                checked={config.auto_popup_enabled}
                onChange={(v) => updateConfig('auto_popup_enabled', v)}
              />
            </div>

            <div style={{ ...styles.settingRow, borderBottom: 'none' }}>
              <span style={styles.settingName}>Popup before</span>
              <div style={styles.settingVal}>
                <input
                  type="number"
                  style={styles.settingNum}
                  value={config.auto_popup_minutes_before}
                  min={1}
                  max={10}
                  onChange={(e) =>
                    updateConfig('auto_popup_minutes_before', parseInt(e.target.value) || 2)
                  }
                />
                <span style={styles.settingUnit}>min</span>
              </div>
            </div>

            {/* Calendar error */}
            {calStatus.error && (
              <div style={{ fontSize: 11, color: DS.error, padding: '8px 0' }}>
                {calStatus.error}
              </div>
            )}

            {/* Calendar status */}
            {calStatus.connected ? (
              <div style={styles.calStatus}>
                &#10003; Google Calendar connected
              </div>
            ) : (
              <>
                <div style={styles.calStatusOff}>Not connected</div>
                <button
                  style={styles.connectBtn}
                  onClick={connectCalendar}
                  onMouseEnter={(e) => {
                    ;(e.target as HTMLElement).style.background = DS.elevated
                    ;(e.target as HTMLElement).style.borderColor = DS.white
                  }}
                  onMouseLeave={(e) => {
                    ;(e.target as HTMLElement).style.background = DS.bgLight
                    ;(e.target as HTMLElement).style.borderColor = DS.border
                  }}
                >
                  Connect Google Calendar
                </button>
              </>
            )}
          </div>

          {/* Drag region: exclude left back button AND right side */}
          <div style={{ ...styles.dragRegion, left: 80, right: 80 } as DragStyle} />
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function NavBtn({
  onClick,
  title,
  isClose = false,
  children,
  style: extraStyle
}: {
  onClick: () => void
  title: string
  isClose?: boolean
  children: React.ReactNode
  style?: CSSProperties
}): React.JSX.Element {
  return (
    <button
      style={{ ...styles.navBtn, ...extraStyle }}
      title={title}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.borderColor = '#333'
        el.style.color = isClose ? DS.error : DS.white
        el.style.background = DS.bgHover
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.borderColor = DS.border
        el.style.color = DS.textDim
        el.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function ToggleSwitch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div
      style={styles.toggleWrap}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <div
        style={{
          ...styles.toggleBg,
          background: checked ? DS.accent : DS.elevated
        }}
      />
      <div
        style={{
          ...styles.toggleDot,
          left: checked ? 19 : 3,
          background: checked ? DS.white : '#444'
        }}
      />
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

type DragStyle = CSSProperties & { WebkitAppRegion?: string }

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    height: '100vh',
    background: DS.bg,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    color: DS.text,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  },

  view: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    position: 'relative' as const,
    animation: 'meetready-fadeIn 0.2s ease'
  },

  // Nav bar
  navBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 0',
    flexShrink: 0
  },

  navLeft: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flex: 1,
    minWidth: 0
  },

  navRight: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexShrink: 0
  },

  navTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: DS.text
  },

  navBtn: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `1px solid ${DS.border}`,
    background: 'transparent',
    color: DS.textDim,
    cursor: 'pointer',
    fontSize: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0,
    fontFamily: 'inherit',
    padding: 0,
    outline: 'none'
  },

  meetingBadge: {
    fontSize: 10,
    color: DS.white,
    fontWeight: 500,
    padding: '3px 10px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    marginLeft: 4,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 140
  },

  // Main body
  mainBody: {
    flex: 1,
    padding: '16px 24px 20px',
    display: 'flex',
    flexDirection: 'column'
  },

  // Status row
  statusRow: {
    display: 'flex',
    gap: 10,
    marginTop: 14,
    marginBottom: 14
  },

  statusCard: {
    flex: 1,
    background: DS.bgLight,
    borderRadius: 12,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },

  statusLabel: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    color: DS.secLabel
  },

  statusInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 500
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0
  },

  statusText: {
    fontSize: 12,
    fontWeight: 500,
    color: DS.text
  },

  // Readiness banner
  readiness: {
    padding: '14px 16px',
    borderRadius: 12,
    textAlign: 'center' as const,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1,
    marginTop: 'auto'
  },

  // Settings body
  settingsBody: {
    padding: '12px 24px 24px',
    flex: 1,
    overflowY: 'auto' as const
  },

  secLabel: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: '2.5px',
    textTransform: 'uppercase' as const,
    color: DS.secLabel,
    margin: '16px 0 8px'
  },

  settingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: `1px solid ${DS.bgLight}`
  },

  settingName: {
    fontSize: 13,
    color: DS.textGray
  },

  settingVal: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: DS.white
  },

  settingNum: {
    width: 36,
    textAlign: 'center' as const,
    background: 'transparent',
    border: 'none',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 600,
    color: DS.white,
    outline: 'none'
  },

  settingUnit: {
    fontSize: 10,
    color: '#555'
  },

  selectWrap: {
    background: DS.bgLight,
    border: `1px solid ${DS.border}`,
    borderRadius: 8,
    padding: '6px 10px',
    fontFamily: 'inherit',
    fontSize: 11,
    color: DS.white,
    outline: 'none',
    cursor: 'pointer',
    maxWidth: 160,
    WebkitAppearance: 'none' as never
  },

  // Toggle
  toggleWrap: {
    position: 'relative' as const,
    width: 36,
    height: 20,
    cursor: 'pointer'
  },

  toggleBg: {
    position: 'absolute' as const,
    inset: 0,
    borderRadius: 10,
    transition: 'background 0.25s'
  },

  toggleDot: {
    position: 'absolute' as const,
    top: 3,
    width: 14,
    height: 14,
    borderRadius: '50%',
    transition: 'all 0.25s'
  },

  // Calendar status
  calStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '12px 0',
    fontSize: 12,
    color: DS.success
  },

  calStatusOff: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '12px 0',
    fontSize: 12,
    color: '#555'
  },

  connectBtn: {
    padding: '8px 16px',
    border: `1px solid ${DS.border}`,
    borderRadius: 10,
    background: DS.bgLight,
    color: DS.white,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    outline: 'none',
    width: '100%'
  },

  // Drag region base style — left/right overridden per view
  dragRegion: {
    position: 'absolute',
    top: 0,
    height: 60,
    zIndex: 1
  } as DragStyle
}

// Apply WebkitAppRegion after object literal to avoid TS complaint
;(styles.dragRegion as DragStyle).WebkitAppRegion = 'drag'
