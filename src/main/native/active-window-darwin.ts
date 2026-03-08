/**
 * macOS active window tracking via PeakFlowHelper Swift sidecar.
 *
 * Spawns a persistent Swift process and communicates via stdin/stdout
 * JSON-RPC (same pattern as the PowerShell sidecar for SoundSplit).
 *
 * The Swift helper uses CGWindowListCopyWindowInfo + Accessibility API
 * to get window positions and the frontmost application.
 */

import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

// ─── Types (matching the shared interfaces in active-window.ts router) ──────

export interface ActiveWindowInfo {
  hwnd: unknown
  pid: number
  x: number
  y: number
  w: number
  h: number
  title: string
  className: string
}

export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

export interface DisplayBounds {
  x: number
  y: number
  w: number
  h: number
}

// ─── Swift sidecar management ───────────────────────────────────────────────

let helper: ChildProcess | null = null
let pendingData = ''
let requestQueue: Array<{ resolve: (data: string) => void; reject: (err: Error) => void }> = []
let restartTimeout: ReturnType<typeof setTimeout> | null = null

function getHelperPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'peakflow-helper')
  }
  // Dev mode: use the repo-level resources directory, not the compiled out/ tree.
  return join(app.getAppPath(), 'resources', 'darwin', 'peakflow-helper')
}

function ensureHelper(): void {
  if (helper && !helper.killed) return

  const helperPath = getHelperPath()
  try {
    helper = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
  } catch (err) {
    console.error('[ActiveWindow-Darwin] Failed to spawn helper:', err)
    return
  }

  pendingData = ''

  helper.stdout?.setEncoding('utf8')
  helper.stdout?.on('data', (chunk: string) => {
    pendingData += chunk
    processOutput()
  })

  helper.stderr?.setEncoding('utf8')
  helper.stderr?.on('data', (data: string) => {
    console.warn('[ActiveWindow-Darwin] Helper stderr:', data.trim())
  })

  helper.on('exit', (code) => {
    console.warn(`[ActiveWindow-Darwin] Helper exited with code ${code}`)
    helper = null
    // Reject any pending requests
    while (requestQueue.length > 0) {
      const req = requestQueue.shift()!
      req.reject(new Error('Helper process exited'))
    }
    // Auto-restart after delay
    if (!restartTimeout) {
      restartTimeout = setTimeout(() => {
        restartTimeout = null
        ensureHelper()
      }, 2000)
    }
  })
}

function processOutput(): void {
  // Each response is a single line of JSON
  const lines = pendingData.split('\n')
  // Keep the last incomplete line
  pendingData = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const req = requestQueue.shift()
    if (req) {
      req.resolve(trimmed)
    }
  }
}

function sendCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureHelper()
    if (!helper || !helper.stdin) {
      reject(new Error('Helper not available'))
      return
    }

    requestQueue.push({ resolve, reject })
    helper.stdin.write(command + '\n')
  })
}

/** Synchronous wrapper — blocks using a cached result for polling. */
let cachedActiveWindow: ActiveWindowInfo | null = null
let lastActiveWindowTime = 0
const CACHE_TTL_MS = 8 // ~120fps cache, caller polls at 16ms

function sendCommandSync(command: string): string {
  // For synchronous callers, we fire-and-forget and return cached data.
  // This is necessary because the Win32 API is synchronous but the
  // macOS sidecar is async. We warm the cache via a background loop.
  return ''
}

// Background polling loop: keeps cachedActiveWindow fresh
let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const raw = await sendCommand('active-window')
      if (raw === 'null' || raw.startsWith('{\"error\"')) {
        cachedActiveWindow = null
      } else {
        const data = JSON.parse(raw)
        cachedActiveWindow = {
          hwnd: null,
          pid: data.pid,
          x: data.x,
          y: data.y,
          w: data.w,
          h: data.h,
          title: data.title || '',
          className: data.bundleId || ''
        }
      }
      lastActiveWindowTime = Date.now()
    } catch {
      cachedActiveWindow = null
    }
  }, 16) // 60fps polling
}

