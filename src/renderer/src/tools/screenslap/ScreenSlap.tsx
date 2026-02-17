/**
 * ScreenSlap Settings Panel — matches ScreenSlap_Redesign.html.
 *
 * Dark cinematic design system:
 *   - #0a0a0a background, Be Vietnam Pro font
 *   - Blue/green accent gradient bars
 *   - Idle state with "All Clear" + next event preview
 *   - Settings panel: alert timing, sound, monitor, calendar status
 *   - Events panel: today's schedule with meeting badges
 *
 * Communicates with main process via IPC:
 *   - calendar:get-events     → fetch upcoming events
 *   - calendar:authenticate   → connect Google Calendar
 *   - calendar:get-status     → connection status
 *   - calendar:disconnect     → disconnect calendar
 *   - screenslap:get-state    → monitoring state + active alert
 *   - config:get / config:set → persist settings
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'

// ─── Design Tokens (dark cinematic — matches Python COLORS) ─────────────────

const DS = {
  bg: '#0a0a1a',
  surface: '#0a0a0a',
  surface2: '#111111',
  border: '#1a1a2a',
  borderActive: '#333333',
  textPrimary: '#f0f0f5',
  textSecondary: '#888888',
  textMuted: '#666666',
  textDim: '#555555',
  textLabel: '#444444',
  textGhost: '#333333',
  green: '#4ae08a',
  greenBorder: '#22c55e',
  greenBg: '#1a2f2a',
  greenText: '#4ade80',
  blue: '#5eb8ff',
  blueBright: '#0a84ff',
  red: '#f05858',
  redBg: '#2a1515',
  yellow: '#eab308',
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

interface ScreenSlapState {
  monitoring: boolean
  activeAlert: AlertInfo | null
  cachedEventCount: number
  lastFetch: string | null
}

interface AlertInfo {
  eventId: string
  summary: string
  startTime: string
  timeFormatted: string
  timeUntil: string
  meetingLink: string | null
  meetingService: string | null
  durationMinutes: number
}

interface ScreenSlapConfig {
  alert_minutes_before: number
  fetch_interval_minutes: number
  alert_check_seconds: number
  alert_duration_seconds: number
  alert_sound: boolean
  monitor_index: number
}

type ViewMode = 'main' | 'settings' | 'events'

// ─── Helpers ────────────────────────────────────────────────────────────────

const api = window.peakflow

function formatTime(isoStr: string): string {
  const d = new Date(isoStr)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`
}

function formatCountdown(ms: number): string {
  if (ms < 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatRelative(ms: number): string {
  if (ms < 60_000) return 'Starting now!'
  const min = Math.ceil(ms / 60_000)
  if (min === 1) return 'In 1 minute'
  if (min < 60) return `In ${min} minutes`
  const hrs = Math.floor(min / 60)
  const rem = min % 60
  if (hrs === 1 && rem === 0) return 'In 1 hour'
  if (rem === 0) return `In ${hrs} hours`
  return `In ${hrs}h ${rem}m`
}

function formatTimeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  return `${hrs}h ago`
}

function getMeetingBadgeStyle(service: string | null): CSSProperties {
  if (!service) return {}
  const lower = service.toLowerCase()
  if (lower.includes('zoom'))
    return { background: 'rgba(94,184,255,0.15)', color: DS.blue }
  if (lower.includes('meet'))
    return { background: 'rgba(74,224,138,0.15)', color: DS.green }
  if (lower.includes('teams'))
    return { background: 'rgba(94,184,255,0.15)', color: DS.blue }
  return { background: 'rgba(94,184,255,0.15)', color: DS.blue }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ScreenSlap(): React.JSX.Element {
  const [view, setView] = useState<ViewMode>('main')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [calStatus, setCalStatus] = useState<CalendarStatus>({
    connected: false,
    email: null,
    lastFetched: null,
    error: null
  })
  const [state, setState] = useState<ScreenSlapState>({
    monitoring: false,
    activeAlert: null,
    cachedEventCount: 0,
    lastFetch: null
  })
  const [config, setConfig] = useState<ScreenSlapConfig>({
    alert_minutes_before: 1,
    fetch_interval_minutes: 10,
    alert_check_seconds: 30,
    alert_duration_seconds: 60,
    alert_sound: true,
    monitor_index: 0
  })
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [, forceUpdate] = useState(0)

  // ─── Load initial data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [statusRes, eventsRes, stateRes, configRes] = await Promise.all([
        api.invoke(IPC_INVOKE.CALENDAR_GET_STATUS) as Promise<CalendarStatus>,
        api.invoke(IPC_INVOKE.CALENDAR_GET_EVENTS) as Promise<CalendarEvent[]>,
        api.invoke(IPC_INVOKE.SCREENSLAP_GET_STATE) as Promise<ScreenSlapState>,
        api.invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.ScreenSlap }) as Promise<ScreenSlapConfig | null>
      ])
      setCalStatus(statusRes)
      setEvents(eventsRes ?? [])
      setState(stateRes)
      if (configRes) setConfig(configRes)
    } catch (err) {
      console.error('[ScreenSlap UI] Failed to load data:', err)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── IPC listeners ──────────────────────────────────────────────────────

  useEffect(() => {
    const unsubEvents = api.on(IPC_SEND.CALENDAR_EVENTS_UPDATED, (evts: unknown) => {
      setEvents(evts as CalendarEvent[])
    })
    const unsubState = api.on(IPC_SEND.SCREENSLAP_STATE_CHANGED, (s: unknown) => {
      setState(s as ScreenSlapState)
    })
    const unsubCalStatus = api.on(IPC_SEND.CALENDAR_STATUS_CHANGED, (s: unknown) => {
      setCalStatus(s as CalendarStatus)
    })
    return () => {
      unsubEvents()
      unsubState()
      unsubCalStatus()
    }
  }, [])

  // ─── Tick for countdown updates ─────────────────────────────────────────

  useEffect(() => {
    tickRef.current = setInterval(() => forceUpdate((n) => n + 1), 1000)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  // ─── Actions ────────────────────────────────────────────────────────────

  const connectCalendar = async (): Promise<void> => {
    try {
      const result = (await api.invoke(IPC_INVOKE.CALENDAR_AUTHENTICATE)) as CalendarStatus
      setCalStatus(result)
      if (result.connected) {
        showToast('Connected to Google Calendar')
        // Start monitoring now that calendar is connected
        await api.invoke(IPC_INVOKE.SCREENSLAP_START)
        // Refresh events
        const evts = (await api.invoke(IPC_INVOKE.CALENDAR_GET_EVENTS)) as CalendarEvent[]
        setEvents(evts ?? [])
        // Update state
        const stateRes = (await api.invoke(IPC_INVOKE.SCREENSLAP_GET_STATE)) as ScreenSlapState
        setState(stateRes)
      }
    } catch (err) {
      console.error('[ScreenSlap] Auth failed:', err)
    }
  }

  const syncNow = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      const evts = (await api.invoke(IPC_INVOKE.CALENDAR_FETCH_NOW)) as CalendarEvent[]
      setEvents(evts ?? [])
      // Refresh status to get updated lastFetched
      const statusRes = (await api.invoke(IPC_INVOKE.CALENDAR_GET_STATUS)) as CalendarStatus
      setCalStatus(statusRes)
      showToast(`Synced ${evts?.length ?? 0} events`)
    } catch (err) {
      console.error('[ScreenSlap] Sync failed:', err)
      showToast('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const disconnectCalendar = async (): Promise<void> => {
    try {
      const result = (await api.invoke(IPC_INVOKE.CALENDAR_DISCONNECT)) as CalendarStatus
      setCalStatus(result)
      setEvents([])
      showToast('Calendar disconnected')
    } catch (err) {
      console.error('[ScreenSlap] Disconnect failed:', err)
    }
  }

  const updateConfig = async (key: string, value: unknown): Promise<void> => {
    try {
      await api.invoke(IPC_INVOKE.CONFIG_SET, {
        tool: ToolId.ScreenSlap,
        key,
        value
      })
      setConfig((prev) => ({ ...prev, [key]: value }))
    } catch (err) {
      console.error('[ScreenSlap] Config update failed:', err)
    }
  }

  const showToast = (msg: string): void => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

  // ─── Derived state ─────────────────────────────────────────────────────

  const now = Date.now()
  const futureEvents = events
    .filter((e) => !e.allDay && new Date(e.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  const nextEvent = futureEvents[0] ?? null
  const nextDiff = nextEvent
    ? new Date(nextEvent.startTime).getTime() - now
    : null

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* Gradient accent bars */}
      <div style={styles.barTop} />
      <div style={styles.barBot} />

      {/* Radial glow */}
      <div style={styles.glow} />

      {/* Brand */}
      <div style={styles.brand}>
        <div
          style={{
            ...styles.brandDot,
            background: state.activeAlert ? DS.red : calStatus.connected ? DS.green : DS.textDim
          }}
        />
        <span style={styles.brandName}>ScreenSlap</span>
        <span style={styles.brandStatus}>
          {state.activeAlert
            ? 'Alert active'
            : calStatus.connected
              ? 'Watching'
              : 'Disconnected'}
        </span>
      </div>

      {/* Floating buttons */}
      <div style={styles.floatingBtns}>
        <button
          style={styles.floatBtn}
          title="Close"
          onClick={() => api.invoke(IPC_INVOKE.WINDOW_CLOSE)}
          onMouseEnter={(e) => {
            ;(e.target as HTMLElement).style.color = DS.red
          }}
          onMouseLeave={(e) => {
            ;(e.target as HTMLElement).style.color = DS.textMuted
          }}
        >
          &#10005;
        </button>
        <button
          style={styles.floatBtn}
          title="Minimize"
          onClick={() => api.invoke(IPC_INVOKE.WINDOW_MINIMIZE)}
        >
          &#8212;
        </button>
        <button
          style={styles.floatBtn}
          title="Today's Events"
          onClick={() => setView(view === 'events' ? 'main' : 'events')}
        >
          &#128197;
        </button>
        <button
          style={styles.floatBtn}
          title="Settings"
          onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
        >
          &#9881;
        </button>
      </div>

      {/* Main content area */}
      {view === 'main' && (
        <div style={styles.centerContent}>
          {!calStatus.connected ? (
            /* Not connected state */
            <div style={styles.idle}>
              <div style={styles.idleIcon}>&#128197;</div>
              <div style={styles.idleTitle}>Connect Calendar</div>
              <div style={styles.idleSub}>
                Connect your Google Calendar to get full-screen alerts before meetings.
              </div>
              <button style={styles.connectBtn} onClick={connectCalendar}>
                Connect Google Calendar
              </button>
            </div>
          ) : state.activeAlert ? (
            /* Active alert indicator (alert itself is fullscreen in separate window) */
            <div style={styles.idle}>
              <div style={{ ...styles.idleIcon, color: DS.red }}>&#9889;</div>
              <div style={styles.idleTitle}>{state.activeAlert.summary}</div>
              <div style={styles.idleSub}>
                Alert is showing on screen — {state.activeAlert.timeUntil}
              </div>
            </div>
          ) : (
            /* Idle / watching state */
            <div style={styles.idle}>
              <div style={styles.idleIcon}>&#128197;</div>
              <div style={styles.idleTitle}>All Clear</div>
              <div style={styles.idleSub}>
                {nextEvent
                  ? `Next event in ${formatRelative(nextDiff!).toLowerCase().replace('in ', '')}`
                  : 'No upcoming events'}
              </div>

              {nextEvent && nextDiff !== null && (
                <div style={styles.nextPreview}>
                  <div style={styles.nextLabel}>NEXT UP</div>
                  <div style={styles.nextName}>{nextEvent.summary}</div>
                  <div style={styles.nextTime}>
                    {formatTime(nextEvent.startTime)} &mdash;{' '}
                    {formatTime(nextEvent.endTime)}
                  </div>
                  <div style={styles.nextCountdown}>
                    {formatCountdown(nextDiff)}
                  </div>
                </div>
              )}

              {/* Sync controls */}
              <div style={styles.syncRow}>
                <button
                  style={{
                    ...styles.syncBtn,
                    opacity: syncing ? 0.5 : 1,
                    cursor: syncing ? 'default' : 'pointer'
                  }}
                  onClick={syncNow}
                  disabled={syncing}
                >
                  {syncing ? '⟳ Syncing...' : '⟳ Sync Now'}
                </button>
                <div style={styles.syncMeta}>
                  {calStatus.lastFetched
                    ? `Last synced ${formatTimeAgo(calStatus.lastFetched)}`
                    : 'Not synced yet'}
                  <span style={styles.syncInterval}>
                    &nbsp;· every {config.fetch_interval_minutes}m
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings panel */}
      {view === 'settings' && (
        <div style={styles.panelContainer}>
          <div style={styles.panelCard}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>Settings</h2>
              <button
                style={styles.panelClose}
                onClick={() => setView('main')}
              >
                &#10005;
              </button>
            </div>
            <div style={styles.panelSub}>Configure alerts</div>

            <div style={styles.panelBody}>
              {/* Alerts section */}
              <div style={styles.secLabel}>ALERTS</div>

              <SettingRow label="Alert before">
                <div style={styles.settingVal}>
                  <input
                    type="number"
                    style={styles.settingNum}
                    value={config.alert_minutes_before}
                    min={1}
                    max={30}
                    onChange={(e) =>
                      updateConfig(
                        'alert_minutes_before',
                        parseInt(e.target.value) || 1
                      )
                    }
                  />
                  <span style={styles.settingUnit}>min</span>
                </div>
              </SettingRow>

              <SettingRow label="Alert duration">
                <div style={styles.settingVal}>
                  <input
                    type="number"
                    style={styles.settingNum}
                    value={config.alert_duration_seconds}
                    min={10}
                    max={300}
                    onChange={(e) =>
                      updateConfig(
                        'alert_duration_seconds',
                        parseInt(e.target.value) || 60
                      )
                    }
                  />
                  <span style={styles.settingUnit}>sec</span>
                </div>
              </SettingRow>

              <SettingRow label="Alert sound">
                <Toggle
                  checked={config.alert_sound}
                  onChange={(v) => updateConfig('alert_sound', v)}
                />
              </SettingRow>

              {/* Sync section */}
              <div style={styles.secLabel}>SYNC</div>

              <SettingRow label="Sync interval">
                <div style={styles.settingVal}>
                  <select
                    style={styles.selectWrap}
                    value={config.fetch_interval_minutes}
                    onChange={(e) =>
                      updateConfig('fetch_interval_minutes', parseInt(e.target.value))
                    }
                  >
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>
              </SettingRow>

              {/* Calendar section */}
              <div style={styles.secLabel}>CALENDAR</div>

              {calStatus.connected ? (
                <>
                  <div style={styles.calStatusSm}>
                    &#10003; Connected as {calStatus.email}
                  </div>
                  <button style={styles.disconnectBtn} onClick={disconnectCalendar}>
                    Disconnect Calendar
                  </button>
                </>
              ) : (
                <button style={styles.connectBtnSmall} onClick={connectCalendar}>
                  Connect Google Calendar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Events panel */}
      {view === 'events' && (
        <div style={styles.panelContainer}>
          <div style={styles.panelCard}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>Today&apos;s Events</h2>
              <button
                style={styles.panelClose}
                onClick={() => setView('main')}
              >
                &#10005;
              </button>
            </div>
            <div style={styles.panelSub}>
              {events.length} events scheduled
            </div>

            <div style={styles.panelBody}>
              {events.length === 0 ? (
                <div style={styles.emptyEvents}>
                  No events scheduled today
                </div>
              ) : (
                events.map((ev) => {
                  const isPast =
                    new Date(ev.endTime).getTime() < now
                  return (
                    <div
                      key={ev.id}
                      style={{
                        ...styles.eventRow,
                        opacity: isPast ? 0.4 : 1
                      }}
                    >
                      <span style={styles.eventTimeCol}>
                        {formatTime(ev.startTime)} &ndash;{' '}
                        {formatTime(ev.endTime)}
                      </span>
                      <span style={styles.eventNameCol}>
                        {ev.summary}
                      </span>
                      <span style={styles.eventDurCol}>
                        {ev.durationMinutes}m
                      </span>
                      {ev.meetingService && (
                        <span
                          style={{
                            ...styles.eventBadge,
                            ...getMeetingBadgeStyle(ev.meetingService)
                          }}
                        >
                          {ev.meetingService}
                        </span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={styles.toast}>
          {toast}
        </div>
      )}

      {/* Drag region for frameless window */}
      <div style={styles.dragRegion} />
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SettingRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={styles.settingRow}>
      <span style={styles.settingName}>{label}</span>
      {children}
    </div>
  )
}

function Toggle({
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
          background: checked ? DS.green : '#1a1a1a'
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

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    background: DS.bg,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    color: DS.textPrimary,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },

  barTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    background: 'linear-gradient(90deg, #5eb8ff, #4ae08a, #5eb8ff, #4ae08a)',
    backgroundSize: '200% 100%',
    animation: 'barShift 8s ease infinite'
  },

  barBot: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    background: 'linear-gradient(90deg, #4ae08a, #5eb8ff, #4ae08a, #5eb8ff)',
    backgroundSize: '200% 100%',
    animation: 'barShift 8s ease infinite reverse'
  },

  glow: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 400,
    height: 400,
    borderRadius: '50%',
    background:
      'radial-gradient(circle, rgba(94,184,255,0.1) 0%, rgba(74,224,138,0.05) 40%, transparent 70%)',
    pointerEvents: 'none'
  },

  brand: {
    position: 'absolute',
    top: 24,
    left: 28,
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },

  brandDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0
  },

  brandName: {
    fontSize: 16,
    fontWeight: 600,
    color: DS.white,
    letterSpacing: 0.5
  },

  brandStatus: {
    fontSize: 10,
    color: DS.textDim
  },

  floatingBtns: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 50,
    display: 'flex',
    flexDirection: 'row-reverse',
    gap: 8
  },

  floatBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: DS.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.25s',
    WebkitAppRegion: 'no-drag' as unknown as string
  },

  centerContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    width: '100%',
    zIndex: 10
  },

  idle: {
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },

  idleIcon: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.3
  },

  idleTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: DS.white,
    marginBottom: 8
  },

  idleSub: {
    fontSize: 13,
    color: DS.textDim,
    marginBottom: 6,
    maxWidth: 280,
    lineHeight: '1.5'
  },

  nextPreview: {
    marginTop: 20,
    padding: '16px 24px',
    background: 'rgba(255,255,255,0.03)',
    border: `1px solid ${DS.border}`,
    borderRadius: 16,
    display: 'inline-block',
    textAlign: 'center' as const
  },

  nextLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 3,
    textTransform: 'uppercase' as const,
    color: DS.textDim,
    marginBottom: 8
  },

  nextName: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 4,
    color: DS.white
  },

  nextTime: {
    fontSize: 12,
    color: DS.textMuted
  },

  nextCountdown: {
    fontSize: 28,
    fontWeight: 300,
    color: DS.blue,
    marginTop: 10,
    letterSpacing: 2
  },

  syncRow: {
    marginTop: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8
  },

  syncBtn: {
    padding: '8px 20px',
    background: 'rgba(94,184,255,0.12)',
    border: `1px solid rgba(94,184,255,0.25)`,
    borderRadius: 10,
    color: DS.blue,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },

  syncMeta: {
    fontSize: 10,
    color: DS.textDim,
    textAlign: 'center' as const
  },

  syncInterval: {
    color: DS.textGhost
  },

  connectBtn: {
    marginTop: 20,
    padding: '12px 24px',
    background: DS.blueBright,
    color: DS.white,
    border: 'none',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },

  connectBtnSmall: {
    marginTop: 8,
    padding: '10px 16px',
    width: '100%',
    background: DS.blueBright,
    color: DS.white,
    border: 'none',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },

  // Panel
  panelContainer: {
    position: 'absolute',
    inset: 0,
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)'
  },

  panelCard: {
    width: 320,
    maxHeight: '85vh',
    background: DS.surface,
    borderRadius: 24,
    border: `1px solid ${DS.border}`,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 60px rgba(0,0,0,0.5)'
  },

  panelHeader: {
    padding: '20px 24px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },

  panelTitle: {
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
    color: DS.white
  },

  panelClose: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: `1px solid ${DS.border}`,
    background: 'transparent',
    color: DS.textMuted,
    cursor: 'pointer',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    fontFamily: 'inherit'
  },

  panelSub: {
    fontSize: 10,
    color: DS.textDim,
    padding: '2px 24px 14px',
    letterSpacing: 0.5
  },

  panelBody: {
    padding: '0 24px 24px',
    overflowY: 'auto' as const,
    flex: 1
  },

  secLabel: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 2.5,
    textTransform: 'uppercase' as const,
    color: DS.textLabel,
    margin: '16px 0 8px'
  },

  settingRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: `1px solid ${DS.surface2}`
  },

  settingName: {
    fontSize: 13,
    color: DS.textSecondary
  },

  settingVal: {
    display: 'flex',
    alignItems: 'center',
    gap: 6
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
    color: DS.textDim
  },

  selectWrap: {
    background: DS.surface2,
    border: `1px solid ${DS.border}`,
    borderRadius: 8,
    padding: '6px 10px',
    fontFamily: 'inherit',
    fontSize: 11,
    color: DS.white,
    outline: 'none',
    cursor: 'pointer',
    WebkitAppearance: 'none' as unknown as string
  },

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

  calStatusSm: {
    fontSize: 10,
    color: DS.green,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '8px 0'
  },

  disconnectBtn: {
    marginTop: 8,
    padding: '8px 16px',
    width: '100%',
    border: `1px solid ${DS.redBg}`,
    borderRadius: 10,
    background: 'transparent',
    color: DS.red,
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },

  // Events
  eventRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 0',
    borderBottom: `1px solid ${DS.surface2}`
  },

  eventTimeCol: {
    fontSize: 11,
    fontWeight: 600,
    color: DS.textMuted,
    width: 90,
    flexShrink: 0
  },

  eventNameCol: {
    flex: 1,
    fontSize: 13,
    color: '#ccc',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },

  eventDurCol: {
    fontSize: 10,
    color: DS.textLabel,
    flexShrink: 0
  },

  eventBadge: {
    fontSize: 9,
    padding: '2px 8px',
    borderRadius: 10,
    flexShrink: 0
  },

  emptyEvents: {
    textAlign: 'center' as const,
    padding: '30px 10px',
    color: DS.textGhost,
    fontSize: 12,
    lineHeight: '1.6'
  },

  // Toast
  toast: {
    position: 'fixed' as const,
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100,
    padding: '12px 28px',
    borderRadius: 14,
    background: DS.greenBg,
    border: `1px solid ${DS.greenBorder}`,
    color: DS.greenText,
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    fontFamily: 'inherit'
  },

  // Drag region — right: 200 leaves space for all 4 floating buttons
  dragRegion: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 200,
    height: 60,
    WebkitAppRegion: 'drag' as unknown as string,
    zIndex: 1
  }
}
