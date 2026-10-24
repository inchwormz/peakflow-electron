/**
 * PeakFlow's own short-lived clipboard writes (dictation, snippets, launcher
 * answers, the launcher's copy of the selected text) must never land in
 * QuickBoard history, and the clip they replace must come back without being
 * recorded again.
 *
 * Two layers:
 *   - Marker: every such write carries a marker type, so QuickBoard (and other
 *     clipboard managers, through the standard "transient" types) skips it.
 *     The Mac helper adds the Mac marker itself (Launcher.swift, ownWriteTypes).
 *   - Pause: while the main process does a save / write / paste / restore round
 *     trip, QuickBoard stops polling, so it never sees the in-between clipboard
 *     and the restored clip matches what it last saw.
 *
 * No Electron import: the checks in scripts/checks load this file directly.
 */

/** Mac pasteboard type added to our own writes (keep in step with Launcher.swift). */
export const OWN_WRITE_MARK_MAC = 'pro.getpeakflow.own-write'
/** Windows registered clipboard format added to our own writes. */
export const OWN_WRITE_MARK_WIN = 'PeakFlowOwnWrite'

/** `true` when the clipboard holds one of PeakFlow's own short-lived writes. Pass Electron's `clipboard.has`. */
export function isOwnWrite(has: (format: string) => boolean): boolean {
  for (const f of [OWN_WRITE_MARK_MAC, OWN_WRITE_MARK_WIN]) {
    try {
      if (has(f)) return true
    } catch {
      /* a failing check never blocks capture */
    }
  }
  return false
}

/** A pause that is never released (a bug, a hung paste) lifts itself after this long. */
export const MAX_PAUSE_MS = 10_000

let holds = 0
let lastHoldAt = 0

/** `true` while a clipboard round trip is running, so QuickBoard should not poll. */
export function isCapturePaused(now = Date.now()): boolean {
  return holds > 0 && now - lastHoldAt < MAX_PAUSE_MS
}

/** Run `fn` with QuickBoard's clipboard polling paused. */
export async function withCapturePaused<T>(fn: () => Promise<T>): Promise<T> {
  if (!isCapturePaused()) holds = 0 // drop holds left over from a stuck round trip
  holds++
  lastHoldAt = Date.now()
  try {
    return await fn()
  } finally {
    holds = Math.max(0, holds - 1)
  }
}
