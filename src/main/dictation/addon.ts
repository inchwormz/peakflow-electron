/**
 * The $5 dictation add-on: PeakFlow's server holds the OpenAI key and meters
 * each clip against the person's balance, so they don't need a key of their own.
 * Signed in with their PeakFlow licence key plus a device id made up once.
 *
 * The server's DICTATION_ADDON switch is the only flag: while it's off the
 * server answers 404, and the app behaves exactly as before (own key only).
 * No Electron imports, so this can be checked from Node.
 */
import type { TranscribeResult } from './transcribe'

export const ADDON_SERVER = process.env['PEAKFLOW_DICTATION_SERVER'] || 'https://getpeakflow.pro/api/dictation'

export interface AddonStatus {
  /** off: the add-on isn't running; none: no add-on on this licence; active: dictation runs on PeakFlow's server */
  state: 'off' | 'none' | 'active' | 'error'
  balanceMicros?: number
  usedSeconds?: number
  usedMicros?: number
  periodEnd?: string | null
  refundCents?: number
  exhausted?: boolean
  disabled?: boolean
  /** devices: a third computer; the add-on is on the licence but not here */
  error?: string
}

export interface AddonAuth {
  licence: string
  deviceId: string
}

type Fetch = typeof fetch

const headers = (a: AddonAuth): Record<string, string> => ({ Authorization: `Licence ${a.licence}`, 'X-Device': a.deviceId })

export async function fetchAddonStatus(a: AddonAuth | null, fetchImpl: Fetch = fetch): Promise<AddonStatus> {
  if (!a) return { state: 'none' }
  try {
    const res = await fetchImpl(`${ADDON_SERVER}/balance`, { headers: headers(a), signal: AbortSignal.timeout(5000) })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
    if (res.status === 404) return { state: 'off' }
    if (res.status === 402) return { state: 'none' }
    if (res.status === 403 && body.error === 'too_many_devices') return { state: 'error', error: 'devices' }
    if (!res.ok) return { state: 'error', error: body.error ?? `HTTP ${res.status}` }
    return { state: 'active', ...(body as Omit<AddonStatus, 'state'>) }
  } catch {
    return { state: 'error', error: 'network' }
  }
}

const SERVER_ERRORS: Record<string, TranscribeResult['error']> = {
  no_balance: 'addon_empty',
  too_many_devices: 'addon_devices',
  daily_limit: 'addon_daily',
  disabled: 'addon_off',
  no_addon: 'addon_off',
  off: 'addon_off',
  bad_licence: 'addon_off'
}

/** Speech to text through PeakFlow's server. Same result shape as transcribe(). */
export async function transcribeViaAddon(
  audio: Uint8Array,
  a: AddonAuth,
  opts: { mime: string; prompt?: string; durationMs: number; timeoutMs?: number },
  fetchImpl: Fetch = fetch
): Promise<TranscribeResult & { balanceMicros?: number }> {
  if (audio.byteLength < 1000) return { ok: false, error: 'no_speech' }
  let res: Response
  try {
    res = await fetchImpl(`${ADDON_SERVER}/transcribe`, {
      method: 'POST',
      headers: {
        ...headers(a),
        'Content-Type': opts.mime,
        'X-Duration-Ms': String(Math.round(opts.durationMs)),
        ...(opts.prompt ? { 'X-Prompt': encodeURIComponent(opts.prompt.slice(0, 1500)) } : {})
      },
      body: audio,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000)
    })
  } catch (err) {
    return { ok: false, error: 'network', detail: (err as Error).name }
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string; balanceMicros?: number }
  if (!res.ok) return { ok: false, error: SERVER_ERRORS[body.error ?? ''] ?? 'failed', detail: `HTTP ${res.status} ${body.error ?? ''}` }
  const text = (body.text ?? '').trim()
  return text ? { ok: true, text, balanceMicros: body.balanceMicros } : { ok: false, error: 'no_speech' }
}

/**
 * A fetch for cleanUp(): it sends the same clean-up prompt to PeakFlow's
 * server instead of OpenAI, and hands back an OpenAI-shaped answer.
 */
export function addonTidyFetch(a: AddonAuth, fetchImpl: Fetch = fetch): Fetch {
  return (async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { messages?: unknown }
    const res = await fetchImpl(`${ADDON_SERVER}/tidy`, {
      method: 'POST',
      headers: { ...headers(a), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: sent.messages }),
      signal: init?.signal
    })
    if (!res.ok) return new Response('{}', { status: res.status })
    const body = (await res.json().catch(() => ({}))) as { text?: string }
    return new Response(JSON.stringify({ choices: [{ message: { content: body.text ?? '' } }] }), { status: 200 })
  }) as Fetch
}

// ─── the usage line (approved copy) ──────────────────────────────────────────

const MICROS_PER_CENT = 10_000

function money(micros: number): string {
  const cents = Math.round(micros / MICROS_PER_CENT)
  return cents < 100 ? `${cents}¢` : `$${(cents / 100).toFixed(2)}`
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function day(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

/** "This month: 1h 12m used (32¢). $3.75 comes back to your card on 22 November." */
export function usageLine(s: AddonStatus): string {
  const when = day(s.periodEnd)
  if (s.exhausted) return `You’ve used this month’s dictation. Add $5 to keep going${when ? `, or it starts again on ${when}` : ''}.`
  const used = `This month: ${duration(s.usedSeconds ?? 0)} used (${money(s.usedMicros ?? 0)}).`
  const back = s.refundCents && when ? ` ${money(s.refundCents * MICROS_PER_CENT)} comes back to your card on ${when}.` : ''
  return used + back
}
