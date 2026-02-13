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

import { BrowserWindow, shell } from 'electron'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig } from './config-store'
import { getCalendarService } from './google-calendar'
import type { CalendarEvent } from './google-calendar'
import type { ScreenSlapConfig } from '@shared/config-schemas'
import { createToolWindow, getToolWindow, closeToolWindow } from '../windows'

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
  private alertedEvents = new Set<string>()
  private snoozedEvents = new Map<string, number>() // eventId -> snooze-until timestamp
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private monitoring = false
  private activeAlert: AlertInfo | null = null
  private lastFetch: string | null = null

  /**
   * Start monitoring for upcoming calendar events.
   * Begins the calendar polling and alert checking loops.
   */
  start(): void {
    if (this.monitoring) return

    const config = this.getScreenSlapConfig()
    const calendar = getCalendarService()

    // Start calendar polling (fetches events periodically)
    calendar.startPolling(config.fetch_interval_minutes)

    // Start the alert check loop (checks cached events frequently)
    this.checkInterval = setInterval(() => {
      this.checkForAlerts()
    }, config.alert_check_seconds * 1000)

    // Do an initial fetch
    calendar.fetchEvents().catch((err) => {
      console.error('[ScreenSlap] Initial fetch error:', err)
    })

    this.monitoring = true
    console.log(
      `[ScreenSlap] Monitoring started — alert ${config.alert_minutes_before} min before, check every ${config.alert_check_seconds}s`
    )
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
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
    shell.openExternal(url).catch((err) => {
      console.error('[ScreenSlap] Failed to open meeting link:', err)
    })
    this.dismissAlertWindow()
    console.log(`[ScreenSlap] Joining meeting: ${url}`)
  }

  /**
   * Cleanup on app shutdown.
   */
  destroy(): void {
    this.stop()
    this.alertedEvents.clear()
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
      if (this.snoozedEvents.has(event.id)) continue

      const eventStart = new Date(event.startTime).getTime()
      const minutesUntil = (eventStart - now) / 60_000

      if (minutesUntil >= 0 && minutesUntil <= config.alert_minutes_before) {
        // Time to alert!
        this.triggerAlert(event, minutesUntil)
        break // Only one alert at a time
      }
    }

    // Prune old alerted IDs to prevent memory leak
    if (this.alertedEvents.size > 200) {
      this.alertedEvents.clear()
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
   * Create and show the fullscreen alert BrowserWindow.
   */
  private showAlertWindow(): void {
    // Send alert data to any existing screenslap settings windows
    this.broadcastAlertState()

    // Create the fullscreen alert window
    const alertWin = createToolWindow(SystemWindowId.ScreenSlapAlert)

    // Send the alert data once the window is ready
    alertWin.once('ready-to-show', () => {
      if (!alertWin.isDestroyed() && this.activeAlert) {
        alertWin.webContents.send(IPC_SEND.SCREENSLAP_ALERT_DATA, this.activeAlert)
      }
    })

    // Also send after a small delay in case ready-to-show already fired
    setTimeout(() => {
      if (!alertWin.isDestroyed() && this.activeAlert) {
        alertWin.webContents.send(IPC_SEND.SCREENSLAP_ALERT_DATA, this.activeAlert)
      }
    }, 500)

    // Play alert sound if enabled
    const config = this.getScreenSlapConfig()
    if (config.alert_sound) {
      // On Electron, we can trigger sound from the renderer via the alert window
      // The AlertOverlay component handles playing the notification sound
    }
  }

  /**
   * Close the alert window and clear active alert state.
   */
  private dismissAlertWindow(): void {
    this.activeAlert = null
    closeToolWindow(SystemWindowId.ScreenSlapAlert)
    this.broadcastAlertState()
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
