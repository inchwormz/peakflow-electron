/**
 * Turns the dictation key's raw down/up/cancel into what PeakFlow acts on:
 * a hold (dictation) or a quick double tap (SnapGrid's auto-arrange).
 *
 *   hold                 down … up passed through (dictation decides if it was long enough)
 *   one short tap        passed through too; dictation drops it as too short
 *   two short taps       'double' after the second; the second press is never
 *                        passed on, so it can't start a recording
 *
 * No Electron imports, so the timing can be checked on its own.
 */

/** Shorter than this is a tap, not a hold (the same limit dictation uses) */
export const TAP_MS = 300
/** The second tap has to start within this of the first one ending */
export const DOUBLE_GAP_MS = 350

export type KeyEvent = 'down' | 'up' | 'cancel'
export type KeyAction = KeyEvent | 'double'

export class KeyTaps {
  private downAt = 0
  private lastTapUpAt = -Infinity
  private second = false
  /** This press was part of a shortcut: its release isn't a tap */
  private cancelled = false

  /** Feed a raw key event; returns what to act on (often the same event, sometimes nothing). */
  feed(e: KeyEvent, now: number): KeyAction[] {
    if (e === 'cancel') {
      // Another key joined in: a shortcut, not a tap
      const wasSecond = this.second
      this.reset()
      this.cancelled = true
      return wasSecond ? [] : ['cancel']
    }
    if (e === 'down') {
      this.downAt = now
      this.cancelled = false
      this.second = now - this.lastTapUpAt <= DOUBLE_GAP_MS
      return this.second ? [] : ['down']
    }
    const tap = !this.cancelled && now - this.downAt < TAP_MS
    this.cancelled = false
    if (this.second) {
      this.reset()
      return tap ? ['double'] : []
    }
    this.lastTapUpAt = tap ? now : -Infinity
    return ['up']
  }

  reset(): void {
    this.second = false
    this.lastTapUpAt = -Infinity
  }
}
