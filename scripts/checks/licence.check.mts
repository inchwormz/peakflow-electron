/**
 * Check: licence checks against Lemon Squeezy (B3, S5, S6; 24 Oct 2026),
 * through the REAL license.ts and access-check.ts. Storage and fetch are
 * faked; the clock (Date.now, performance.now) is set by the check.
 * Cases: valid, expired, disabled, not found, network down, server 5xx,
 * 429, captive-portal HTML, timeout, clock moved back and forward, the
 * 14-day offline cap, the 2.0 -> 2.1 upgrade, one shared request, attempt
 * throttling, activation errors and instance IDs, Remove licence, and the
 * Sol review findings (offline re-entry, refused removal, races, clock).
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
let reply: Reply | ((url: string) => Reply) = 'network'
const calls: Array<{ url: string; body: Record<string, string>; timeoutMs: number | undefined }> = []
let lastTimeout: number | undefined
const origTimeout = AbortSignal.timeout.bind(AbortSignal)
AbortSignal.timeout = (ms: number) => { lastTimeout = ms; return origTimeout(ms === 10_000 ? 30 : ms) }
let gate: Promise<void> | null = null
globalThis.fetch = (async (url: string, init: RequestInit) => {
  assert.equal((init.headers as Record<string, string>)['Content-Type'], 'application/x-www-form-urlencoded', 'License API takes form bodies')
  calls.push({ url: String(url), body: Object.fromEntries(new URLSearchParams(String(init.body))), timeoutMs: lastTimeout })
  if (gate) await gate
  const r = typeof reply === 'function' ? reply(String(url)) : reply
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
  mono += 2 * HOUR // scenarios are hours of running time apart
  lic.simulateRestartForChecks() // each scenario is a fresh launch
  store().clear(); g.__pf.creds.clear(); calls.length = 0
  g.__pf.creds.set('license:key', 'KEY')
  g.__pf.creds.set('license:product_id', String(PRO))
  store().set('license_status', 'active')
  store().set('validation_timestamp', iso(now - ago))
  store().set('last_check_attempt', iso(now - ago))
  store().set('offline_ms', ago) // offline time since that check
  store().set('last_seen', iso(now))
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

// 4. Network down, 5xx, 429, captive portal, timeout, odd answers: never lock, never change status
for (const [label, r] of [
  ['network down', 'network'],
  ['server 500', { status: 500, body: { error: 'oops' } }],
  ['server 503 html', { status: 503, html: true }],
  ['rate limited', { status: 429, body: { error: 'Too Many Attempts.' } }],
  ['captive portal', { status: 200, html: true }],
  ['timeout', 'hang'],
  ['404 html from a proxy', { status: 404, html: true }],
  ['5xx that says expired', { status: 502, body: { valid: false, license_key: { status: 'expired' } } }],
  ['valid:false, status inactive', { status: 200, body: { valid: false, license_key: { status: 'inactive' } } }],
  ['valid:false, status active', { status: 200, body: { valid: false, license_key: { status: 'active' } } }],
  ['404 instance not found', { status: 404, body: { error: 'license_key instance not found.' } }]
] as const) {
  customer(13 * DAY)
  reply = r as Reply
  assert.equal(await pro(), true, `${label}: day 13`)
  await settle(); await new Promise((res) => setTimeout(res, 60))
  assert.equal(store().get('license_status'), 'active', `${label}: status untouched`)
  assert.equal(await pro(), true, `${label}: still licensed`)
  assert.equal(validates(), 1, `${label}: one attempt, then wait an hour`)
}

/** n hours of the app running offline: one press an hour. */
async function offlineHours(n: number): Promise<void> {
  for (let i = 0; i < n; i++) { pass(HOUR); await pro(); await settle() }
}
/** n days of the app in use offline: one press every 12 hours. */
async function offlineDays(n: number): Promise<void> {
  for (let i = 0; i < 2 * n; i++) { pass(12 * HOUR); await pro(); await settle() }
}

