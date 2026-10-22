/**
 * SnapGrid on macOS: move other apps' windows through the PeakFlowHelper
 * (Accessibility API), and watch for window drags with a second, long-running
 * helper process (`peakflow-helper drag-watch`).
 *
 * Coordinates are global points with a top-left origin, which is the same
 * space as Electron's screen API, so no conversion is needed.
 */

import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { getMacHelperPath } from './mac-helper'
import { HelperClient, isValidPid } from './helper-client'
import type { SnapRect, SnapWindow, DragEvent } from './window-snap-types'

const client = new HelperClient({
  getPath: getMacHelperPath,
  requestTimeoutMs: 2000,
  log: (level, message) => console[level](`[SnapGrid-Darwin] ${message}`)
})

interface RawWindow {
  pid: number
  windowId: number
  appName?: string
  bundleId?: string
  title?: string
  frame: SnapRect | null
}

function toSnapWindow(r: RawWindow): SnapWindow | null {
  if (!r || !isValidPid(r.pid) || !r.frame) return null
  return {
    id: `${r.pid}:${r.windowId || 0}`,
    pid: r.pid,
    appName: r.appName || '',
    icon: r.bundleId ? { bundleId: r.bundleId, name: r.appName } : { name: r.appName },
    frame: r.frame,
    handle: { pid: r.pid, windowId: r.windowId || 0 }
  }
}

async function ask<T>(command: string): Promise<T | null> {
  try {
    const raw = await client.send(command)
    if (raw === 'null') return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function getFrontWindow(): Promise<SnapWindow | null> {
  const r = await ask<RawWindow>('sg-front')
  return r ? toSnapWindow(r) : null
}

export async function listWindows(): Promise<SnapWindow[]> {
  const rows = (await ask<RawWindow[]>('sg-windows')) ?? []
  return rows.map(toSnapWindow).filter((w): w is SnapWindow => w !== null)
}

function handleOf(w: SnapWindow): { pid: number; windowId: number } | null {
  const h = w.handle as { pid: number; windowId: number } | undefined
  if (!h || !isValidPid(h.pid) || !Number.isSafeInteger(h.windowId) || h.windowId < 0) return null
  return h
}

const n = (v: number): string => String(Math.round(v))

export async function setWindowFrame(w: SnapWindow, r: SnapRect): Promise<SnapRect | null> {
  const h = handleOf(w)
  if (!h || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return null
  const res = await ask<{ ok: boolean; frame?: SnapRect; error?: string }>(
    `sg-set ${h.pid} ${h.windowId} ${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)}`
  )
  if (!res?.ok) {
    if (res?.error) console.warn(`[SnapGrid-Darwin] ${w.appName}: ${res.error}`)
    return null
  }
  return res.frame ?? null
}

export async function raiseWindow(w: SnapWindow): Promise<void> {
  const h = handleOf(w)
  if (h) await ask(`sg-raise ${h.pid} ${h.windowId}`)
}

/** macOS 15+ snaps windows dragged to a screen edge itself (unless turned off). */
export async function osHandlesEdgeDrag(): Promise<boolean> {
  const res = await ask<{ edgeDrag: boolean }>('sg-tiling')
  return res?.edgeDrag ?? false
}

// ─── Drag watcher ───────────────────────────────────────────────────────────

let watcher: ChildProcess | null = null
let watcherWanted = false
let restartDelay = 2000

export function startDragWatch(onEvent: (e: DragEvent) => void): void {
  watcherWanted = true
  if (watcher) return
  let child: ChildProcess
  try {
    child = spawn(getMacHelperPath(), ['drag-watch'], { stdio: ['pipe', 'pipe', 'ignore'] })
  } catch (err) {
    console.warn('[SnapGrid-Darwin] drag watcher failed to start:', err)
    return
  }
  watcher = child
  const startedAt = Date.now()
  let buf = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as DragEvent)
      } catch {
        /* not one of ours */
      }
    }
  })
  child.on('error', () => {})
  child.on('exit', () => {
    if (watcher === child) watcher = null
    if (!watcherWanted) return
    // Crashed: restart with a growing delay (reset once it ran for a minute)
    restartDelay = Date.now() - startedAt > 60_000 ? 2000 : Math.min(restartDelay * 2, 60_000)
    setTimeout(() => {
      if (watcherWanted && !watcher) startDragWatch(onEvent)
    }, restartDelay).unref?.()
  })
}

export function stopDragWatch(): void {
  watcherWanted = false
  const child = watcher
  watcher = null
  if (child) {
    try {
      child.stdin?.end()
    } catch {
      /* gone */
    }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }, 500).unref?.()
  }
}

export function destroy(): void {
  stopDragWatch()
  client.destroy()
}
