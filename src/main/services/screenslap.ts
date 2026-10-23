/**
 * ScreenSlap Alert Service — manages alert scheduling and display.
 *
 * Direct port of Python ScreenSlapApp (in_your_face.py lines 606-921):
 *   - Polls GoogleCalendarService for events at configurable interval
 *   - Checks cached events every N seconds for imminent alerts
 *   - Opens fullscreen alert window when a meeting is within alert threshold
 *   - Handles snooze (re-alerts after delay), dismiss, join meeting
 *   - Tracks alerted + snoozed event IDs to avoid duplicate alerts
 *
 * The alert window itself is a separate BrowserWindow loaded with
 * ?toolId=screenslap-alert, rendered by AlertOverlay.tsx.
 */

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig } from './config-store'
import { getCalendarService } from './google-calendar'
import type { CalendarEvent } from './google-calendar'
import type { ScreenSlapConfig } from '@shared/config-schemas'
import { checkAccess } from '../security/access-check'
import { withToolAccess } from '../security/access-guard'

/** Alerts and calendar monitoring need ScreenSlap access (trial or licence). */
const withAccess = <T>(action: () => T, denied: () => T): Promise<T> =>
  withToolAccess(checkAccess, ToolId.ScreenSlap, action, denied)

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScreenSlapState {
  /** Whether the monitoring loop is running */
  monitoring: boolean
  /** Currently active alert event, if any */
  activeAlert: AlertInfo | null
  /** Number of events in cache */
  cachedEventCount: number
  /** Timestamp of last calendar fetch */
  lastFetch: string | null
}

export interface AlertInfo {
  eventId: string
  summary: string
  startTime: string
  timeFormatted: string
  timeUntil: string
  meetingLink: string | null
  meetingService: string | null
  durationMinutes: number
}

// ─── Service ────────────────────────────────────────────────────────────────

class ScreenSlapService {
  /** Meetings whose alert was shown */
  private alertedEvents = new Set<string>()
  /** Meetings whose access check is in flight (not shown yet) */
  private pendingEvents = new Set<string>()
  private snoozedEvents = new Map<string, number>() // eventId -> snooze-until timestamp
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private alertWindows: BrowserWindow[] = []
  private monitoring = false
  private activeAlert: AlertInfo | null = null
  private lastFetch: string | null = null
  /** Bumped by stop/destroy, so a start still waiting for its access check is dropped */
  private startToken = 0

  /**
   * Start monitoring for upcoming calendar events, if ScreenSlap is allowed
   * (an expired, unlicensed trial gets no polling and no alerts).
   */
  start(): Promise<void> {
    if (this.monitoring) return Promise.resolve()
    const token = ++this.startToken
    return withAccess(
      () => {
        if (token === this.startToken) this.startMonitoring()
      },
      () => console.log('[ScreenSlap] No access (trial ended) — not monitoring')
    )
  }

  /**
   * Access re-check before every calendar poll: once the trial ends without a
   * licence, monitoring stops (a licence activation starts it again).
   */
  private pollAllowed = async (): Promise<boolean> => {
    const ok = await withAccess(() => true, () => false)
    if (!ok && this.monitoring) {
      console.log('[ScreenSlap] No access (trial ended) — stopping monitoring')
      this.stop()
    }
    return ok
  }

  /** Begins the calendar polling and alert checking loops. */
  private startMonitoring(): void {
    if (this.monitoring) return

    const config = this.getScreenSlapConfig()
    const calendar = getCalendarService()

    // Don't start polling if calendar isn't connected — nothing to fetch
    if (!calendar.getStatus().connected) {
      console.log('[ScreenSlap] Calendar not connected — skipping start')
      return
    }

    // Start calendar polling (includes initial fetch + periodic refresh)
    calendar.startPolling(config.fetch_interval_minutes, this.pollAllowed)

    // Start the alert check loop (checks cached events frequently)
    this.checkInterval = setInterval(() => {
      this.checkForAlerts()
    }, config.alert_check_seconds * 1000)

    this.monitoring = true
    console.log(
      `[ScreenSlap] Monitoring started — alert ${config.alert_minutes_before} min before, check every ${config.alert_check_seconds}s`
    )
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    this.startToken++ // a start waiting for access must not begin after this
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    getCalendarService().stopPolling()
    this.monitoring = false
    console.log('[ScreenSlap] Monitoring stopped')
  }