// 5. The 14-day cap: 14 days of offline time since the last good check.
// Back online unlocks on the next use.
customer(13 * DAY)
reply = 'network'
await offlineHours(23)
assert.equal(await pro(), true, 'day 13 + 23 h offline: in grace')
await offlineHours(2)
assert.equal(await pro(), false, 'day 14 + 1 h offline: locked')
assert.equal((await checkAccess('PeakFlow')).licence, 'offline', 'Plan screen says "can’t check"')
const before = validates()
assert.equal(await pro(), false)
assert.equal(validates(), before, 'locked retries at most once a minute')
pass(61 * 1000)
reply = valid()
assert.equal(await pro(), true, 'back online: unlocked on the same key press')
assert.equal(store().get('license_status'), 'active')
assert.equal(store().get('offline_ms'), 0, 'offline time reset')
// Sparse use can't stretch it far: one gap counts at most 3 days
customer(0)
reply = 'network'
const weeks: boolean[] = []
for (let w = 0; w < 6; w++) { lic.simulateRestartForChecks(); pass(7 * DAY); weeks.push(await pro()); await settle() }
assert.deepEqual(weeks, [true, true, true, true, false, false], 'opened once a week offline: locks in week 5 (15 days counted)')
// Left running offline: real running time counts in full
customer(0)
reply = 'network'
await pro(); await settle()
pass(13 * DAY); assert.equal(await pro(), true, 'running 13 days offline')
pass(DAY + HOUR); mono += 61_000; assert.equal(await pro(), false, 'running 14 days offline: locked')

// 6. Clock changes
// 6a. Clock moved back a year: licensed, re-checked once, adds no offline time
customer(HOUR)
now -= 365 * DAY
reply = 'network'
assert.equal(await pro(), true, 'clock back: licensed')
await settle()
assert.equal(validates(), 1, 'clock back: re-checks (future timestamps are stale)')
assert.equal(await pro(), true)
assert.equal(validates(), 1, 'clock back: …but only once an hour (monotonic)')
await offlineHours(48)
assert.equal(await pro(), true, 'clock back + 2 days offline: licensed')
now += 365 * DAY
// 6b. …and moving the clock back can't extend the grace: real time still counts
customer(13 * DAY + 20 * HOUR)
reply = 'network'
await pro(); await settle()
now -= 365 * DAY
await offlineHours(5)
assert.equal(await pro(), false, 'clock back: locked once 14 days of real offline time pass')
now += 365 * DAY
// 6b2. Sol round 3: moving the clock back before every use can't stop the count
customer(0)
reply = 'network'
await pro(); await settle()
for (let i = 0; i < 40 * 24; i++) { pass(HOUR); now -= 2 * HOUR; await lic.isLicensed() }
mono += 61_000
assert.equal(await pro(), false, '40 days of hourly rollbacks while running: locked')
now += 40 * 24 * 2 * HOUR
// 6b3. Sol round 3: forward/back clock corrections don't pile up offline days
customer(DAY)
reply = 'network'
await pro(); await settle()
for (let i = 0; i < 10; i++) { now += 365 * DAY; await lic.isLicensed(); now -= 365 * DAY; await lic.isLicensed() }
assert.equal(await pro(), true, '10 forward/back clock cycles: still licensed')
assert.ok((store().get('offline_ms') as number) < 5 * DAY, 'counted at most one 3-day step')
// …and across restarts too
for (let i = 0; i < 10; i++) {
  lic.simulateRestartForChecks(); now += 365 * DAY; await lic.isLicensed()
  lic.simulateRestartForChecks(); now -= 365 * DAY; await lic.isLicensed()
}
assert.equal(await pro(), true, '10 forward/back cycles with restarts: still licensed')
assert.ok((store().get('offline_ms') as number) < 5 * DAY, 'still at most one 3-day step')

