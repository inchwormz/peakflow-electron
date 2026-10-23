/**
 * Check: licence checks against Lemon Squeezy (B3, S5, S6; 24 Oct 2026),
 * through the REAL license.ts and access-check.ts. Storage and fetch are
 * faked; the clock (Date.now, performance.now) is set by the check.
 * Cases: valid, expired, disabled, not found, network down, server 5xx,
 * 429, captive-portal HTML, timeout, clock moved back and forward, the
 * 14-day offline cap, the 2.0 -> 2.1 upgrade, one shared request, attempt
 * throttling, activation errors and instance IDs, and Remove licence.
 * Run: node scripts/checks/licence.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

type Mem = { stores: Record<string, Map<string, unknown>>; creds: Map<string, string> }
const g = globalThis as unknown as { __pf: Mem }
g.__pf = { stores: {}, creds: new Map() }
installTsHooks({
  electron: fake('export const BrowserWindow = { getAllWindows: () => [] }'),
  'electron-store': fake(`export default class {
    constructor(o) { this.m = (globalThis.__pf.stores[o?.name ?? 'config'] ??= new Map()) }
    get(k, d) { return this.m.has(k) ? this.m.get(k) : d } set(k, v) { this.m.set(k, v) }
    has(k) { return this.m.has(k) } delete(k) { this.m.delete(k) } }`),
  './safe-storage': fake(`export const isAvailable = () => true
    export const encryptString = (s) => 'enc:' + s
    export const decryptString = (s) => s.startsWith('enc:') ? s.slice(4) : null`),
  './credentials': fake(`const c = globalThis.__pf.creds
    export const storeCredential = (t, k, v) => { c.set(t + ':' + k, v); return true }
    export const getCredential = (t, k) => c.get(t + ':' + k) ?? null
    export const deleteCredential = (t, k) => c.delete(t + ':' + k)`)
})
console.log = () => {}
console.warn = () => {}

// ─── clock and network fakes ────────────────────────────────────────────────
const DAY = 86400000
const HOUR = 3600000
const START = Date.parse('2026-11-01T00:00:00Z')
let now = START
let mono = 1_000_000
Date.now = () => now
performance.now = () => mono
/** Move both clocks (a real day passing). */
const pass = (ms: number): void => { now += ms; mono += ms }

type Reply = { status: number; body?: unknown; html?: boolean } | 'network' | 'hang'
let reply: Reply = 'network'
const calls: Array<{ url: string; body: Record<string, string>; timeoutMs: number | undefined }> = []
let lastTimeout: number | undefined
const origTimeout = AbortSignal.timeout.bind(AbortSignal)
AbortSignal.timeout = (ms: number) => { lastTimeout = ms; return origTimeout(ms === 10_000 ? 30 : ms) }
let gate: Promise<void> | null = null
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), body: JSON.parse(String(init.body)), timeoutMs: lastTimeout })
  if (gate) await gate
  const r = reply
  if (r === 'network') throw new TypeError('fetch failed')
  if (r === 'hang') {
    return await new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))
  }
  const text = r.html ? '<html>Sign in to Wi-Fi</html>' : JSON.stringify(r.body ?? {})
  return new Response(text, { status: r.status, headers: { 'Content-Type': r.html ? 'text/html' : 'application/json' } })
}) as typeof fetch

const lic = await import(srcUrl('src/main/security/license.ts'))
const { checkAccess } = await import(srcUrl('src/main/security/access-check.ts'))

const store = () => (g.__pf.stores['peakflow-license'] ??= new Map())
const iso = (t: number) => new Date(t).toISOString()
const PRO = 1461019
const valid = (): Reply => ({ status: 200, body: { valid: true, error: null, license_key: { status: 'active', key: 'KEY' }, meta: { product_id: PRO } } })
const ls = (status: string, http = 200): Reply => ({ status: http, body: { valid: false, error: `license_key is ${status}.`, license_key: { status, key: 'KEY' }, meta: { product_id: PRO } } })
const notFound = (): Reply => ({ status: 404, body: { valid: false, error: 'license_key not found.', license_key: null, meta: null } })

