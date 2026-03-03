/**
 * Calendar Service — Google OAuth + iCal URL support.
 *
 * Shared between ScreenSlap (meeting alerts) and MeetReady (pre-meeting prep).
 * Two fetch paths:
 *   1. Google OAuth2 via system browser + loopback redirect (existing)
 *   2. iCal secret URL — zero-auth, read-only .ics feed (new)
 *
 * Only one source active at a time. CalendarEvent shape is identical from both.
 * Tokens/URLs stored encrypted via credentials.ts (safeStorage / DPAPI).
 */

import { shell, BrowserWindow } from 'electron'
import http from 'node:http'
import crypto from 'node:crypto'
import { IPC_SEND } from '@shared/ipc-types'
import { storeOAuthToken, getOAuthToken, deleteOAuthToken } from '../security/credentials'
import * as ical from 'node-ical'

// ─── Google OAuth Constants ─────────────────────────────────────────────────

const GOOGLE_CLIENT_ID =
  '366059555078-cqgu209k7m9knq9qm9b2oftfk1cmbcn9.apps.googleusercontent.com'
// Google requires client_secret for Desktop app token exchange, even with PKCE.
// Store in .env as MAIN_VITE_GOOGLE_CLIENT_SECRET (gitignored).
const GOOGLE_CLIENT_SECRET = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET || ''
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
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
  /** Which source is active */
  source: 'google' | 'ical' | null
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

// ─── PKCE Helpers ──────────────────────────────────────────────────────────

/** Generate a cryptographically random code_verifier for PKCE (43-128 chars, base64url). */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** Derive the code_challenge from a code_verifier using SHA-256 + base64url. */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
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

/** Safely extract a string from a node-ical ParameterValue (may be string or {val, params}). */
function paramStr(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'val' in val) return String((val as { val: unknown }).val)
  return ''
}

// ─── Service ────────────────────────────────────────────────────────────────

class GoogleCalendarService {
  private status: CalendarStatus = {
    connected: false,
    source: null,
    email: null,
    lastFetched: null,
    error: null
  }

  private tokens: GoogleTokens | null = null
  private icalUrl: string | null = null
  private events: CalendarEvent[] = []
  private fetchInterval: ReturnType<typeof setInterval> | null = null
  private authInProgress = false

