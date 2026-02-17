/**
 * Google Calendar Service — real OAuth2 implementation.
 *
 * Shared between ScreenSlap (meeting alerts) and MeetReady (pre-meeting prep).
 * Uses Google OAuth2 "installed app" flow via BrowserWindow + loopback redirect.
 * Tokens stored encrypted via credentials.ts (safeStorage / DPAPI).
 *
 * Scopes: https://www.googleapis.com/auth/calendar.readonly
 */

import { BrowserWindow } from 'electron'
import http from 'node:http'
import { IPC_SEND } from '@shared/ipc-types'
import { storeOAuthToken, getOAuthToken, deleteOAuthToken } from '../security/credentials'

// ─── Google OAuth Constants ─────────────────────────────────────────────────

const GOOGLE_CLIENT_ID =
  '366059555078-cqgu209k7m9knq9qm9b2oftfk1cmbcn9.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = 'REDACTED_GOOGLE_SECRET'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REDIRECT_PORT = 28755
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

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

interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  /** Epoch ms when access_token expires */
  expires_at?: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a meeting link from event location, description, or conferenceData. */
function detectMeetingLink(event: Record<string, unknown>): {
  link: string | null
  service: string | null
} {
  const candidates: string[] = []

  // Check hangoutLink / conferenceData first (most reliable)
  if (typeof event.hangoutLink === 'string') candidates.push(event.hangoutLink)

  const confData = event.conferenceData as
    | { entryPoints?: { uri?: string }[] }
    | undefined
  if (confData?.entryPoints) {
    for (const ep of confData.entryPoints) {
      if (ep.uri) candidates.push(ep.uri)
    }
  }

  // Fallback: scan location + description for URLs
  const loc = (event.location as string) || ''
  const desc = (event.description as string) || ''
  const urlRegex = /https?:\/\/[^\s<>"]+/g
  for (const text of [loc, desc]) {
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

// ─── Service ────────────────────────────────────────────────────────────────

class GoogleCalendarService {
  private status: CalendarStatus = {
    connected: false,
    email: null,
    lastFetched: null,
    error: null
  }

  private tokens: GoogleTokens | null = null
  private events: CalendarEvent[] = []
  private fetchInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Restore tokens from encrypted credential store
    const stored = getOAuthToken('google-calendar')
    if (stored) {
      try {
        this.tokens = JSON.parse(stored)
        this.status.connected = true
        console.log('[Calendar] Restored saved Google OAuth tokens')

        // Fetch email in background so UI can display it
        this.fetchUserEmail()
          .then((email) => {
            if (email) {
              this.status.email = email
              this.broadcastStatusUpdate()
            }
          })
          .catch(() => {
            // Non-critical — email will show after next successful fetch
          })
      } catch {
        console.warn('[Calendar] Invalid stored tokens, ignoring')
      }
    }
  }

  /**
   * Authenticate with Google Calendar via OAuth2.
   * Opens BrowserWindow for consent, catches redirect on loopback port.
   */
  async authenticate(): Promise<CalendarStatus> {
    return new Promise((resolve) => {
      let authWindow: BrowserWindow | null = null
      let resolved = false

      const done = (status: CalendarStatus): void => {
        if (resolved) return
        resolved = true
        this.status = status
        server.close()
        if (authWindow && !authWindow.isDestroyed()) authWindow.destroy()
        resolve(status)
      }

      // Temporary HTTP server for OAuth redirect
      const server = http.createServer(async (req, res) => {
        if (!req.url) return

        const url = new URL(req.url, REDIRECT_URI)

        // Ignore favicon requests
        if (url.pathname === '/favicon.ico') {
          res.writeHead(204)
          res.end()
          return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#ff6b6b">Access Denied</h2><p style="color:#888">You can close this window.</p></div></body></html>'
          )
          done({
            connected: false,
            email: null,
            lastFetched: null,
            error: `Google auth error: ${error}`
          })
          return
        }

        if (!code) {
          res.writeHead(400)
          res.end('Missing authorization code')
          return
        }

        // Exchange auth code for tokens
        try {
          const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code'
            })
          })

          if (!tokenRes.ok) {
            const errText = await tokenRes.text()
            throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`)
          }

          const tokenData = (await tokenRes.json()) as GoogleTokens

          // Calculate absolute expiry time
          if (tokenData.expires_in) {
            tokenData.expires_at = Date.now() + tokenData.expires_in * 1000
          }

          this.tokens = tokenData
          storeOAuthToken('google-calendar', JSON.stringify(tokenData))

          // Fetch user email for status display
          const email = await this.fetchUserEmail()

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#4ae08a">Connected to Google Calendar!</h2><p style="color:#888">You can close this window.</p></div></body></html>'
          )

          console.log('[Calendar] Google OAuth authenticated successfully')
          const status: CalendarStatus = {
            connected: true,
            email,
            lastFetched: null,
            error: null
          }
          this.status = status

          // Perform initial fetch
          await this.fetchEvents()

          done(this.status)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Token exchange failed'
          console.error('[Calendar] Auth error:', msg)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#ff6b6b">Authentication Failed</h2><p style="color:#888">Close this window and try again.</p></div></body></html>'
          )
          done({
            connected: false,
            email: null,
            lastFetched: null,
            error: msg
          })
        }
      })

      server.listen(REDIRECT_PORT, () => {
        const authUrl =
          `${GOOGLE_AUTH_URL}?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(SCOPES)}` +
          `&access_type=offline` +
          `&prompt=consent`

        authWindow = new BrowserWindow({
          width: 600,
          height: 700,
          title: 'Connect Google Calendar',
          autoHideMenuBar: true
        })
        authWindow.loadURL(authUrl)

        authWindow.on('closed', () => {
          authWindow = null
          if (!resolved) {
            done({
              connected: false,
              email: null,
              lastFetched: null,
              error: 'Window closed before auth completed'
            })
          }
        })
      })

      server.on('error', (err) => {
        console.error('[Calendar] OAuth callback server error:', err.message)
        done({
          connected: false,
          email: null,
          lastFetched: null,
          error: `Server error: ${err.message}`
        })
      })
    })
  }

  /**
   * Disconnect from Google Calendar. Clears tokens and cached events.
   */
  disconnect(): CalendarStatus {
    deleteOAuthToken('google-calendar')
    this.tokens = null
    this.events = []
    this.stopPolling()

    this.status = {
      connected: false,
      email: null,
      lastFetched: null,
      error: null
    }

    console.log('[Calendar] Disconnected')
    return { ...this.status }
  }

  /**
   * Get current connection status.
   */
  getStatus(): CalendarStatus {
    return { ...this.status }
  }

  /**
   * Fetch upcoming events from Google Calendar API.
   */
  async fetchEvents(): Promise<CalendarEvent[]> {
    if (!this.status.connected || !this.tokens) {
      return []
    }

    try {
      // Ensure token is fresh
      await this.ensureValidToken()

      const now = new Date()
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      // Fetch today's remaining events + tomorrow (for overnight display)
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(23, 59, 59, 999)

      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: tomorrow.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '20',
        fields:
          'items(id,summary,start,end,location,description,hangoutLink,conferenceData)'
      })

      const res = await fetch(
        `${CALENDAR_API}/calendars/primary/events?${params}`,
        {
          headers: { Authorization: `Bearer ${this.tokens.access_token}` }
        }
      )

      if (res.status === 401 || res.status === 403) {
        // Try one refresh
        const refreshed = await this.refreshAccessToken()
        if (!refreshed) {
          this.status.connected = false
          this.status.error = 'Token expired — reconnect Google Calendar'
          this.broadcastStatusUpdate()
          return []
        }
        // Retry
        return this.fetchEvents()
      }

      if (!res.ok) {
        throw new Error(`Calendar API ${res.status}: ${await res.text()}`)
      }

      const data = (await res.json()) as {
        items?: Record<string, unknown>[]
      }

      this.events = (data.items || []).map((item) => this.parseEvent(item))
      this.status.lastFetched = new Date().toISOString()
      this.status.error = null

      console.log(`[Calendar] Fetched ${this.events.length} events`)

      // Push update to all renderer windows
      this.broadcastEventsUpdate()
      this.broadcastStatusUpdate()

      return [...this.events]
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.status.error = message
      console.error('[Calendar] Fetch failed:', message)
      this.broadcastStatusUpdate()
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
   * Ensure the access token is valid, refresh if needed.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.tokens) return

    // Refresh if within 5 minutes of expiry
    if (this.tokens.expires_at && Date.now() > this.tokens.expires_at - 300_000) {
      await this.refreshAccessToken()
    }
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokens?.refresh_token) {
      console.warn('[Calendar] No refresh token available')
      this.status.connected = false
      this.status.error = 'No refresh token — reconnect Google Calendar'
      return false
    }

    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: this.tokens.refresh_token,
          grant_type: 'refresh_token'
        })
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('[Calendar] Token refresh failed:', errText)
        this.status.connected = false
        this.status.error = 'Token refresh failed — reconnect Google Calendar'
        deleteOAuthToken('google-calendar')
        this.tokens = null
        return false
      }

      const refreshed = (await res.json()) as GoogleTokens

      // Merge — refresh response may not include refresh_token
      this.tokens.access_token = refreshed.access_token
      if (refreshed.expires_in) {
        this.tokens.expires_at = Date.now() + refreshed.expires_in * 1000
      }

      // Persist updated tokens
      storeOAuthToken('google-calendar', JSON.stringify(this.tokens))
      console.log('[Calendar] Access token refreshed')
      return true
    } catch (err) {
      console.error('[Calendar] Refresh error:', err)
      return false
    }
  }

  /**
   * Fetch the authenticated user's email for display.
   */
  private async fetchUserEmail(): Promise<string | null> {
    if (!this.tokens) return null

    try {
      const res = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${this.tokens.access_token}` }
        }
      )
      if (!res.ok) return null
      const data = (await res.json()) as { email?: string }
      return data.email || null
    } catch {
      return null
    }
  }

  /**
   * Parse a raw Google Calendar API event into our CalendarEvent format.
   */
  private parseEvent(raw: Record<string, unknown>): CalendarEvent {
    const start = raw.start as { dateTime?: string; date?: string } | undefined
    const end = raw.end as { dateTime?: string; date?: string } | undefined

    const allDay = !start?.dateTime
    const startTime = start?.dateTime || start?.date || new Date().toISOString()
    const endTime = end?.dateTime || end?.date || startTime

    const startMs = new Date(startTime).getTime()
    const endMs = new Date(endTime).getTime()
    const durationMinutes = Math.round((endMs - startMs) / 60_000)

    const { link, service } = detectMeetingLink(raw)

    const desc = raw.description as string | undefined
    const truncatedDesc = desc && desc.length > 200 ? desc.slice(0, 200) + '...' : desc || null

    return {
      id: (raw.id as string) || '',
      summary: (raw.summary as string) || '(No title)',
      startTime,
      endTime,
      durationMinutes: allDay ? 0 : durationMinutes,
      meetingLink: link,
      meetingService: service,
      location: (raw.location as string) || null,
      description: truncatedDesc,
      allDay
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
