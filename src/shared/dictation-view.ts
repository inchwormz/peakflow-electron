/**
 * What the Dictation tool page shows, worked out from the main process's
 * answers (settings, prepaid account, permissions). Pure, so the rules are
 * checked from Node (scripts/checks/dictation-tool.check.mts) and the page
 * only renders the result.
 *
 * Paying: the prepaid balance is the main path; the person's own OpenAI key
 * is the small second option. While the add-on is off (no buy links in the
 * build, or the server switch off) the account is 'hidden' and the own key
 * is the only way, so no buy button is ever shown.
 */

import type { DictationAccount, TopupAmount } from './dictation-account'
import type { DictationHoldKey, DictationSettings } from './launcher/types'

// ─── copy (checked with style-corpus-writer) ─────────────────────────────────

export const COPY = {
  offer: 'US$5 buys about 15 hours of talking. Unused time never expires.',
  paused: 'Dictation is paused. Top up to keep going.',
  disabled: 'Dictation is switched off for this licence. Email contact@getpeakflow.pro for help.',
  dailyLimit: 'You’ve used today’s 3 hours. Dictation is back within 24 hours.',
  devices: 'Dictation is already on two other computers.',
  getDictation: 'Get dictation'
} as const

export const getDictationFor = (amount: number): string => `Get dictation for US$${amount}`
export const addAmount = (amount: number): string => `Add US$${amount}`

// ─── hold key ────────────────────────────────────────────────────────────────

export function holdKeys(mac: boolean): Array<[DictationHoldKey, string]> {
  return mac
    ? [['fn', 'fn'], ['ropt', 'Right ⌥'], ['rcmd', 'Right ⌘'], ['rctrl', 'Right ⌃']]
    : [['rctrl', 'Right Ctrl'], ['ralt', 'Right Alt']]
}

export function holdKeyName(key: DictationHoldKey, mac: boolean): string {
  return typeof key === 'object' ? key.label : holdKeys(mac).find(([k]) => k === key)?.[1] ?? key
}

/** "Hold fn, talk, let go" */
export const howTo = (keyName: string): string => `Hold ${keyName}, talk, let go`

// ─── permissions ─────────────────────────────────────────────────────────────

export type MediaStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface DictationPermissions {
  /** macOS Microphone access ('granted' off macOS) */
  microphone: MediaStatus
  /** macOS Accessibility (true off macOS): hearing the hold key and typing the words */
  accessibility: boolean
}

export type MissingPermission = 'accessibility' | 'microphone'

/** The first permission dictation still needs, or null. Unsigned updates reset both on a Mac. */
export function missingPermission(p: DictationPermissions | undefined | null): MissingPermission | null {
  if (!p) return null
  if (!p.accessibility) return 'accessibility'
  if (p.microphone !== 'granted' && p.microphone !== 'unknown') return 'microphone'
  return null
}

// ─── paying ──────────────────────────────────────────────────────────────────

export type PayView =
  /** The add-on isn't offered (server off, no buy links, no licence): own key only */
  | { kind: 'own-key' }
  /** Before the first purchase */
  | { kind: 'buy'; amounts: TopupAmount[] }
  /** A third computer: the add-on is on the licence but not here */
  | { kind: 'devices' }
  | {
      kind: 'balance'
      /** "US$4.07 left · about 15 hours", or null when it would mislead (paused, switched off) */
      line: string | null
      notice: string | null
      /** Amounts that can be bought now (empty: no Add button) */
      amounts: TopupAmount[]
      paused: boolean
    }

/** "US$4.07 left · about 15 hours" (or about 1 hour / 30 minutes / 1 minute) */
export function balanceLine(balanceMicros: number, minutesLeft: number): string {
  const dollars = (balanceMicros / 1_000_000).toFixed(2)
  const hours = Math.round(minutesLeft / 60)
  const minutes = Math.round(minutesLeft)
  const time = hours >= 1 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  return `US$${dollars} left · about ${time}`
}

export function payView(account: DictationAccount | undefined | null): PayView {
  if (!account || account.state === 'hidden') return { kind: 'own-key' }
  if (account.state === 'devices') return { kind: 'devices' }
  if (account.state === 'no_addon') return account.amounts?.length ? { kind: 'buy', amounts: account.amounts } : { kind: 'own-key' }
  if (!('balanceMicros' in account)) return { kind: 'own-key' }
  const amounts = account.amounts ?? []
  const disabled = account.disabled || account.blocked === 'disabled'
  const dailyLimit = account.blocked === 'daily_limit'
  const empty = account.state === 'empty' || account.balanceMicros < 0
  const showLine = account.balanceMicros >= 0 && !disabled && (!empty || dailyLimit)
  const notice = disabled ? COPY.disabled : dailyLimit ? COPY.dailyLimit : empty ? COPY.paused : null
  return {
    kind: 'balance',
    line: showLine ? balanceLine(account.balanceMicros, account.minutesLeft) : null,
    notice,
    // Paying won't switch a disabled account back on (chargeback), so it is never offered one
    amounts: disabled ? [] : amounts,
    paused: !disabled && empty
  }
}

/** The smallest offered amount until the person picks another; an amount no longer offered falls back too. */
export function pickAmount(amounts: readonly TopupAmount[], chosen: TopupAmount | null): TopupAmount | undefined {
  return chosen !== null && amounts.includes(chosen) ? chosen : amounts[0]
}

/** The buy button. With one amount and no choice shown, the first purchase names the price. */
export function buyLabel(view: PayView, amount: TopupAmount): string {
  if (view.kind === 'buy') return view.amounts.length > 1 ? COPY.getDictation : getDictationFor(amount)
  return addAmount(amount)
}

// ─── header status ───────────────────────────────────────────────────────────

/** The grey status next to the tool name: Off · On · Paused · Needs access */
export function dictationStatus(s: DictationSettings | undefined, account: DictationAccount | undefined, perms: DictationPermissions | undefined): string {
  if (!s) return ''
  if (!s.enabled) return 'Off'
  if (missingPermission(perms)) return 'Needs access'
  // Paused only when the balance is what dictation runs on (an own key still works)
  if (!s.ownKey) {
    const v = payView(account)
    if (v.kind === 'balance' && (v.paused || v.notice === COPY.disabled || v.notice === COPY.dailyLimit)) return 'Paused'
  }
  return 'On'
}