// 6b4. Sol round 4: many 30-second runs with the clock rolled back each time still count
customer(0)
reply = 'network'
for (let i = 0; i < 14 * 24 * 60 + 10; i++) {
  lic.simulateRestartForChecks()
  lic.getLicenceState()
  mono += 30_000
  lic.getLicenceState()
}
assert.equal(lic.getLicenceState(), 'lapsed', '20,000 short runs with rollbacks: locked')

// 6b5. Sol round 5: the launch minute is paid in advance, not added on top
customer(0)
reply = 'network'
lic.getLicenceState()
mono += HOUR; now += HOUR
lic.getLicenceState()
assert.equal(store().get('offline_ms'), HOUR, 'one hour running counts exactly one hour')
customer(0)
for (let i = 0; i < 7 * 24 * 60; i++) {
  lic.simulateRestartForChecks()
  lic.getLicenceState()
  mono += 60_000; now += 60_000
  lic.getLicenceState()
}
assert.equal(lic.getLicenceState(), 'licensed', 'restart every minute for 7 days: 7 days counted, not 14')
assert.ok(Math.abs((store().get('offline_ms') as number) - 7 * DAY) <= 2 * 60_000, 'restart every minute: real time only')

// 6b6. Sol round 6: 119-second runs with the clock rolled back count all their running time
customer(0)
for (let i = 0; i < 100; i++) {
  lic.simulateRestartForChecks()
  lic.getLicenceState()
  mono += 119_000
  lic.getLicenceState()
}
assert.ok((store().get('offline_ms') as number) >= 100 * 118_000, '100 runs of 119 s: about 11,900 s counted')

// 6c. Clock moved forward a year while online: the check passes, still licensed
customer(HOUR)
now += 365 * DAY
reply = valid()
assert.equal(await pro(), true, 'clock forward + online: licensed')
await settle()
assert.equal(store().get('license_status'), 'active')
// 6d. Clock forward a year while offline: NOT locked (Sol round 2 scenario:
// two days after a good check, after many failed checks)
customer(2 * DAY)
reply = 'network'
await offlineHours(30)
now += 365 * DAY
assert.equal(await pro(), true, 'clock forward a year + offline: still licensed (counts 3 days)')
await offlineHours(5)
assert.equal(await pro(), true, '…a few hours later too')
// 6e. Clock forward but expired answer: locks
customer(HOUR)
now += 30 * DAY
reply = ls('expired')
await pro(); await settle()
assert.equal(await pro(), false)
assert.equal(store().get('license_status'), 'expired')

// 7. 2.0 -> 2.1 upgrade: an old 2.0 record (good check 90 days ago) gets a fresh grace
customer(0)
store().delete('last_check_attempt'); store().delete('offline_ms'); store().delete('last_seen')
store().set('validation_timestamp', iso(now - 90 * DAY))
reply = 'network'
assert.equal(await pro(), true, 'upgraded offline: not locked')
await settle()
await offlineDays(13)
assert.equal(await pro(), true, 'upgrade grace: day 13')
await offlineDays(1.5)
assert.equal(await pro(), false, 'upgrade grace ends after 14 days offline')
// …and a refunded 2.0 user online at upgrade is locked by the first check
customer(0)
store().delete('last_check_attempt'); store().delete('offline_ms'); store().delete('last_seen')
store().set('validation_timestamp', iso(now - 90 * DAY))
reply = ls('disabled')
await pro(); await settle()
assert.equal(await pro(), false, 'refunded 2.0 user locked after upgrade')
// A 2.0 offline save (never activated) unlocks nothing and makes no request
customer(0)
store().set('license_status', 'unvalidated')
assert.equal(await pro(), false)
assert.equal(calls.length, 0)
// Restarts don't re-check: a saved attempt 10 minutes ago means no request
customer(2 * DAY)
store().set('last_check_attempt', iso(now - 10 * 60 * 1000))
reply = valid()
assert.equal(await pro(), true)
await settle()
assert.equal(validates(), 0, 'saved attempt time throttles re-checks across restarts')

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

