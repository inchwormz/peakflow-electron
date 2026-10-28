/**
 * Guarana: keep the computer awake (like caffeinate or Amphetamine).
 * Free for everyone: no trial or licence gate. John, 28 Oct 2026.
 *
 * Shared between the main process (services/guarana.ts) and the panel page.
 */

/** The panel page id. Not a ToolId: it has no trial or licence of its own. */
export const GUARANA_PAGE = 'guarana'

/** Durations offered in the panel and the menu-bar menu. null = until turned off. */
export const GUARANA_DURATIONS: ReadonlyArray<{ minutes: number | null; label: string }> = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: null, label: 'Until I turn it off' }
]

/** Longest timed session accepted over IPC (24 hours). */
export const GUARANA_MAX_MINUTES = 24 * 60

export interface GuaranaState {
  /** Sleep is being blocked right now. */
  active: boolean
  /** When the current session ends (epoch ms), or null when it runs until turned off (or is off). */
  endsAt: number | null
  /** Length of the current session in minutes, null for "until I turn it off" (or off). */
  minutes: number | null
  /** Keep the screen on too (true), or only stop the computer sleeping and let the screen turn off (false). Saved. */
  keepScreenOn: boolean
  /** What the main Turn on button and the menu-bar toggle start with. null = until turned off. Saved. */
  defaultMinutes: number | null
}

/** Remaining whole minutes (rounded up) for display, or null for no timer. */
export function guaranaMinutesLeft(state: Pick<GuaranaState, 'active' | 'endsAt'>, now: number): number | null {
  if (!state.active || state.endsAt == null) return null
  return Math.max(0, Math.ceil((state.endsAt - now) / 60_000))
}

/** '42 min', '1 h 5 min', '2 h'. */
export function formatGuaranaLeft(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
