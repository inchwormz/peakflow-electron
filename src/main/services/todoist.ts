/**
 * Todoist Integration Service — OAuth2 authentication + REST API v2.
 *
 * Pull tasks from Todoist into LiquidFocus, complete tasks back.
 * OAuth flow: BrowserWindow → Todoist consent → loopback redirect → token exchange.
 * Tokens stored encrypted via credentials.ts (safeStorage / DPAPI).
 */

import { BrowserWindow } from 'electron'
import http from 'node:http'
import crypto from 'node:crypto'
import { storeOAuthToken, getOAuthToken, deleteOAuthToken } from '../security/credentials'

// ─── Todoist OAuth Constants ────────────────────────────────────────────────

const TODOIST_CLIENT_ID = 'c69c55b9691e401aad7738af4eae5709'
// SECURITY: Todoist API does not support PKCE — client_secret is required for token exchange.
// This is an inherent limitation for desktop/native OAuth apps (RFC 8252 §8.5).
// The secret MUST be rotated after being exposed in git history.
// Set MAIN_VITE_TODOIST_CLIENT_SECRET in .env (gitignored) for dev/build.
const TODOIST_CLIENT_SECRET = import.meta.env.MAIN_VITE_TODOIST_CLIENT_SECRET || ''
const TODOIST_AUTH_URL = 'https://app.todoist.com/oauth/authorize'
const TODOIST_TOKEN_URL = 'https://api.todoist.com/oauth/access_token'
const REDIRECT_PORT = 28754
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`

// Todoist API v1
const API_BASE = 'https://api.todoist.com/api/v1'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TodoistStatus {
  connected: boolean
  error: string | null
}

export interface TodoistTask {
  id: string
  content: string
  description: string
  projectId: string
  dueDate: string | null
  priority: string
  checked: boolean
}

export interface TodoistProject {
  id: string
  name: string
  color: string
}

// ─── Service ────────────────────────────────────────────────────────────────

class TodoistService {
  private status: TodoistStatus = { connected: false, error: null }
  private accessToken: string | null = null
  private authInProgress = false

  constructor() {
    // Restore token from encrypted credential store
    const stored = getOAuthToken('todoist')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        this.accessToken = parsed.access_token
        this.status.connected = true
        console.log('[PeakFlow] Todoist: restored saved token')
      } catch {
        console.warn('[PeakFlow] Todoist: invalid stored token, ignoring')
      }
    }
  }

  getStatus(): TodoistStatus {
    return { ...this.status }
  }

  /**
   * Launch OAuth2 authorization flow via BrowserWindow.
   * Opens Todoist consent page, catches redirect on loopback, exchanges code for token.
   */
  async authenticate(): Promise<TodoistStatus> {
    if (this.authInProgress) {
      return { connected: false, error: 'Authentication already in progress' }
    }
    this.authInProgress = true

    return new Promise((resolve) => {
      const state = crypto.randomBytes(16).toString('hex')
      let authWindow: BrowserWindow | null = null
      let resolved = false

      const done = (status: TodoistStatus): void => {
        if (resolved) return
        resolved = true
        this.authInProgress = false
        this.status = status
        server.close()
        if (authWindow && !authWindow.isDestroyed()) authWindow.close()
        resolve(status)
      }

      // Temporary HTTP server for OAuth callback
      const server = http.createServer(async (req, res) => {
        if (!req.url) return

        const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
        if (url.pathname !== '/callback') return

        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')

        if (returnedState !== state || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication failed</h2><p>State mismatch. Close this window and try again.</p></body></html>')
          done({ connected: false, error: 'State mismatch' })
          return
        }

        // Exchange authorization code for access token
        try {
          const tokenRes = await fetch(TODOIST_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: TODOIST_CLIENT_ID,
              client_secret: TODOIST_CLIENT_SECRET,
              code,
              redirect_uri: REDIRECT_URI
            })
          })

          if (!tokenRes.ok) {
            const errText = await tokenRes.text()
            throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`)
          }

          const tokenData = (await tokenRes.json()) as { access_token: string }
          this.accessToken = tokenData.access_token

          // Store encrypted
          storeOAuthToken('todoist', JSON.stringify(tokenData))

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body style="background:#0a0a0a;color:#fff;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center">
                  <h2 style="color:#4ae08a">Connected to Todoist!</h2>
                  <p style="color:#888">You can close this window.</p>
                </div>
              </body>
            </html>
          `)

          console.log('[PeakFlow] Todoist: authenticated successfully')
          done({ connected: true, error: null })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Token exchange failed'
          console.error('[PeakFlow] Todoist auth error:', msg)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication failed</h2><p>Close this window and try again.</p></body></html>')
          done({ connected: false, error: msg })
        }
      })

      server.listen(REDIRECT_PORT, () => {
        // Open Todoist OAuth consent page
        const authUrl = `${TODOIST_AUTH_URL}?client_id=${TODOIST_CLIENT_ID}&scope=data:read_write&state=${state}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
        authWindow = new BrowserWindow({
          width: 600,
          height: 700,
          title: 'Connect to Todoist',
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
          }
        })

        // Restrict navigation to known Todoist OAuth domains
        authWindow.webContents.on('will-navigate', (event, navUrl) => {
          try {
            const hostname = new URL(navUrl).hostname
            const allowed = ['todoist.com', 'app.todoist.com', 'api.todoist.com', 'localhost']
            if (!allowed.some((d) => hostname === d || hostname.endsWith('.' + d))) {
              console.warn('[Todoist] Blocked navigation to:', hostname)
              event.preventDefault()
            }
          } catch { event.preventDefault() }
        })

        authWindow.loadURL(authUrl)

        authWindow.on('closed', () => {
          authWindow = null
          if (!resolved) {
            done({ connected: false, error: 'Window closed before auth completed' })
          }
        })
      })

      server.on('error', (err) => {
        console.error('[PeakFlow] Todoist callback server error:', err.message)
        done({ connected: false, error: `Server error: ${err.message}` })
      })
    })
  }

  /**
   * Disconnect from Todoist — deletes stored token.
   */
  disconnect(): TodoistStatus {
    deleteOAuthToken('todoist')
    this.accessToken = null
    this.status = { connected: false, error: null }
    console.log('[PeakFlow] Todoist: disconnected')
    return { ...this.status }
  }

  /**
   * Fetch active tasks from Todoist API v1.
   * Optionally filtered by project ID.
   */
  async getTasks(projectFilter?: string): Promise<TodoistTask[]> {
    if (!this.accessToken) {
      console.log('[Todoist] getTasks: no access token, returning []')
      return []
    }

    try {
      const url = projectFilter
        ? `${API_BASE}/tasks?project_id=${projectFilter}`
        : `${API_BASE}/tasks`

      console.log('[Todoist] getTasks: fetching', url)
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      })
      console.log('[Todoist] getTasks: response status', res.status)

      if (res.status === 401 || res.status === 403) {
        this.status = { connected: false, error: 'Token expired — reconnect Todoist' }
        this.accessToken = null
        deleteOAuthToken('todoist')
        return []
      }

      if (!res.ok) {
        const body = await res.text()
        console.warn('[Todoist] getTasks: API error', res.status, body)
        this.status.error = `Todoist API ${res.status}`
        return []
      }

      const raw = await res.json()
      console.log('[Todoist] getTasks: raw response:', JSON.stringify(raw).slice(0, 500))
      const tasks = Array.isArray(raw) ? raw : (raw as Record<string, unknown>).tasks ?? (raw as Record<string, unknown>).results ?? []
      const taskList = Array.isArray(tasks) ? tasks : []
      console.log('[Todoist] getTasks: got', taskList.length, 'tasks')
      return taskList as TodoistTask[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fetch failed'
      this.status.error = msg
      console.warn('[PeakFlow] Todoist getTasks error:', msg)
      return []
    }
  }

  /**
   * Mark a task as complete in Todoist.
   */
  async completeTask(taskId: string): Promise<boolean> {
    if (!this.accessToken) return false

    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}` }
      })

      if (res.status === 401 || res.status === 403) {
        this.status = { connected: false, error: 'Token expired — reconnect Todoist' }
        return false
      }

      return res.ok || res.status === 204
    } catch (err) {
      console.warn('[PeakFlow] Todoist completeTask error:', err)
      return false
    }
  }

  /**
   * Fetch all projects from Todoist (for project filter dropdown).
   */
  async getProjects(): Promise<TodoistProject[]> {
    if (!this.accessToken) {
      console.log('[Todoist] getProjects: no access token, returning []')
      return []
    }

    try {
      console.log('[Todoist] getProjects: fetching', `${API_BASE}/projects`)
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      })
      console.log('[Todoist] getProjects: response status', res.status)

      if (!res.ok) {
        const body = await res.text()
        console.warn('[Todoist] getProjects: API error', res.status, body)
        return []
      }
      const raw = await res.json()
      console.log('[Todoist] getProjects: raw response:', JSON.stringify(raw).slice(0, 500))
      const projects = Array.isArray(raw) ? raw : (raw as Record<string, unknown>).projects ?? (raw as Record<string, unknown>).results ?? []
      const projectList = Array.isArray(projects) ? projects : []
      console.log('[Todoist] getProjects: got', projectList.length, 'projects')
      return projectList as TodoistProject[]
    } catch (err) {
      console.warn('[Todoist] getProjects error:', err)
      return []
    }
  }

  destroy(): void {
    // No polling or timers to clean up
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let service: TodoistService | null = null

export function initTodoist(): void {
  if (service) return
  service = new TodoistService()
  console.log('[PeakFlow] Todoist service initialized')
}

export function getTodoistService(): TodoistService {
  if (!service) {
    service = new TodoistService()
  }
  return service
}

export function destroyTodoist(): void {
  if (service) {
    service.destroy()
    service = null
    console.log('[PeakFlow] Todoist service destroyed')
  }
}