// 9. Races (Sol review)
// 9a. A key replaced while a check runs: the old answer is ignored
customer(2 * DAY)
reply = ls('expired')
gate = new Promise((r) => { open = r })
let p = lic.refreshLicence()
g.__pf.creds.set('license:key', 'NEW-KEY')
open(); gate = null
await p
assert.equal(store().get('license_status'), 'active', 'stale answer for the old key dropped')
// 9b. The SAME key re-activated while an "expired" check runs: the check is dropped
customer(2 * DAY)
reply = ls('expired')
gate = new Promise((r) => { open = r })
p = lic.refreshLicence()
await settle()
reply = { status: 200, body: { activated: true, license_key: { status: 'active' }, instance: { id: 'inst-9' }, meta: { product_id: PRO } } }
const act = lic.activateLicense('KEY')
open(); gate = null
await p; await act
assert.equal(store().get('license_status'), 'active', 'reactivation wins over an older check')
// 9c. Removing key A, then activating key B before A's removal answers: B survives
customer(HOUR)
g.__pf.creds.set('license:instance_id', 'inst-A')
reply = (url) => url.endsWith('/deactivate')
  ? { status: 200, body: { deactivated: true } }
  : { status: 200, body: { activated: true, license_key: { status: 'active' }, instance: { id: 'inst-B' }, meta: { product_id: PRO } } }
gate = new Promise((r) => { open = r })
const removing = lic.deactivateLicense()
await settle()
const activating = lic.activateLicense('KEY-B')
await settle()
assert.equal(calls.filter((c) => c.url.endsWith('/activate')).length, 0, 'activation waits for the removal')
open(); gate = null
assert.equal((await removing).success, true)
assert.equal((await activating).success, true)
assert.equal(g.__pf.creds.get('license:key'), 'KEY-B', 'B kept')
assert.equal(g.__pf.creds.get('license:instance_id'), 'inst-B')

// 10. S5: activation shows Lemon Squeezy's text and stores the instance ID
store().clear(); g.__pf.creds.clear(); calls.length = 0
reply = { status: 400, body: { activated: false, error: 'This license key has reached the activation limit.', license_key: { status: 'active', key: 'KEY' }, meta: { customer_email: 'a@b.c' } } }
const warned: string[] = []
console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')) }
let r = await lic.activateLicense('KEY')
assert.deepEqual(r, { success: false, message: 'This license key has reached the activation limit.' })
assert.ok(!warned.join('\n').includes('a@b.c'), 'activation errors log no customer details')
console.warn = () => {}
assert.equal(g.__pf.creds.get('license:key'), undefined, 'limit reached: nothing saved')
reply = { status: 404, body: { error: 'license_key not found.' } }
assert.equal((await lic.activateLicense('KEY')).message, 'License_key not found.')
reply = { status: 500, html: true }
assert.equal((await lic.activateLicense('KEY')).message, 'The licence server didn’t answer. Try again in a few minutes.')
reply = { status: 200, body: { activated: true, error: null, license_key: { status: 'active' }, instance: { id: 'inst-1' }, meta: { product_id: PRO } } }
r = await lic.activateLicense('KEY')
assert.equal(r.success, true)
assert.equal(calls.at(-1)!.timeoutMs, 10_000, 'activation timeout')
assert.equal(calls.at(-1)!.body.instance_name.startsWith('PeakFlow-'), true)
assert.equal(g.__pf.creds.get('license:instance_id'), 'inst-1', 'instance ID stored')
assert.equal(await pro(), true)
// 10b. Re-entering a key offline never touches the working licence (Sol P1)
reply = 'network'
for (const k of ['KEY', 'OTHER']) {
  r = await lic.activateLicense(k)
  assert.equal(r.success, false)
  assert.match(r.message, /Check your connection/)
  assert.equal(g.__pf.creds.get('license:key'), 'KEY', `offline ${k}: saved key kept`)
  assert.equal(g.__pf.creds.get('license:instance_id'), 'inst-1')
  assert.equal(store().get('license_status'), 'active')
  assert.equal(await pro(), true, `offline ${k}: still unlocked`)
}
// 10c. A refused activation (limit reached) never touches the working licence either
reply = { status: 400, body: { activated: false, error: 'This license key has reached the activation limit.' } }
await lic.activateLicense('OTHER')
assert.equal(g.__pf.creds.get('license:key'), 'KEY')
assert.equal(await pro(), true)

