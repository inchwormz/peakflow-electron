/**
 * Check: the v2 30-day trial in every state, through the REAL trial.ts,
 * access-check.ts and license.ts. Only storage is faked (electron-store,
 * safeStorage, the credential store) so stored dates and keys can be set up.
 * States: fresh install, mid-trial, migrated 14-day users (mixed old and new
 * records, expired-but-under-30-days, hidden-tool-only, corrupt fields), the
 * saved end being reused, expired, licensed (Pro and one tool), v1 keys.
 * Run: node scripts/checks/trial.check.mts
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
globalThis.fetch = (async () => { throw new Error('offline in tests') }) as typeof fetch

const trial = await import(srcUrl('src/main/security/trial.ts'))
const { checkAccess } = await import(srcUrl('src/main/security/access-check.ts'))
const { PANEL_TOOLS } = await import(srcUrl('src/shared/tool-ids.ts'))

const store = () => (g.__pf.stores['peakflow-license'] ??= new Map())
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000 - 60000).toISOString()
const TOOLS = ['focusdim', 'liquidfocus', 'screenslap', 'quickboard']

/** What index.ts does on every launch, in order. */
function launch(): void {
  trial.migrateExistingInstalls()
  if (!trial.isToolInstalled('PeakFlow')) trial.installTool('PeakFlow')
  trial.ensureTrialExpiry()
  trial.autoInstallTools(PANEL_TOOLS)
}
function reset(): void {
  store().clear()
  g.__pf.creds.clear()
}
async function access(): Promise<Record<string, { allowed: boolean; daysRemaining: number; message: string }>> {
  const out: Record<string, { allowed: boolean; daysRemaining: number; message: string }> = {}
  for (const t of [...TOOLS, 'PeakFlow']) out[t] = await checkAccess(t)
  return out
}
async function allTools(days: number, label: string): Promise<void> {
  const a = await access()
  for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].daysRemaining], [days > 0, days], `${label}: ${t}`)
}
function license(productId: number | null): void {
  g.__pf.creds.set('license:key', 'TEST-KEY')
  if (productId !== null) g.__pf.creds.set('license:product_id', String(productId))
  store().set('validation_timestamp', new Date().toISOString())
  store().set('license_status', 'active')
}

assert.equal(trial.TRIAL_DAYS, 30)

// 1. Fresh install: the trial starts by itself, every tool is on, 30 days
reset()
launch()
for (const t of TOOLS) assert.equal(trial.isToolInstalled(t), true, `${t} on without a Turn on step`)
await allTools(30, 'fresh')
assert.equal((await checkAccess('PeakFlow')).daysRemaining, 30)

// 2. Mid-trial: first launched 12 days ago (end saved then), 18 days left
reset()
trial.ensureTrialExpiry(new Date(Date.now() - 12 * 86400000))
launch()
await allTools(18, 'mid-trial')

// 3a. Migrated v1 user, mixed old and new per-tool starts: FocusDim 50 days ago,
//     QuickBoard 5 days ago. The LATEST start wins: 25 days left on every tool.
reset()
store().set('storefront_migrated', true)
store().set('install_date', 'enc:' + daysAgo(50))
store().set('tool_install_focusdim', 'enc:' + daysAgo(50))
store().set('tool_install_quickboard', daysAgo(5)) // old plaintext date also counts
launch()
await allTools(25, 'mixed')

// 3b. Migrated v1 user whose 14 days ran out (started 20 days ago): open again, 10 days left
reset()
store().set('install_date', 'enc:' + daysAgo(20))
store().set('tool_install_liquidfocus', 'enc:' + daysAgo(20))
launch()
await allTools(10, 're-opened')

// 3c. Only a hidden-tool record (MeetReady, 5 days ago) and an old install date:
//     hidden tools and the install date don't count, so 30 days from this launch
reset()
store().set('storefront_migrated', true)
store().set('install_date', 'enc:' + daysAgo(100))
store().set('tool_install_meetready', 'enc:' + daysAgo(5))
store().set('tool_install_soundsplit', 'enc:' + daysAgo(80))
launch()
await allTools(30, 'hidden-only')

