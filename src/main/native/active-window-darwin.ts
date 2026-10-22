/**
 * macOS active window tracking via PeakFlowHelper Swift sidecar.
 *
 * Spawns a persistent Swift process and communicates via stdin/stdout
 * JSON-RPC (same pattern as the PowerShell sidecar for SoundSplit).
 *
 * The Swift helper uses CGWindowListCopyWindowInfo + Accessibility API
 * to get window positions and the frontmost application.
 */

import { getMacHelperPath } from './mac-helper'
import { HelperClient, isValidBundleId, isValidPid } from './helper-client'

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

const helperClient = new HelperClient({
  getPath: getMacHelperPath,
  requestTimeoutMs: 1000,
  log: (level, message) => console[level](`[ActiveWindow-Darwin] ${message}`)
})

function sendCommand(command: string): Promise<string> {
  return helperClient.send(command)
}

let cachedActiveWindow: ActiveWindowInfo | null = null
/** The last app other than PeakFlow seen in front, to hand focus back to. */
let lastOtherAppPid = 0

// Background polling loop: keeps cachedActiveWindow fresh. At most one
// active-window request is in flight, so a slow Accessibility call can never
// pile up requests behind it.
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false

function startPolling(): void {
  if (pollTimer || helperClient.isDestroyed) return
  pollTimer = setInterval(() => {
    if (pollInFlight) return
    pollInFlight = true
    sendCommand('active-window').then((raw) => {
      if (raw === 'null' || raw.startsWith('{"error"')) {
        cachedActiveWindow = null
      } else {
        const data = JSON.parse(raw)
        if (data.pid !== process.pid) lastOtherAppPid = data.pid
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
    }).catch(() => {
      cachedActiveWindow = null
    }).finally(() => {
      pollInFlight = false
    })
  }, 16) // 60fps polling
}

// ─── Public API (matching active-window-win32.ts exports) ───────────────────

export function getActiveWindow(): ActiveWindowInfo | null {
  startPolling()
  return cachedActiveWindow
}

export function getAllVisibleWindows(filterPid?: number, _displayBounds?: DisplayBounds[]): WindowRect[] {
  // Async: fire command, return cached result keyed by command
  if (filterPid !== undefined && !isValidPid(filterPid)) return []
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
  // Bundle IDs go into a helper command line: only letters, digits, dots, hyphens.
  const bundleIds = exeNames.filter((bid) => {
    if (isValidBundleId(bid)) return true
    if (warnedBundleIds.has(bid)) return false
    warnedBundleIds.add(bid)
    console.warn(`[ActiveWindow-Darwin] Ignoring invalid bundle ID: ${JSON.stringify(bid)}`)
    return false
  })
  if (!cachedExeWindows.inFlight && bundleIds.length > 0) {
    cachedExeWindows.inFlight = true
    const promises = bundleIds.map(bid => sendCommand(`app-windows ${bid}`))
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

const warnedBundleIds = new Set<string>()
const cachedExeWindows: { data: WindowRect[]; inFlight: boolean } = { data: [], inFlight: false }

/** PID → bundleId cache */
const pidBundleCache = new Map<number, string>()
const pidLookupsInFlight = new Set<number>()

export function getProcessExeName(pid: number): string | null {
  if (!isValidPid(pid)) return null
  const cached = pidBundleCache.get(pid)
  if (cached !== undefined) return cached

  // Async fetch, return null first time
  if (pidLookupsInFlight.has(pid)) return null
  pidLookupsInFlight.add(pid)
  sendCommand(`process-name ${pid}`).then((raw) => {
    try {
      const data = JSON.parse(raw)
      if (data && data.bundleId) {
        pidBundleCache.set(pid, data.bundleId)
      }
    } catch { /* skip */ }
  }).catch(() => { /* skip */ }).finally(() => {
    pidLookupsInFlight.delete(pid)
  })

  return null
}

export function clearPidExeCache(): void {
  pidBundleCache.clear()
}

/** Bring every open window of the app with this PID to the front (fire and forget). */
export function raiseAppWindows(pid: number, _hwnd?: unknown): void {
  if (!isValidPid(pid)) return
  sendCommand(`raise-app ${pid}`).catch(() => {})
}

/**
 * Hiding the panel leaves PeakFlow as the frontmost app with no window, so
 * nothing gets focus until the user clicks. Give focus back to the app that
 * was in front before the panel opened.
 */
export function restorePreviousApp(): boolean {
  if (!isValidPid(lastOtherAppPid)) return false
  sendCommand(`activate ${lastOtherAppPid}`).catch(() => {})
  return true
}

/** Note which app is in front before PeakFlow takes focus (the panel opening). */
export function rememberFrontApp(): void {
  sendCommand('active-window').then((raw) => {
    if (raw === 'null' || raw.startsWith('{"error"')) return
    const pid = (JSON.parse(raw) as { pid?: number }).pid
    if (typeof pid === 'number' && pid !== process.pid) lastOtherAppPid = pid
  }).catch(() => {})
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

/** Stop polling and the helper process for good. Called on app quit. */
export function destroyHelper(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  helperClient.destroy()
}