  /**
   * Get current state for the renderer.
   */
  getState(): ScreenSlapState {
    return {
      monitoring: this.monitoring,
      activeAlert: this.activeAlert,
      cachedEventCount: getCalendarService().getEvents().length,
      lastFetch: this.lastFetch
    }
  }

  /**
   * Snooze the current alert for the given number of minutes.
   */
  snooze(eventId: string, minutes: number): void {
    const snoozeUntil = Date.now() + minutes * 60_000
    this.snoozedEvents.set(eventId, snoozeUntil)
    this.alertedEvents.delete(eventId) // Allow re-alert after snooze

    // Close the alert window
    this.dismissAlertWindow()

    console.log(`[ScreenSlap] Snoozed ${eventId} for ${minutes} min`)
  }

  /**
   * Dismiss the current alert without snoozing.
   */
  dismiss(): void {
    this.dismissAlertWindow()
    console.log('[ScreenSlap] Alert dismissed')
  }

  /**
   * Open the meeting link in the default browser and dismiss.
   */
  joinMeeting(url: string): void {
    // Only allow https:// URLs to prevent protocol handler attacks (file://, ms-msdt:, etc.)
    if (!url.startsWith('https://')) {
      console.warn('[ScreenSlap] Blocked non-HTTPS meeting link:', url)
      return
    }
    shell.openExternal(url).catch((err) => {
      console.error('[ScreenSlap] Failed to open meeting link:', err)
    })
    this.dismissAlertWindow()
    console.log(`[ScreenSlap] Joining meeting: ${url}`)
  }

  /**
   * Re-read config and restart polling with updated interval.
   * Called when settings are changed from the renderer.
   */
  refreshConfig(): void {
    if (!this.monitoring) return
    const config = this.getScreenSlapConfig()
    const calendar = getCalendarService()

    // Restart polling with new interval
    calendar.startPolling(config.fetch_interval_minutes, this.pollAllowed)

    // Restart alert check loop with new check interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }
    this.checkInterval = setInterval(() => {
      this.checkForAlerts()
    }, config.alert_check_seconds * 1000)

    console.log(
      `[ScreenSlap] Config refreshed — alert ${config.alert_minutes_before} min before, check every ${config.alert_check_seconds}s, fetch every ${config.fetch_interval_minutes}m`
    )
  }

  /**
   * Fire a fake alert for testing always-on-top behaviour.
   */
  testAlert(): Promise<void> {
    return withAccess(() => this.fireTestAlert(), () => {})
  }

  private fireTestAlert(): void {
    const now = new Date()
    const fakeEvent: CalendarEvent = {
      id: `test-${Date.now()}`,
      summary: 'Test alert', // v2 screenslap: plain title, no emoji (John, 19 Oct)
      startTime: new Date(now.getTime() + 60_000).toISOString(),
      endTime: new Date(now.getTime() + 31 * 60_000).toISOString(),
      durationMinutes: 30,
      allDay: false,
      meetingLink: null,
      meetingService: null,
      location: null,
      description: null
    }
    this.triggerAlert(fakeEvent, 1)
    console.log('[ScreenSlap] Test alert triggered')
  }

