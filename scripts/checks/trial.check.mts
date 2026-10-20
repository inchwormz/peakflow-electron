/**
 * Check: the v2 30-day trial in every state, through the REAL trial.ts,
 * access-check.ts and license.ts. Only storage is faked (electron-store,
 * safeStorage, the credential store) so stored dates and keys can be set up.
 * States: fresh install, mid-trial, migrated 14-day user (still in, and
 * expired-but-under-30-days), expired, licensed (Pro and one tool), v1 keys.
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
let a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].daysRemaining], [true, 30], `fresh: ${t}`)
assert.equal(a.PeakFlow.daysRemaining, 30)

// 2. Mid-trial (first opened 12 days ago): 18 days left on every tool
reset()
store().set('install_date', 'enc:' + daysAgo(12))
store().set('storefront_migrated', true)
launch()
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].daysRemaining], [true, 18], `mid-trial: ${t}`)

// 3a. Migrated v1 user, 14-day per-tool trial still running: 30 days from their FIRST start.
//     They started FocusDim 10 days ago and QuickBoard 3 days ago; never opened the others.
reset()
store().set('storefront_migrated', true)
store().set('tool_install_PeakFlow', 'enc:' + daysAgo(10))
store().set('tool_install_focusdim', 'enc:' + daysAgo(10))
store().set('tool_install_quickboard', daysAgo(3)) // old plaintext date also counts
launch()
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].daysRemaining], [true, 20], `migrated in-trial: ${t}`)

// 3b. Migrated v1 user whose 14 days ran out (started 20 days ago): open again, 10 days left
reset()
store().set('install_date', 'enc:' + daysAgo(20))
store().set('tool_install_liquidfocus', 'enc:' + daysAgo(20))
launch()
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].daysRemaining], [true, 10], `re-opened: ${t}`)

// 4. Expired (first opened 31 days ago, no licence): every tool locked
reset()
store().set('install_date', 'enc:' + daysAgo(31))
launch()
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].message], [false, 'trial_expired'], `expired: ${t}`)
// re-stamping on launch never restarts the clock (earliest date wins)
launch()
assert.equal((await checkAccess('quickboard')).allowed, false)

// 4b. Day 30 is the last day: 29 days and 23 hours in → still allowed; 30 days → locked
reset()
store().set('install_date', new Date(Date.now() - 29 * 86400000 - 23 * 3600000).toISOString())
launch()
assert.equal((await checkAccess('focusdim')).daysRemaining, 1)
reset()
store().set('install_date', new Date(Date.now() - 30 * 86400000).toISOString())
launch()
assert.equal((await checkAccess('focusdim')).allowed, false)

// 5. Licensed (Pro / all tools), trial long over: never locked
reset()
store().set('install_date', 'enc:' + daysAgo(400))
launch()
license(822965) // PeakFlow Pro monthly
a = await access()
for (const t of TOOLS) assert.deepEqual([a[t].allowed, a[t].message], [true, 'Licensed'], `Pro: ${t}`)

// 5b. Own-it for one tool after the trial: that tool open, the others locked
reset()
store().set('install_date', 'enc:' + daysAgo(60))
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
  store().set('install_date', 'enc:' + daysAgo(500))
  launch()
  license(product)
  a = await access()
  for (const t of TOOLS) assert.equal(a[t].allowed, true, `${label}: ${t}`)
}
// a v1 key offline with an expired cache still counts (last good activation)
reset()
store().set('install_date', 'enc:' + daysAgo(500))
launch()
license(863806)
store().set('validation_timestamp', daysAgo(90))
assert.equal((await checkAccess('quickboard')).allowed, true, 'offline v1 key not locked out')

console.info('trial: ok')
