/**
 * What the mini timer does when a new timer state arrives: which card to show
 * and whether to show the pill, the card or close. Kept out of React so
 * scripts/checks/away-notice.check.mts can test it.
 */

export type Card = null | 'done' | 'cycle' | 'breakover' | 'away'

interface TimerLike {
  mode: string
  status: string
  pomodorosCompleted: number
  /** Main remembers a look-away reset until Start again / Close (or any start, stop or skip) */
  awayReset?: boolean
}

/**
 * Which card a state change calls for: a card, null (a phase is running: show
 * the pill) or undefined (no change).
 */
export function cardFor(prev: TimerLike, next: TimerLike): Card | undefined {
  if (next.status !== 'idle') return null
  if (prev.mode === 'work' && next.mode !== 'work' && next.pomodorosCompleted > prev.pomodorosCompleted) {
    return next.mode === 'long_break' ? 'cycle' : 'done'
  }
  if (prev.mode !== 'work' && next.mode === 'work' && prev.status !== 'idle') return 'breakover'
  return undefined
}

export interface MiniStep {
  card?: Card
  window?: 'pill' | 'card' | 'close'
}

/** prev is null for the first state the mini sees (it may have just been created). */
export function miniStep(prev: TimerLike | null, t: TimerLike, card: Card): MiniStep {
  // The look-away notice comes from main's state, so a mini that loads late still shows it
  if (t.status === 'idle' && t.awayReset) return card === 'away' ? {} : { card: 'away', window: 'card' }
  if (card === 'away' && t.status === 'idle') return { card: null, window: 'close' } // dismissed
  if (!prev) return t.status === 'idle' ? { window: 'close' } : {}
  const c = cardFor(prev, t)
  if (c === null) return card ? { card: null, window: 'pill' } : {}
  if (c) return { card: c, window: 'card' }
  // Idle with no prompt showing (stopped or reset elsewhere): the mini isn't needed
  if (t.status === 'idle' && !card) return { window: 'close' }
  return {}
}