/** A 2.1 customer whose last good check was `ago` ms ago. */
function customer(ago: number): void {
  mono += 120_000 // scenarios are minutes apart
  store().clear(); g.__pf.creds.clear(); calls.length = 0
  g.__pf.creds.set('license:key', 'KEY')
  g.__pf.creds.set('license:product_id', String(PRO))
  store().set('license_status', 'active')
  store().set('validation_timestamp', iso(now - ago))
  store().set('last_check_attempt', iso(now - ago))
  store().set('trial_expires_at', 'enc:' + iso(now - 400 * DAY)) // trial long over
}
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1)) }
const pro = async (): Promise<boolean> => (await checkAccess('snapgrid')).allowed
const validates = () => calls.filter((c) => c.url.endsWith('/validate')).length

// 1. Valid key, check fresh: no network at all
customer(HOUR)
reply = 'network'
assert.equal(await pro(), true, 'fresh good check')
assert.equal(calls.length, 0, 'no request inside 24 h')

// 2. Valid key, re-check due: access at once, check in the background, answer saved
customer(2 * DAY)
reply = valid()
assert.equal(await pro(), true)
await settle()
assert.equal(validates(), 1)
assert.equal(calls[0].timeoutMs, 10_000, 'S6: 10 s timeout')
assert.equal(Date.parse(store().get('validation_timestamp') as string), now, 'good check saved')
assert.equal(Date.parse(store().get('last_check_attempt') as string), now, 'S6: attempt time saved')

// 3. B3: expired / disabled / not found really lock, and say why
for (const [label, r, saved] of [
  ['expired (cancelled Pro)', ls('expired'), 'expired'],
  ['expired with HTTP 400', ls('expired', 400), 'expired'],
  ['disabled (refund)', ls('disabled'), 'disabled'],
  ['not found', notFound(), 'not_found']
] as const) {
  customer(2 * DAY)
  reply = r
  assert.equal(await pro(), true, `${label}: the press that finds out is still served`)
  await settle()
  assert.equal(store().get('license_status'), saved, `${label}: status saved`)
  const a = await checkAccess('snapgrid')
  assert.equal(a.allowed, false, `${label}: locked`)
  assert.equal(a.licence, 'ended', `${label}: Plan screen says the licence ended`)
  for (const t of ['focusdim', 'quickboard', 'liquidfocus', 'screenslap', 'PeakFlow']) {
    assert.equal((await checkAccess(t)).isLicensed, false, `${label}: ${t}`)
  }
  assert.equal(lic.isToolLicensed('focusdim'), false)
  assert.equal(lic.isSuiteLicense(), false)
}

// 3b. A revoked key that is renewed comes back by itself
customer(2 * DAY)
reply = ls('expired')
await pro(); await settle()
assert.equal(await pro(), false)
pass(2 * HOUR)
reply = valid()
await pro(); await settle()
assert.equal(await pro(), true, 'renewed licence unlocks')

// 4. Network down, 5xx, 429, captive portal, timeout, odd answers: never lock inside 14 days
for (const [label, r] of [
  ['network down', 'network'],
  ['server 500', { status: 500, body: { error: 'oops' } }],
  ['server 503 html', { status: 503, html: true }],
  ['rate limited', { status: 429, body: { error: 'Too Many Attempts.' } }],
  ['captive portal', { status: 200, html: true }],
  ['timeout', 'hang'],
  ['404 html from a proxy', { status: 404, html: true }],
  ['5xx that says expired', { status: 502, body: { valid: false, license_key: { status: 'expired' } } }],
  ['valid:false, status inactive', { status: 200, body: { valid: false, license_key: { status: 'inactive' } } }]
] as const) {
  customer(13 * DAY)
  reply = r as Reply
  assert.equal(await pro(), true, `${label}: day 13`)
  await settle(); await new Promise((res) => setTimeout(res, 60))
  assert.equal(store().get('license_status'), 'active', `${label}: status untouched`)
  assert.equal(await pro(), true, `${label}: still licensed`)
  assert.equal(validates(), 1, `${label}: one attempt, then wait an hour`)
}

