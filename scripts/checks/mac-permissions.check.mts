/**
 * Check (reviews S1, S13): one helper says when macOS forgot a permission
 * after an update, with John's wording, and the panel opens on the set-up
 * page at first launch, after a lost permission, or when PeakFlow runs from
 * Downloads or the disk image. Real permissions-darwin.ts, fake Electron.
 * Run: node scripts/checks/mac-permissions.check.mts (macOS paths; skipped elsewhere)
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

if (process.platform !== 'darwin') {
  console.log('mac-permissions: skipped (not macOS)')
  process.exit(0)
}
type M = { ax: boolean; mic: string; inApps: boolean; version: string; store: Map<string, unknown>; moved: number }
const g = globalThis as unknown as { __m: M }
g.__m = { ax: false, mic: 'not-determined', inApps: true, version: '2.1.1', store: new Map(), moved: 0 }
const S = 'globalThis.__m'
installTsHooks({
  electron: fake(`export const systemPreferences = {
      isTrustedAccessibilityClient: () => ${S}.ax,
      getMediaAccessStatus: (k) => k === 'microphone' ? ${S}.mic : 'not-determined' };
    export const app = { isPackaged: true, isInApplicationsFolder: () => ${S}.inApps, getVersion: () => ${S}.version,
      getPath: () => '/Users/x/Downloads', moveToApplicationsFolder: () => { ${S}.moved++; return true } };
    export const dialog = { showMessageBox: async () => ({ response: 1 }) };
    export const shell = { openExternal: async () => {} };`),
  'electron-store': fake(`export default class {
    constructor(o) { this.d = o.defaults }
    get(k) { return ${S}.store.has(k) ? ${S}.store.get(k) : this.d[k] } set(k, v) { ${S}.store.set(k, v) } }`)
})
console.log = () => {}
const P = await import(srcUrl('src/main/services/permissions-darwin.ts'))
const { FORGOT_ACCESSIBILITY } = await import(srcUrl('src/shared/mac-permissions.ts'))
const log = console.info

// First launch: the set-up page, inside the panel (no dialog)
assert.equal(P.macStartupRoute(), 'app/setup')
assert.equal(P.macStartupRoute(), null, 'not again on the next launch of the same version')
// An install from before this release (no record) with Accessibility missing: once
g.__m.version = '2.1.1-b'
assert.equal(P.macStartupRoute(), 'app/setup', 'pre-2.1.1 record, Accessibility missing: shown once for this version')
assert.equal(P.macStartupRoute(), null)

// Never granted: the advice still says what to do when the switch is already on
let s = P.permissionStatus('accessibility')
assert.equal(s.granted, false)
assert.equal(s.lost, false)
assert.match(s.advice, /click −, then \+ and add it again/)

// Granted, then an unsigned update makes macOS forget it
g.__m.ax = true
assert.equal(P.permissionStatus('accessibility').granted, true)
g.__m.ax = false
g.__m.version = '2.1.2'
s = P.permissionStatus('accessibility')
assert.equal(s.lost, true)
assert.ok(s.advice.startsWith(FORGOT_ACCESSIBILITY), 'John’s exact words')
assert.equal(P.macStartupRoute(), 'app/setup', 'lost after an update: the set-up page once')
assert.equal(P.macStartupRoute(), null)

// Microphone: not asked yet is not "off"; granted then lost says so
assert.equal(P.permissionStatus('microphone').undecided, true)
g.__m.mic = 'granted'
P.permissionStatus('microphone')
g.__m.mic = 'denied'
s = P.permissionStatus('microphone')
assert.equal(s.lost, true)
assert.match(s.advice, /forgot PeakFlow after the update/)

// Running from Downloads or the disk image: offer the move, once per version
g.__m.ax = true
g.__m.inApps = false
g.__m.version = '2.1.3'
assert.equal(P.appLocation(), 'elsewhere')
assert.equal(P.macStartupRoute(), 'app/setup')
assert.equal(P.macStartupRoute(), null)
assert.equal(P.moveToApplications(), true)
assert.equal(g.__m.moved, 1)

console.info = log
console.info('mac-permissions: ok')
