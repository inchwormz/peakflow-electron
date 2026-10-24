/**
 * Check (reviews S1, S13): one helper says when macOS forgot a permission
 * after an update, with John's wording, and the panel opens on the set-up
 * page at first launch, after a lost permission, or when PeakFlow runs from
 * Downloads or the disk image. The step-by-step guide shows while a
 * permission is off and says "All set" once it works again (John, 24 Oct 2026).
 * Real permissions-darwin.ts, fake Electron.
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

// ─── The visual guide: when it shows, and "All set" (John, 24 Oct 2026) ───
const M = await import(srcUrl('src/shared/mac-permissions.ts'))
const A = await import(srcUrl('src/shared/permission-art.ts'))
g.__m.inApps = true
g.__m.version = '2.1.4'
assert.equal(M.guideView(null), 'none', 'no answer yet (or not a Mac): nothing')
assert.equal(M.guideView(P.permissionStatus('accessibility')), 'all-set', 'it came back above (2.1.3): All set for a while')

// An update makes macOS forget Accessibility: the steps show
g.__m.ax = false
s = P.permissionStatus('accessibility')
assert.equal(s.lost, true)
assert.equal(M.guideView(s), 'steps')
const copy = M.guideCopy('accessibility', true)
assert.deepEqual(copy.steps.map((x: { art: string }) => x.art), ['remove', 'add', 'choose', 'switch'], 'four steps: −, +, choose PeakFlow, switch on')
assert.match(copy.title, /forgot PeakFlow after the update/)
assert.match(copy.steps[0].text, /click −/)
assert.match(M.guideCopy('accessibility', false).steps[0].text, /^If PeakFlow is already/, 'never granted: step 1 only if it is listed')

// "Open Settings" watches; the moment it works the panel comes back saying All set
let shown = 0
P.watchForFix('accessibility', () => shown++)
await new Promise((r) => setTimeout(r, 1700))
assert.equal(shown, 0, 'still off: keeps waiting')
g.__m.ax = true
await new Promise((r) => setTimeout(r, 1700))
assert.equal(shown, 1, 'works again: the panel opens')
s = P.permissionStatus('accessibility')
assert.equal(s.fixed, true)
assert.equal(M.guideView(s), 'all-set')
assert.equal(P.permissionStatus('accessibility').fixed, true, 'All set stays for a while, not one read')

// All set ends after ALL_SET_FOR_MS
const realNow = Date.now
Date.now = () => realNow() + P.ALL_SET_FOR_MS + 1000
assert.equal(M.guideView(P.permissionStatus('accessibility')), 'none', 'later: nothing')
Date.now = realNow

// Fixed while PeakFlow was closed (quit, fix, reopen): the set-up page says All set once
g.__m.ax = false
P.permissionStatus('accessibility') // seen off, remembered in the store
g.__m.ax = true
g.__m.version = '2.1.5'
assert.equal(P.macStartupRoute(), 'app/setup', 'after a fix: the set-up page shows All set')
assert.equal(P.permissionStatus('accessibility').fixed, true)

// Microphone fixed while PeakFlow was closed: the set-up page says All set too (Sol P2)
g.__m.mic = 'denied'
P.permissionStatus('microphone') // seen off
g.__m.mic = 'granted'
g.__m.version = '2.1.6'
assert.equal(P.macStartupRoute(), 'app/setup', 'Microphone fixed while closed: All set at launch')
assert.equal(P.macStartupRoute(), null, 'only once')

// Microphone not asked yet: no guide; denied: one step, switch off and on
g.__m.mic = 'not-determined'
assert.equal(M.guideView(P.permissionStatus('microphone')), 'none')
assert.deepEqual(M.guideCopy('microphone', true).steps.map((x: { art: string }) => x.art), ['toggle'])

// Sol P3: the Microphone picture says Microphone; "All set" keeps re-checking
assert.ok(A.permissionArt('toggle', 'x', M.guideArtLabels('microphone')).includes('>Microphone</text>'))
assert.ok(!A.permissionArt('toggle', 'x', M.guideArtLabels('camera')).includes('>Accessibility</text>'))
assert.equal(M.guideNeedsRecheck('steps'), true)
assert.equal(M.guideNeedsRecheck('all-set'), true, 'All set re-checks so it expires and a new loss shows')
assert.equal(M.guideNeedsRecheck('none'), false)

// The pictures: one SVG per step, labels escaped, light and dark colours inside
for (const step of ['remove', 'add', 'choose', 'switch', 'toggle']) {
  const svg = A.permissionArt(step, `Step <${step}>`)
  assert.match(svg, /^<svg class="pfa"/)
  assert.match(svg, /prefers-color-scheme: dark/)
  assert.ok(svg.includes('aria-label="Step &lt;' + step + '&gt;"'), 'label escaped')
}
assert.ok(A.permissionArt('choose', 'x', { ...A.ART_LABELS_EN, applications: 'Programme', open: 'Öffnen' }).includes('Öffnen'), 'German words drawn in')

console.info = log
console.info('mac-permissions: ok')