// 5. The 14-day cap: offline past it locks; back online unlocks on the next use
customer(13 * DAY)
reply = 'network'
for (let d = 0; d < 1; d++) { assert.equal(await pro(), true); await settle(); pass(12 * HOUR) }
assert.equal(await pro(), true, 'day 13.5: in grace')
await settle()
pass(DAY)
assert.equal(await pro(), false, 'day 14.5 offline: locked')
assert.equal((await checkAccess('PeakFlow')).licence, 'offline', 'Plan screen says "can’t check"')
const before = validates()
assert.equal(await pro(), false)
assert.equal(validates(), before, 'locked retries at most once a minute')
pass(61 * 1000)
reply = valid()
assert.equal(await pro(), true, 'back online: unlocked on the same key press')
assert.equal(store().get('license_status'), 'active')

// 6. Clock changes
// 6a. Clock moved back a year: trusted, re-checked, never locked
customer(HOUR)
now -= 365 * DAY
reply = 'network'
assert.equal(await pro(), true, 'clock back: licensed')
await settle()
assert.equal(validates(), 1, 'clock back: re-checks (future timestamps are stale)')
assert.equal(await pro(), true)
assert.equal(validates(), 1, 'clock back: …but only once (monotonic/attempt throttle)')
now += 365 * DAY
// 6b. Clock moved forward a year while online: the check passes, still licensed
customer(HOUR)
now += 365 * DAY
reply = valid()
assert.equal(await pro(), true, 'clock forward + online: licensed')
assert.equal(store().get('license_status'), 'active')
// 6c. Clock forward a year while offline: past the cap, locks until the next good check
customer(HOUR)
reply = 'network'
now += 365 * DAY
assert.equal(await pro(), false, 'clock forward + offline: locked (cannot tell from 14 days offline)')
mono += 61 * 1000
reply = valid()
assert.equal(await pro(), true, '…and unlocks as soon as it reaches the server')
// 6d. Clock forward but expired answer: stays locked
customer(HOUR)
now += 30 * DAY
reply = ls('expired')
assert.equal(await pro(), false)
assert.equal(store().get('license_status'), 'expired')

// 7. 2.0 -> 2.1 upgrade: an old 2.0 record (good check 90 days ago) gets a fresh grace
customer(0)
store().delete('last_check_attempt')
store().set('validation_timestamp', iso(now - 90 * DAY))
reply = 'network'
assert.equal(await pro(), true, 'upgraded offline: not locked')
pass(13 * DAY)
assert.equal(await pro(), true, 'upgrade grace day 13')
pass(2 * DAY)
mono += 61 * 1000
assert.equal(await pro(), false, 'upgrade grace ends after 14 days offline')
// …and a refunded 2.0 user online at upgrade is locked by the first check
customer(0)
store().delete('last_check_attempt')
store().set('validation_timestamp', iso(now - 90 * DAY))
reply = ls('disabled')
await pro(); await settle()
assert.equal(await pro(), false, 'refunded 2.0 user locked after upgrade')

// 8. S6: one shared check in flight
customer(2 * DAY)
reply = valid()
let open: () => void = () => {}
gate = new Promise((r) => { open = r })
const presses = await Promise.all(Array.from({ length: 25 }, () => pro()))
assert.ok(presses.every(Boolean), 'presses never wait on the network')
open(); gate = null
await settle()
assert.equal(validates(), 1, '25 presses, one request')
// …and a locked state shares one awaited request too
customer(20 * DAY)
reply = valid()
gate = new Promise((r) => { open = r })
const waiting = Promise.all(Array.from({ length: 10 }, () => pro()))
await settle(); open(); gate = null
assert.ok((await waiting).every(Boolean))
assert.equal(validates(), 1, 'locked: 10 presses, one request')