// 11. S5: Remove licence from this computer
reply = 'network'
r = await lic.deactivateLicense()
assert.equal(r.success, false, 'offline: nothing removed')
assert.equal(g.__pf.creds.get('license:key'), 'KEY')
for (const [label, rr] of [
  ['422 refused', { status: 422, body: { deactivated: false, error: 'The instance id field is required.' } }],
  ['200 deactivated:false', { status: 200, body: { deactivated: false, error: 'nope' } }],
  ['200 captive portal', { status: 200, html: true }],
  ['403', { status: 403, body: { error: 'Forbidden' } }],
  ['503', { status: 503, body: {} }],
  ['gateway 404', { status: 404, body: { error: 'Not Found' } }]
] as const) {
  reply = rr as Reply
  r = await lic.deactivateLicense()
  assert.equal(r.success, false, `${label}: not reported as removed`)
  assert.equal(g.__pf.creds.get('license:key'), 'KEY', `${label}: key kept`)
  assert.equal(g.__pf.creds.get('license:instance_id'), 'inst-1', `${label}: instance ID kept`)
}
const logged: string[] = []
console.log = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }
reply = { status: 200, body: { deactivated: true, error: null, license_key: { key: 'KEY-SECRET-123' }, meta: { customer_email: 'a@b.c' } } }
r = await lic.deactivateLicense()
console.log = () => {}
assert.deepEqual(r, { success: true, message: 'Licence removed' })
assert.ok(!logged.join('\n').includes('KEY-SECRET-123') && !logged.join('\n').includes('a@b.c'), 'no key or email in logs')
assert.deepEqual(calls.at(-1)!.body, { license_key: 'KEY', instance_id: 'inst-1' }, 'frees this instance')
assert.equal(g.__pf.creds.get('license:key'), undefined)
assert.equal(g.__pf.creds.get('license:instance_id'), undefined)
assert.equal((await checkAccess('PeakFlow')).hasLicenceKey, false)
// already gone on the server (404 not found): removed here too
customer(HOUR)
g.__pf.creds.set('license:instance_id', 'inst-x')
reply = { status: 404, body: { error: 'license_key instance not found.' } }
assert.equal((await lic.deactivateLicense()).success, true)
assert.equal(g.__pf.creds.get('license:key'), undefined)
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
assert.equal(c(200, { valid: false, license_key: { status: 'active' } }).kind, 'transient', 'only valid:true unlocks')
assert.equal(c(200, null).kind, 'transient')
assert.equal(c(404, { error: 'license_key not found.' }).kind, 'not_found', 'error-only 404')
assert.equal(c(404, { valid: false, error: 'license_key not found.', license_key: null }).kind, 'not_found')
assert.equal(c(404, { valid: false, license_key: { status: 'active' }, error: 'not found' }).kind, 'transient', '404 with a key is not "not found"')
assert.equal(c(404, { error: 'license_key instance not found.' }).kind, 'transient', 'instance not found is not key not found')
assert.equal(c(404, { error: 'Page missing' }).kind, 'transient', '404 without "not found" is not Lemon Squeezy')
assert.equal(c(404, { error: 'Not Found' }).kind, 'transient', 'a gateway 404 "Not Found" is not Lemon Squeezy')

console.info('licence: ok')