  /**
   * Cleanup on app shutdown.
   */
  destroy(): void {
    this.stop()
    this.alertedEvents.clear()
    this.pendingEvents.clear()
    this.snoozedEvents.clear()
    this.activeAlert = null
    console.log('[ScreenSlap] Service destroyed')
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private getScreenSlapConfig(): ScreenSlapConfig {
    return getConfig(ToolId.ScreenSlap) as ScreenSlapConfig
  }

  /**
   * Core alert check loop — runs every alert_check_seconds.
   * Scans cached events and triggers alerts for imminent meetings.
   */
  private checkForAlerts(): void {
    const config = this.getScreenSlapConfig()
    const events = getCalendarService().getEvents()
    const now = Date.now()

    // Clean expired snoozes
    for (const [eventId, until] of this.snoozedEvents) {
      if (now >= until) {
        this.snoozedEvents.delete(eventId)
      }
    }

    for (const event of events) {
      if (event.allDay) continue
      if (this.alertedEvents.has(event.id)) continue
      if (this.pendingEvents.has(event.id)) continue
      if (this.snoozedEvents.has(event.id)) continue

      const eventStart = new Date(event.startTime).getTime()
      const eventEnd = eventStart + event.durationMinutes * 60_000
      const minutesUntil = (eventStart - now) / 60_000

      // Alert if: within the alert window OR meeting has started but not ended
      // (covers snoozed events that pass their start time)
      if (minutesUntil <= config.alert_minutes_before && now < eventEnd) {
        // Time to alert, if ScreenSlap is still allowed (the trial may have
        // ended since monitoring started). Pending while the check runs; only
        // marked alerted once shown, so a meeting denied now can still alert
        // after a licence is activated.
        this.pendingEvents.add(event.id)
        const token = this.startToken
        void withAccess(
          () => {
            // Stopped while the check ran: don't show it
            if (token === this.startToken) this.triggerAlert(event, Math.max(0, minutesUntil))
          },
          () => {
            console.log('[ScreenSlap] Alert skipped: no access (trial ended) — stopping monitoring')
            this.stop()
          }
        ).finally(() => this.pendingEvents.delete(event.id))
        break // Only one alert at a time
      }
    }

    // Prune old alerted IDs to prevent memory leak.
    // Keep IDs for currently cached events to avoid re-alerting ongoing meetings.
    if (this.alertedEvents.size > 200) {
      const activeIds = new Set(events.map((e) => e.id))
      for (const id of this.alertedEvents) {
        if (!activeIds.has(id)) this.alertedEvents.delete(id)
      }
    }
  }

  /**
   * Show the fullscreen alert window for an event.
   */
  private triggerAlert(event: CalendarEvent, minutesUntil: number): void {
    const startDate = new Date(event.startTime)
    const timeFormatted = this.formatTime(startDate)
    const timeUntil =
      minutesUntil < 1 ? 'Starting now!' : `In ${Math.ceil(minutesUntil)} min`

    this.activeAlert = {
      eventId: event.id,
      summary: event.summary,
      startTime: event.startTime,
      timeFormatted,
      timeUntil,
      meetingLink: event.meetingLink,
      meetingService: event.meetingService,
      durationMinutes: event.durationMinutes
    }

    this.alertedEvents.add(event.id)

    const logSuffix = event.meetingService
      ? ` — ${event.meetingService} link detected`
      : ''
    console.log(
      `[ScreenSlap] ALERT: ${event.summary} at ${timeFormatted} (${timeUntil})${logSuffix}`
    )

    // Open fullscreen alert window
    this.showAlertWindow()

    // Auto-dismiss after alert_duration_seconds
    const config = this.getScreenSlapConfig()
    setTimeout(() => {
      // Only auto-dismiss if this alert is still active
      if (this.activeAlert?.eventId === event.id) {
        this.dismiss()
      }
    }, config.alert_duration_seconds * 1000)
  }

  /**
   * Create fullscreen alert windows on ALL displays.
   * Each display gets its own BrowserWindow so the alert covers every monitor.
   */
  private showAlertWindow(): void {
    // Send alert data to any existing screenslap settings windows
    this.broadcastAlertState()

    // Close any lingering alert windows from a previous alert
    this.closeAllAlertWindows()

    // v2 screenslap: honour monitor_index ("Show the alert on"). -1 (the
    // default) or an index that no longer exists means every display.
    const allDisplays = screen.getAllDisplays()
    const monitorIndex = Number(this.getScreenSlapConfig().monitor_index)
    const displays =
      Number.isInteger(monitorIndex) && monitorIndex >= 0 && monitorIndex < allDisplays.length
        ? [allDisplays[monitorIndex]]
        : allDisplays
    const preloadPath = join(__dirname, '../preload/index.js')
    const toolId = SystemWindowId.ScreenSlapAlert

    for (const display of displays) {
      const { x, y, width, height } = display.bounds

      const win = new BrowserWindow({
        x,
        y,
        width,
        height,
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        frame: false,
        show: false,
        backgroundColor: '#08080a',
        webPreferences: {
          preload: preloadPath,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      // Load renderer
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?toolId=${toolId}`)
      } else {
        win.loadFile(join(__dirname, '../renderer/index.html'), { query: { toolId } })
      }

      win.once('ready-to-show', () => {
        win.show()
        // Correct size mismatch on portrait/scaled monitors where Electron
        // may clamp the window dimensions or fail to enter fullscreen.
        // Must run AFTER show — Windows ignores setBounds on hidden windows.
        if (!win.isDestroyed()) {
          const actual = win.getBounds()
          if (actual.width !== width || actual.height !== height) {
            console.warn(
              `[ScreenSlap] Alert size mismatch: requested ${width}x${height}, ` +
                `got ${actual.width}x${actual.height} — correcting`
            )
            win.setBounds({ x, y, width, height })
          }
          if (!win.isFullScreen()) {
            console.warn(`[ScreenSlap] Window not fullscreen after show — re-applying`)
            win.setFullScreen(true)
          }
        }
        // 'screen-saver' level keeps alerts above Chrome, Claude, fullscreen apps.
        // Re-assert on blur/show/restore — Windows silently drops alwaysOnTop.
        const pinAbove = (): void => {
          if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver')
        }
        pinAbove()
        win.on('blur', pinAbove)
        win.on('show', pinAbove)
        win.on('restore', pinAbove)

        if (!win.isDestroyed() && this.activeAlert) {
          win.webContents.send(IPC_SEND.SCREENSLAP_ALERT_DATA, this.activeAlert)
        }
      })

      // Fallback send in case ready-to-show already fired
      setTimeout(() => {
        if (!win.isDestroyed() && this.activeAlert) {
          win.webContents.send(IPC_SEND.SCREENSLAP_ALERT_DATA, this.activeAlert)
        }
      }, 500)

      win.on('closed', () => {
        this.alertWindows = this.alertWindows.filter((w) => w !== win)
      })

      this.alertWindows.push(win)
    }

    console.log(`[ScreenSlap] Alert windows opened on ${displays.length} display(s)`)
  }

  /**
   * Close all alert windows and clear active alert state.
   */
  private dismissAlertWindow(): void {
    this.activeAlert = null
    this.closeAllAlertWindows()
    this.broadcastAlertState()
  }

  /**
   * Close every open alert BrowserWindow.
   */
  private closeAllAlertWindows(): void {
    for (const win of this.alertWindows) {
      if (!win.isDestroyed()) win.close()
    }
    this.alertWindows = []
  }

  /**
   * Broadcast alert state to all ScreenSlap settings windows.
   */
  private broadcastAlertState(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.SCREENSLAP_STATE_CHANGED, this.getState())
      }
    }
  }

  /**
   * Format a Date into "h:mm AM/PM" style.
   */
  private formatTime(date: Date): string {
    let hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    const minuteStr = minutes.toString().padStart(2, '0')
    return `${hours}:${minuteStr} ${ampm}`
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: ScreenSlapService | null = null

export function getScreenSlapService(): ScreenSlapService {
  if (!instance) {
    instance = new ScreenSlapService()
  }
  return instance
}

export function initScreenSlap(): void {
  const service = getScreenSlapService()
  // Auto-start monitoring
  service.start()
  console.log('[ScreenSlap] Service initialized')
}

export function destroyScreenSlap(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