// 9. A key replaced while a check runs: the old answer is ignored
customer(2 * DAY)
reply = ls('expired')
gate = new Promise((r) => { open = r })
const p = lic.refreshLicence()
g.__pf.creds.set('license:key', 'NEW-KEY')
open(); gate = null
await p
assert.equal(store().get('license_status'), 'active', 'stale answer for the old key dropped')

// 10. S5: activation shows Lemon Squeezy's text and stores the instance ID
store().clear(); g.__pf.creds.clear(); calls.length = 0
reply = { status: 400, body: { activated: false, error: 'This license key has reached the activation limit.', license_key: { status: 'active' } } }
let r = await lic.activateLicense('KEY')
assert.deepEqual(r, { success: false, message: 'This license key has reached the activation limit.' })
assert.equal(g.__pf.creds.get('license:key'), undefined, 'limit reached: nothing saved')
reply = { status: 404, body: { activated: false, error: 'license_key not found.' } }
assert.equal((await lic.activateLicense('KEY')).message, 'License_key not found.')
reply = { status: 500, html: true }
assert.equal((await lic.activateLicense('KEY')).message, 'The licence server didn’t answer. Try again in a few minutes.')
reply = { status: 200, body: { activated: true, error: null, license_key: { status: 'active' }, instance: { id: 'inst-1' }, meta: { product_id: PRO } } }
r = await lic.activateLicense('KEY')
assert.equal(r.success, true)
assert.equal(calls.at(-1)!.timeoutMs, 10_000, 'activation timeout')
assert.equal(g.__pf.creds.get('license:instance_id'), 'inst-1', 'instance ID stored')
assert.equal(await pro(), true)
reply = 'network'
r = await lic.activateLicense('OTHER')
assert.equal(r.success, false)
assert.match(r.message, /Your key is saved/)

// 11. S5: Remove licence from this computer
reply = { status: 200, body: { activated: true, license_key: { status: 'active' }, instance: { id: 'inst-2' }, meta: { product_id: PRO } } }
await lic.activateLicense('KEY')
reply = 'network'
r = await lic.deactivateLicense()
assert.equal(r.success, false, 'offline: nothing removed')
assert.equal(g.__pf.creds.get('license:key'), 'KEY')
reply = { status: 200, body: { deactivated: true, error: null } }
r = await lic.deactivateLicense()
assert.deepEqual(r, { success: true, message: 'Licence removed' })
assert.deepEqual(calls.at(-1)!.body, { license_key: 'KEY', instance_id: 'inst-2' }, 'frees this instance')
assert.equal(g.__pf.creds.get('license:key'), undefined)
assert.equal(g.__pf.creds.get('license:instance_id'), undefined)
assert.equal((await checkAccess('PeakFlow')).hasLicenceKey, false)
// a key from before 2.1 (no instance ID) is removed here, with a note
customer(HOUR)
r = await lic.deactivateLicense()
assert.equal(r.success, true)
assert.match(r.message, /before PeakFlow 2\.1/)
assert.equal(calls.length, 0, 'nothing to free without an instance ID')

// 12. classifyValidation table (pure)
const c = lic.classifyValidation
assert.equal(c(200, { valid: true, license_key: { status: 'active' } }).kind, 'valid')
assert.equal(c(200, { valid: true, license_key: { status: 'expired' } }).kind, 'valid', 'server says valid: never lock')
assert.equal(c(200, null).kind, 'transient')
assert.equal(c(404, { valid: false, license_key: { status: 'active' } }).kind, 'transient', '404 with a key is not "not found"')
assert.equal(c(404, { error: 'not found' }).kind, 'transient', '404 without valid:false is not Lemon Squeezy')

console.info('licence: ok')