// 3d. Corrupt / missing fields: skipped, never thrown
reset()
store().set('storefront_migrated', true)
store().set('tool_install_focusdim', 'garbage')
store().set('tool_install_quickboard', 12345)
store().set('tool_install_screenslap', 'enc:not-a-date')
store().set('tool_install_liquidfocus', 'enc:' + daysAgo(10))
launch()
await allTools(20, 'corrupt records skipped')
reset()
store().set('trial_expires_at', 'enc:###')
store().set('tool_install_focusdim', { bad: true })
assert.doesNotThrow(() => launch())
await allTools(30, 'corrupt saved end recomputed')
// …and a licensed user with everything corrupt is still let in
reset()
store().set('trial_expires_at', ['x'])
store().set('install_date', 'garbage')
store().set('tool_install_quickboard', null)
launch()
license(822965)
for (const t of TOOLS) assert.equal((await checkAccess(t)).allowed, true, `licensed + corrupt: ${t}`)

// 3e. The end is saved once and reused: a newer record later doesn't move it
reset()
store().set('tool_install_focusdim', 'enc:' + daysAgo(20))
launch() // 10 days left, saved
const saved = store().get('trial_expires_at')
store().set('tool_install_screenslap', 'enc:' + new Date().toISOString())
launch()
assert.equal(store().get('trial_expires_at'), saved, 'saved end reused on the next launch')
await allTools(10, 'reused')

// 3f. Forged plaintext end (T5): a future date typed into the store as plain
//     text is ignored; the genuine (expired) records decide, and the end is
//     saved encrypted again
reset()
for (const t of TOOLS) store().set(`tool_install_${t}`, 'enc:' + daysAgo(45))
store().set('trial_expires_at', new Date(Date.now() + 365 * 86400000).toISOString())
launch()
for (const t of TOOLS) assert.equal((await checkAccess(t)).allowed, false, `forged plaintext end ignored: ${t}`)
assert.match(String(store().get('trial_expires_at')), /^enc:/, 'end re-saved encrypted')
// also once a genuine encrypted end exists, replacing it with plain text doesn't help
store().set('trial_expires_at', new Date(Date.now() + 365 * 86400000).toISOString())
launch()
assert.equal((await checkAccess('focusdim')).allowed, false)

// 4. Expired (all four started 40-60 days ago, no licence): every tool locked
reset()
for (const [t, d] of [['focusdim', 60], ['liquidfocus', 45], ['screenslap', 40], ['quickboard', 41]] as const) store().set(`tool_install_${t}`, 'enc:' + daysAgo(d))
launch()
let a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].message], [false, 'trial_expired'], `expired: ${t}`)
// relaunching never restarts the clock
launch()
assert.equal((await checkAccess('quickboard')).allowed, false)

// 4b. Last hour of the trial counts as a day; once the end passes it is locked
reset()
store().set('trial_expires_at', 'enc:' + new Date(Date.now() + 3600000).toISOString())
launch()
assert.equal((await checkAccess('focusdim')).daysRemaining, 1)
reset()
store().set('trial_expires_at', 'enc:' + new Date(Date.now() - 1000).toISOString())
launch()
assert.equal((await checkAccess('focusdim')).allowed, false)

// 5. Licensed (Pro / all tools), trial long over: never locked
reset()
store().set('trial_expires_at', 'enc:' + daysAgo(400))
launch()
license(822965) // PeakFlow Pro monthly
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].message], [true, 'Licensed'], `Pro: ${t}`)

// 5b. Own-it for one tool after the trial: that tool open, the others locked
reset()
store().set('trial_expires_at', 'enc:' + daysAgo(30))
launch()
license(861329) // FocusDim, own it
a = await access()
assert.equal(a.focusdim.allowed, true)
for (const t of ['liquidfocus', 'screenslap', 'quickboard']) assert.deepEqual([a[t].allowed, a[t].message], [false, 'tool_not_licensed'])
// …and during the trial every tool is open for them too
reset()
launch()
license(861329)
a = await access()
for (const t of TOOLS) assert.equal(a[t].allowed, true, `own-it in trial: ${t}`)

// 6. v1 keys keep working in v2 (v1 buyers get v2 free)
for (const [label, product] of [['v1 suite perpetual', 863806], ['v1 subscription', 841306], ['v1 annual', 875766], ['v1 legacy key (no product id)', null]] as const) {
  reset()
  store().set('trial_expires_at', 'enc:' + daysAgo(470))
  launch()
  license(product)
  a = await access()
  for (const t of TOOLS) assert.equal(a[t].allowed, true, `${label}: ${t}`)
}
// a v1 key offline with an expired cache still counts (last good activation)
reset()
store().set('trial_expires_at', 'enc:' + daysAgo(470))
launch()
license(863806)
store().set('validation_timestamp', daysAgo(90))
assert.equal((await checkAccess('quickboard')).allowed, true, 'offline v1 key not locked out')

console.info('trial: ok')
