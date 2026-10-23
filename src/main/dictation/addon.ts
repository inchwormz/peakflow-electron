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

const PRODUCTION_SERVER = 'https://getpeakflow.pro/api/dictation'
let ADDON_SERVER = PRODUCTION_SERVER

/**
 * Development only (main calls this when the app isn't packaged): point the
 * add-on at a local test server. Only http://localhost / 127.0.0.1 or
 * getpeakflow.pro over https are accepted, so the licence key can't be sent elsewhere.
 */
export function allowServerOverride(): void {
  const raw = process.env['PEAKFLOW_DICTATION_SERVER']
  if (!raw) return
  try {
    const u = new URL(raw)
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    const ours = u.protocol === 'https:' && (u.hostname === 'getpeakflow.pro' || u.hostname.endsWith('.getpeakflow.pro'))
    if (local || ours) ADDON_SERVER = raw.replace(/\/$/, '')
  } catch { /* ignored */ }
}

export function addonServer(): string {
  return ADDON_SERVER
}

export interface AddonStatus {
  state: 'off' | 'none' | 'ok' | 'low' | 'empty' | 'error'
  balanceMicros?: number
  minutesLeft?: number
  usedSeconds?: number
  usedMicros?: number
  disabled?: boolean
  blocked?: null | 'disabled' | 'daily_limit'
  /** devices: a third computer; the add-on is on the licence but not here */
  error?: string
}

export function mapBalanceReply(status: number, body: unknown): AddonStatus {
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (status === 404) return { state: 'off' }
  if (status === 402 && b.error === 'no_addon') return { state: 'none' }
  if (status === 403 && b.error === 'too_many_devices') return { state: 'error', error: 'devices' }
  if (status !== 200 || !['ok', 'low', 'empty'].includes(String(b.state)) ||
      typeof b.balanceMicros !== 'number' || !Number.isSafeInteger(b.balanceMicros) ||
      typeof b.minutesLeft !== 'number' || !Number.isFinite(b.minutesLeft) || b.minutesLeft < 0 ||
      typeof b.disabled !== 'boolean' ||
      (b.blocked != null && b.blocked !== 'disabled' && b.blocked !== 'daily_limit')) return { state: 'error' }
  return {
    state: b.state as 'ok' | 'low' | 'empty', balanceMicros: b.balanceMicros,
    minutesLeft: b.minutesLeft, disabled: b.disabled, blocked: b.blocked as AddonStatus['blocked'] ?? null,
    ...(typeof b.usedSeconds === 'number' ? { usedSeconds: b.usedSeconds } : {}),
    ...(typeof b.usedMicros === 'number' ? { usedMicros: b.usedMicros } : {})
  }
}

export interface AddonAuth {
  licence: string
  deviceId: string
}

type Fetch = typeof fetch

const headers = (a: AddonAuth): Record<string, string> => ({ Authorization: `Licence ${a.licence}`, 'X-Device': a.deviceId })

// Shared by settings, checkout and transcription refreshes, including development overrides.
const inFlight = new WeakMap<Fetch, Map<string, Promise<AddonStatus>>>()
export function fetchAddonStatus(a: AddonAuth | null, fetchImpl: Fetch = fetch): Promise<AddonStatus> {
  if (!a) return Promise.resolve({ state: 'none' })
  const base = addonServer()
  const id = JSON.stringify([base, a.licence, a.deviceId])
  let requests = inFlight.get(fetchImpl)
  if (!requests) inFlight.set(fetchImpl, (requests = new Map()))
  const pending = requests.get(id)
  if (pending) return pending
  const request = (async (): Promise<AddonStatus> => {
    try {
      const res = await fetchImpl(`${base}/balance`, {
        headers: headers(a), signal: AbortSignal.timeout(10_000), redirect: 'error'
      })
      return mapBalanceReply(res.status, await res.json().catch(() => ({})))
    } catch {
      return { state: 'error', error: 'network' }
    }
  })()
  requests.set(id, request)
  void request.finally(() => requests.delete(id))
  return request
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
    res = await fetchImpl(`${addonServer()}/transcribe`, {
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
    const res = await fetchImpl(`${addonServer()}/tidy`, {
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
