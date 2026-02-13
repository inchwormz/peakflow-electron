/**
 * Google Calendar Service — shared between ScreenSlap and MeetReady.
 *
 * CURRENT STATE: Mock implementation for development.
 * When real OAuth is needed, wire in Google OAuth2 via BrowserWindow popup
 * with loopback redirect to localhost (InstalledAppFlow equivalent).
 *
 * Service responsibilities:
 *   - Authentication status tracking
 *   - Fetching upcoming calendar events
 *   - Pushing event updates to renderer via IPC_SEND.CALENDAR_EVENTS_UPDATED
 *
 * The real implementation will need:
 *   1. Google Cloud project with Calendar API enabled
 *   2. OAuth 2.0 Client ID (desktop app type)
 *   3. credentials.json stored in app data directory
 *   4. Token refresh handling
 */

import { BrowserWindow } from 'electron'
import { IPC_SEND } from '@shared/ipc-types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string
  summary: string
  /** ISO string */
  startTime: string
  /** ISO string */
  endTime: string
  /** Duration in minutes */
  durationMinutes: number
  /** Detected meeting link URL, if any */
  meetingLink: string | null
  /** e.g. "Zoom", "Google Meet", "Teams" */
  meetingService: string | null
  /** Raw location field */
  location: string | null
  /** Raw description (truncated) */
  description: string | null
  /** Whether this is an all-day event (skip for alerts) */
  allDay: boolean
}

export interface CalendarStatus {
  connected: boolean
  email: string | null
  lastFetched: string | null
  error: string | null
}

// ─── Mock Data Generator ────────────────────────────────────────────────────

function generateMockEvents(): CalendarEvent[] {
  const now = new Date()

  const makeEvent = (
    id: string,
    summary: string,
    minutesFromNow: number,
    durationMinutes: number,
    meetingLink: string | null,
    meetingService: string | null
  ): CalendarEvent => {
    const start = new Date(now.getTime() + minutesFromNow * 60_000)
    const end = new Date(start.getTime() + durationMinutes * 60_000)
    return {
      id,
      summary,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMinutes,
      meetingLink,
      meetingService,
      location: null,
      description: null,
      allDay: false
    }
  }

  return [
    makeEvent(
      'mock-1',
      'Product Sprint Review',
      3,
      30,
      'https://zoom.us/j/1234567890',
      'Zoom'
    ),
    makeEvent(
      'mock-2',
      'Design Sync',
      63,
      15,
      'https://meet.google.com/abc-defg-hij',
      'Google Meet'
    ),
    makeEvent('mock-3', '1:1 with Sarah', 123, 30, null, null),
    makeEvent(
      'mock-4',
      'Team Retro',
      183,
      45,
      'https://teams.microsoft.com/l/meetup-join/abc123',
      'Teams'
    )
  ]
}

// ─── Service ────────────────────────────────────────────────────────────────

class GoogleCalendarService {
  private status: CalendarStatus = {
    connected: false,
    email: null,
    lastFetched: null,
    error: null
  }

  private events: CalendarEvent[] = []
  private fetchInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Authenticate with Google Calendar.
   *
   * MOCK: Immediately marks as connected with fake email.
   * REAL: Would open a BrowserWindow for OAuth2 consent flow,
   *       receive the auth code via loopback redirect, exchange
   *       for tokens, store in credentials module.
   */
  async authenticate(): Promise<CalendarStatus> {
    console.log('[Calendar] authenticate() called — using mock flow')

    // Simulate a brief auth delay
    await new Promise((resolve) => setTimeout(resolve, 500))

    this.status = {
      connected: true,
      email: 'user@gmail.com',
      lastFetched: null,
      error: null
    }

    // Perform initial fetch after connecting
    await this.fetchEvents()

    console.log('[Calendar] Mock authentication complete')
    return this.status
  }

  /**
   * Disconnect from Google Calendar.
   * Clears tokens and cached events.
   */
  disconnect(): CalendarStatus {
    this.status = {
      connected: false,
      email: null,
      lastFetched: null,
      error: null
    }
    this.events = []
    this.stopPolling()

    console.log('[Calendar] Disconnected')
    return this.status
  }

  /**
   * Get current connection status.
   */
  getStatus(): CalendarStatus {
    return { ...this.status }
  }

  /**
   * Fetch upcoming events from Google Calendar API.
   *
   * MOCK: Returns hardcoded events relative to current time.
   * REAL: Would call calendar.events.list() with the stored credentials.
   */
  async fetchEvents(): Promise<CalendarEvent[]> {
    if (!this.status.connected) {
      return []
    }

    try {
      // MOCK: generate fresh events relative to current time
      this.events = generateMockEvents()
      this.status.lastFetched = new Date().toISOString()
      this.status.error = null

      console.log(
        `[Calendar] Fetched ${this.events.length} events (mock)`
      )

      // Push update to all renderer windows
      this.broadcastEventsUpdate()

      return [...this.events]
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.status.error = message
      console.error('[Calendar] Fetch failed:', message)
      return []
    }
  }

  /**
   * Get the last fetched events without hitting the API again.
   */
  getEvents(): CalendarEvent[] {
    return [...this.events]
  }

  /**
   * Start periodic polling for calendar events.
   * @param intervalMinutes How often to fetch (default: 10)
   */
  startPolling(intervalMinutes: number = 10): void {
    this.stopPolling()

    const intervalMs = intervalMinutes * 60_000
    this.fetchInterval = setInterval(() => {
      this.fetchEvents().catch((err) => {
        console.error('[Calendar] Polling fetch error:', err)
      })
    }, intervalMs)

    console.log(`[Calendar] Polling started (every ${intervalMinutes} min)`)
  }

  /**
   * Stop periodic polling.
   */
  stopPolling(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval)
      this.fetchInterval = null
    }
  }

  /**
   * Push current events to all open renderer windows.
   */
  private broadcastEventsUpdate(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.CALENDAR_EVENTS_UPDATED, this.events)
      }
    }
  }

  /**
   * Cleanup on app shutdown.
   */
  destroy(): void {
    this.stopPolling()
    this.events = []
    console.log('[Calendar] Service destroyed')
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: GoogleCalendarService | null = null

export function getCalendarService(): GoogleCalendarService {
  if (!instance) {
    instance = new GoogleCalendarService()
  }
  return instance
}

export function initCalendar(): void {
  getCalendarService()
  console.log('[Calendar] Service initialized')
}

export function destroyCalendar(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
