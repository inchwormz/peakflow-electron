/**
 * Calendar Service — iCal secret URL.
 *
 * Shared between ScreenSlap (meeting alerts) and MeetReady (pre-meeting prep).
 * Events come from a read-only .ics feed (e.g. Google Calendar's "Secret
 * address in iCal format") — zero-auth, no OAuth. The URL is stored encrypted
 * via credentials.ts (safeStorage / DPAPI).
 */

import { BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import { IPC_SEND } from '@shared/ipc-types'
import { storeOAuthToken, getOAuthToken, deleteOAuthToken } from '../security/credentials'
import * as ical from 'node-ical'

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
  /** Which source is active */
  source: 'ical' | null
  email: string | null
  lastFetched: string | null
  error: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a meeting link from event location or description. */
function detectMeetingLink(location: string, description: string): {
  link: string | null
  service: string | null
} {
  const candidates: string[] = []

  const urlRegex = /https?:\/\/[^\s<>"]+/g
  for (const text of [location, description]) {
    const matches = text.match(urlRegex)
    if (matches) candidates.push(...matches)
  }

  // Classify first match
  for (const url of candidates) {
    if (url.includes('zoom.us') || url.includes('zoom.com'))
      return { link: url, service: 'Zoom' }
    if (url.includes('meet.google.com'))
      return { link: url, service: 'Google Meet' }
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com'))
      return { link: url, service: 'Teams' }
    if (url.includes('webex.com')) return { link: url, service: 'Webex' }
  }

  if (candidates.length > 0) return { link: candidates[0], service: null }
  return { link: null, service: null }
}

/** Safely extract a string from a node-ical ParameterValue (may be string or {val, params}). */
function paramStr(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'val' in val) return String((val as { val: unknown }).val)
  return ''
}

// ─── Service ────────────────────────────────────────────────────────────────

class CalendarService {
  private status: CalendarStatus = {
    connected: false,
    source: null,
    email: null,
    lastFetched: null,
    error: null
  }

  private icalUrl: string | null = null
  private events: CalendarEvent[] = []
  private fetchInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // One-time cleanup: drop tokens from the removed Google OAuth integration
    deleteOAuthToken('google-calendar')

    // Restore iCal URL from encrypted credential store
    const storedIcal = getOAuthToken('calendar-ical-url')
    if (storedIcal) {
      this.icalUrl = storedIcal
      this.status.connected = true
      this.status.source = 'ical'
      console.log('[Calendar] Restored saved iCal URL')
    }
  }

  // ─── iCal URL Methods ──────────────────────────────────────────────────

  /**
   * Set (or clear) an iCal secret URL as the calendar source.
   * Validates URL format and stores it encrypted.
   */
  setIcalUrl(url: string | null): CalendarStatus {
    if (url === null) {
      // Clear iCal
      deleteOAuthToken('calendar-ical-url')
      this.icalUrl = null
      this.events = []
      this.stopPolling()
      this.status = {
        connected: false,
        source: null,
        email: null,
        lastFetched: null,
        error: null
      }
      this.broadcastStatusUpdate()
      this.broadcastEventsUpdate()
      console.log('[Calendar] iCal URL cleared')
      return { ...this.status }
    }

    // Validate URL
    try {
      // Convert webcal:// to https:// for validation
      const normalized = url.replace(/^webcal:\/\//i, 'https://')
      const parsed = new URL(normalized)
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('URL must use https or webcal protocol')
      }
    } catch {
      this.status.error = 'Invalid URL — must be a valid https or webcal URL'
      this.broadcastStatusUpdate()
      return { ...this.status }
    }

    // Store the URL encrypted
    this.icalUrl = url
    storeOAuthToken('calendar-ical-url', url)

    this.status = {
      connected: true,
      source: 'ical',
      email: null,
      lastFetched: null,
      error: null
    }

    console.log('[Calendar] iCal URL set')
    this.broadcastStatusUpdate()

    // Perform initial fetch
    this.fetchEvents().catch((err) => {
      console.error('[Calendar] Initial iCal fetch error:', err)
    })

    return { ...this.status }
  }

  /**
   * Get the currently configured iCal URL (or null).
   */
  getIcalUrl(): string | null {
    return this.icalUrl
  }

  /**
   * Fetch events from an iCal .ics URL.
   */
  private async fetchIcalEvents(): Promise<CalendarEvent[]> {
    if (!this.icalUrl) return []

    // Normalize webcal:// to https://
    const fetchUrl = this.icalUrl.replace(/^webcal:\/\//i, 'https://')

    const data = await ical.async.fromURL(fetchUrl)

    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(23, 59, 59, 999)

    const results: CalendarEvent[] = []

    for (const key of Object.keys(data)) {
      const comp = data[key]
      if (!comp || comp.type !== 'VEVENT') continue

      const event = comp as ical.VEvent

      // Handle recurring events — expand into the date range
      if (event.rrule) {
        const instances = ical.expandRecurringEvent(event, {
          from: now,
          to: tomorrow
        })
        for (const inst of instances) {
          results.push(this.parseIcalInstance(inst, event))
        }
        continue
      }

      // Non-recurring: check if it falls in our window
      const startDate = event.start ? new Date(event.start) : null
      const endDate = event.end ? new Date(event.end) : startDate

      if (!startDate) continue

      // Skip events that ended before now
      if (endDate && endDate.getTime() < now.getTime()) continue
      // Skip events that start after tomorrow
      if (startDate.getTime() > tomorrow.getTime()) continue

      results.push(this.parseIcalEvent(event))
    }

    // Sort by start time
    results.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

    return results
  }

  /**
   * Parse a node-ical VEvent into our CalendarEvent format.
   */
  private parseIcalEvent(event: ical.VEvent): CalendarEvent {
    const allDay = event.datetype === 'date'
    const startTime = event.start ? new Date(event.start).toISOString() : new Date().toISOString()
    const endTime = event.end ? new Date(event.end).toISOString() : startTime

    const startMs = new Date(startTime).getTime()
    const endMs = new Date(endTime).getTime()
    const durationMinutes = Math.round((endMs - startMs) / 60_000)

    const summary = paramStr(event.summary) || '(No title)'
    const location = paramStr(event.location) || null
    const desc = paramStr(event.description) || null
    const truncatedDesc = desc && desc.length > 200 ? desc.slice(0, 200) + '...' : desc

    const { link, service } = detectMeetingLink(location ?? '', desc ?? '')

    return {
      id: event.uid || crypto.randomUUID(),
      summary,
      startTime,
      endTime,
      durationMinutes: allDay ? 0 : durationMinutes,
      meetingLink: link,
      meetingService: service,
      location,
      description: truncatedDesc,
      allDay
    }
  }

  /**
   * Parse an expanded recurring event instance into our CalendarEvent format.
   */
  private parseIcalInstance(instance: ical.EventInstance, _baseEvent: ical.VEvent): CalendarEvent {
    const allDay = instance.isFullDay
    const startTime = new Date(instance.start).toISOString()
    const endTime = new Date(instance.end).toISOString()

    const startMs = new Date(startTime).getTime()
    const endMs = new Date(endTime).getTime()
    const durationMinutes = Math.round((endMs - startMs) / 60_000)

    const summary = paramStr(instance.summary) || '(No title)'
    // Use the underlying event for location/description
    const evt = instance.event
    const location = paramStr(evt.location) || null
    const desc = paramStr(evt.description) || null
    const truncatedDesc = desc && desc.length > 200 ? desc.slice(0, 200) + '...' : desc

    const { link, service } = detectMeetingLink(location ?? '', desc ?? '')

    return {
      id: evt.uid + '-' + startTime,
      summary,
      startTime,
      endTime,
      durationMinutes: allDay ? 0 : durationMinutes,
      meetingLink: link,
      meetingService: service,
      location,
      description: truncatedDesc,
      allDay
    }
  }

  // ─── Shared Methods ─────────────────────────────────────────────────────

  /**
   * Disconnect from calendar. Clears the iCal URL.
   */
  disconnect(): CalendarStatus {
    return this.setIcalUrl(null)
  }

  /**
   * Get current connection status.
   */
  getStatus(): CalendarStatus {
    return { ...this.status }
  }

  /**
   * Fetch upcoming events from the configured iCal feed.
   */
  async fetchEvents(): Promise<CalendarEvent[]> {
    if (!this.status.connected) return []

    try {
      this.events = await this.fetchIcalEvents()
      this.status.lastFetched = new Date().toISOString()
      this.status.error = null

      console.log(`[Calendar] Fetched ${this.events.length} iCal events`)

      this.broadcastEventsUpdate()
      this.broadcastStatusUpdate()

      return [...this.events]
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.status.error = message
      console.error('[Calendar] iCal fetch failed:', message)
      this.broadcastStatusUpdate()
      return []
    }
  }

  /**
   * Get the last fetched events without hitting the feed again.
   */
  getEvents(): CalendarEvent[] {
    return [...this.events]
  }

  /**
   * Start periodic polling for calendar events.
   */
  startPolling(intervalMinutes: number = 10): void {
    this.stopPolling()

    // Initial fetch if connected
    if (this.status.connected) {
      this.fetchEvents().catch((err) => {
        console.error('[Calendar] Initial fetch error:', err)
      })
    }

    const intervalMs = intervalMinutes * 60_000
    this.fetchInterval = setInterval(() => {
      if (this.status.connected) {
        this.fetchEvents().catch((err) => {
          console.error('[Calendar] Polling fetch error:', err)
        })
      }
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
   * Push status changes (connected/error) to all open renderer windows.
   */
  private broadcastStatusUpdate(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.CALENDAR_STATUS_CHANGED, this.status)
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

let instance: CalendarService | null = null

export function getCalendarService(): CalendarService {
  if (!instance) {
    instance = new CalendarService()
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