// ─── Public API (matching active-window-win32.ts exports) ───────────────────

export function getActiveWindow(): ActiveWindowInfo | null {
  startPolling()
  return cachedActiveWindow
}

export function getAllVisibleWindows(filterPid?: number, _displayBounds?: DisplayBounds[]): WindowRect[] {
  // Async: fire command, return cached result keyed by command
  const command = filterPid !== undefined ? `all-windows ${filterPid}` : 'all-windows'
  const cacheKey = command

  let entry = allWindowsCache.get(cacheKey)
  if (!entry) {
    entry = { data: [], inFlight: false }
    allWindowsCache.set(cacheKey, entry)
  }

  if (!entry.inFlight) {
    entry.inFlight = true
    const e = entry // capture for closure
    sendCommand(command).then((raw) => {
      try {
        e.data = JSON.parse(raw) as WindowRect[]
      } catch {
        e.data = []
      }
      e.inFlight = false
    }).catch(() => {
      e.data = []
      e.inFlight = false
    })
  }
  return entry.data
}

const allWindowsCache = new Map<string, { data: WindowRect[]; inFlight: boolean }>()

export function getWindowsForExeNames(exeNames: string[], _displayBounds?: DisplayBounds[]): WindowRect[] {
  // On macOS, exeNames contains bundle IDs. Query for each.
  // Use cached results with async refresh.
  if (!cachedExeWindows.inFlight && exeNames.length > 0) {
    cachedExeWindows.inFlight = true
    // Query the first bundle ID (most common case: single excluded app)
    const promises = exeNames.map(bid => sendCommand(`app-windows ${bid}`))
    Promise.all(promises).then((results) => {
      const allRects: WindowRect[] = []
      for (const raw of results) {
        try {
          const rects = JSON.parse(raw) as WindowRect[]
          allRects.push(...rects)
        } catch { /* skip */ }
      }
      cachedExeWindows.data = allRects
      cachedExeWindows.inFlight = false
    }).catch(() => {
      cachedExeWindows.data = []
      cachedExeWindows.inFlight = false
    })
  }
  return cachedExeWindows.data
}

const cachedExeWindows: { data: WindowRect[]; inFlight: boolean } = { data: [], inFlight: false }

/** PID → bundleId cache */
const pidBundleCache = new Map<number, string>()

export function getProcessExeName(pid: number): string | null {
  const cached = pidBundleCache.get(pid)
  if (cached !== undefined) return cached

  // Async fetch, return null first time
  sendCommand(`process-name ${pid}`).then((raw) => {
    try {
      const data = JSON.parse(raw)
      if (data && data.bundleId) {
        pidBundleCache.set(pid, data.bundleId)
      }
    } catch { /* skip */ }
  }).catch(() => { /* skip */ })

  return null
}

export function clearPidExeCache(): void {
  pidBundleCache.clear()
}

export function getVisibleAppList(_skipSet?: Set<string>): Array<{ exe: string; name: string }> {
  // Async with cache
  if (!cachedAppList.inFlight) {
    cachedAppList.inFlight = true
    sendCommand('visible-apps').then((raw) => {
      try {
        cachedAppList.data = JSON.parse(raw) as Array<{ exe: string; name: string }>
      } catch {
        cachedAppList.data = []
      }
      cachedAppList.inFlight = false
    }).catch(() => {
      cachedAppList.data = []
      cachedAppList.inFlight = false
    })
  }
  return cachedAppList.data
}

const cachedAppList: { data: Array<{ exe: string; name: string }>; inFlight: boolean } = { data: [], inFlight: false }

/** Clean up the helper process. Called on app quit. */
export function destroyHelper(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (restartTimeout) {
    clearTimeout(restartTimeout)
    restartTimeout = null
  }
  if (helper && !helper.killed) {
    helper.stdin?.write('exit\n')
    setTimeout(() => {
      if (helper && !helper.killed) helper.kill()
    }, 500)
  }
}