  constructor() {
    // Restore iCal URL from encrypted credential store
    const storedIcal = getOAuthToken('calendar-ical-url')
    if (storedIcal) {
      this.icalUrl = storedIcal
      this.status.connected = true
      this.status.source = 'ical'
      console.log('[Calendar] Restored saved iCal URL')
      return // iCal takes priority — don't also restore Google tokens
    }

    // Restore Google OAuth tokens from encrypted credential store
    const stored = getOAuthToken('google-calendar')
    if (stored) {
      try {
        this.tokens = JSON.parse(stored)
        this.status.connected = true
        this.status.source = 'google'
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

  // ─── iCal URL Methods ──────────────────────────────────────────────────

  /**
   * Set (or clear) an iCal secret URL as the calendar source.
   * Validates URL format, stores encrypted, disconnects Google if active.
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

    // Disconnect Google if connected
    if (this.tokens) {
      deleteOAuthToken('google-calendar')
      this.tokens = null
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

    // Detect meeting links from location + description
    const { link, service } = detectMeetingLink({
      location: location ?? '',
      description: desc ?? ''
    })

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

    const { link, service } = detectMeetingLink({
      location: location ?? '',
      description: desc ?? ''
    })

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

  // ─── Google OAuth ───────────────────────────────────────────────────────

  /**
   * Authenticate with Google Calendar via OAuth2.
   * Opens BrowserWindow (with clean user agent) for consent, catches redirect on loopback port.
   */
  async authenticate(): Promise<CalendarStatus> {
    if (this.authInProgress) {
      return { connected: false, source: null, email: null, lastFetched: null, error: 'Authentication already in progress' }
    }
    this.authInProgress = true

    return new Promise((resolve) => {
      let resolved = false
      const oauthState = crypto.randomBytes(16).toString('hex')
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = generateCodeChallenge(codeVerifier)

      const done = (status: CalendarStatus): void => {
        if (resolved) return
        resolved = true
        this.authInProgress = false
        this.status = status
        server.close()
        resolve(status)
      }

      // Temporary HTTP server for OAuth redirect
      const server = http.createServer(async (req, res) => {
        if (!req.url) return

        const url = new URL(req.url, REDIRECT_URI)
        console.log('[Calendar] OAuth server received request:', req.url)

        // Ignore favicon and other non-callback requests
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (!code && !error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Waiting for Google authorization...</h2><p style="color:#888">Complete sign-in in your browser.</p></div></body></html>')
          return
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#ff6b6b">Access Denied</h2><p style="color:#888">You can close this window.</p></div></body></html>'
          )
          done({
            connected: false,
            source: null,
            email: null,
            lastFetched: null,
            error: `Google auth error: ${error}`
          })
          return
        }

        // Validate state parameter (CSRF protection)
        const returnedState = url.searchParams.get('state')
        if (returnedState !== oauthState) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication failed</h2><p>State mismatch. Close this window and try again.</p></body></html>')
          done({ connected: false, source: null, email: null, lastFetched: null, error: 'State mismatch' })
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
              code_verifier: codeVerifier,
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
          // Clear any iCal URL if switching to Google
          if (this.icalUrl) {
            deleteOAuthToken('calendar-ical-url')
            this.icalUrl = null
          }
          const status: CalendarStatus = {
            connected: true,
            source: 'google',
            email,
            lastFetched: null,
            error: null
          }
          this.status = status
          done(this.status)

          // Fetch events in the background — don't block auth
          this.fetchEvents().catch((fetchErr) => {
            console.error('[Calendar] Initial event fetch failed:', fetchErr)
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Token exchange failed'
          console.error('[Calendar] Auth error:', msg)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#ff6b6b">Authentication Failed</h2><p style="color:#888">Close this window and try again.</p></div></body></html>'
          )
          done({
            connected: false,
            source: null,
            email: null,
            lastFetched: null,
            error: msg
          })
        }
      })

      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        const authUrl =
          `${GOOGLE_AUTH_URL}?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(SCOPES)}` +
          `&access_type=offline` +
          `&prompt=consent` +
          `&state=${oauthState}` +
          `&code_challenge=${codeChallenge}` +
          `&code_challenge_method=S256`

        // Open in system browser (Chrome) — Google blocks embedded Electron browsers
        shell.openExternal(authUrl)
        console.log('[Calendar] Opened system browser for Google OAuth')

        // Timeout if user doesn't complete auth within 5 minutes
        setTimeout(() => {
          if (!resolved) {
            done({
              connected: false,
              source: null,
              email: null,
              lastFetched: null,
              error: 'Authentication timed out — please try again'
            })
          }
        }, 5 * 60 * 1000)
      })

      server.on('error', (err) => {
        console.error('[Calendar] OAuth callback server error:', err.message)
        done({
          connected: false,
          source: null,
          email: null,
          lastFetched: null,
          error: `Server error: ${err.message}`
        })
      })
    })
  }

  // ─── Shared Methods ─────────────────────────────────────────────────────

  /**
   * Disconnect from calendar. Clears both Google tokens and iCal URL.
   */
  disconnect(): CalendarStatus {
    deleteOAuthToken('google-calendar')
    deleteOAuthToken('calendar-ical-url')
    this.tokens = null
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
   * Fetch upcoming events — routes to Google API or iCal depending on source.
   */
  async fetchEvents(retried = false): Promise<CalendarEvent[]> {
    if (!this.status.connected) return []

    // Route by source
    if (this.status.source === 'ical') {
      return this.fetchIcalEventsWrapper()
    }

    return this.fetchGoogleEvents(retried)
  }

  /**
   * Wrapper for iCal fetch with error handling + broadcast.
   */
  private async fetchIcalEventsWrapper(): Promise<CalendarEvent[]> {
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
   * Fetch upcoming events from Google Calendar API.
   */
  private async fetchGoogleEvents(retried = false): Promise<CalendarEvent[]> {
    if (!this.tokens) return []

    try {
      // Ensure token is fresh
      await this.ensureValidToken()

      const now = new Date()

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
        if (retried) {
          this.status.connected = false
          this.status.error = 'Token expired — reconnect Google Calendar'
          this.broadcastStatusUpdate()
          return []
        }
        const refreshed = await this.refreshAccessToken()
        if (!refreshed) {
          this.status.connected = false
          this.status.error = 'Token expired — reconnect Google Calendar'
          this.broadcastStatusUpdate()
          return []
        }
        return this.fetchGoogleEvents(true)
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
