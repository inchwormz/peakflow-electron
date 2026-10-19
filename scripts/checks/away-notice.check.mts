/**
 * Check: the "Looked away" notice lives in main's timer state, so a mini that
 * is created or still loading when the reset happens shows it instead of
 * closing on idle; Start again / Close clear it (Sol review 2, P2).
 * Part 1 drives the real LiquidFocusService (src/main/services/liquidfocus.ts;
 * electron, its store and config are fakes). Part 2 drives the mini's real
 * decision code (src/renderer/src/tools/liquidfocus/mini-card.ts) with those states.
 * Run: node scripts/checks/away-notice.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

installTsHooks({
  electron: fake('export const BrowserWindow = { getAllWindows: () => [] }'),
  'electron-store': fake('export default class { constructor() { this.m = new Map() } get(k, d) { return this.m.has(k) ? this.m.get(k) : d } set(k, v) { this.m.set(k, v) } }'),
  './config-store': fake(`export const getConfig = () => ({ work_duration: 25, short_break: 5, long_break: 15, sessions_before_long: 4,
    focus_detection_enabled: true, focus_away_threshold_secs: 5, focus_away_action: 'reset', sound_enabled: false, auto_start_breaks: false, auto_start_work: false })`)
})
console.log = () => {}
const { getLiquidFocusService, initLiquidFocus, destroyLiquidFocus } = await import(srcUrl('src/main/services/liquidfocus.ts'))
const { miniStep } = await import(srcUrl('src/renderer/src/tools/liquidfocus/mini-card.ts'))

initLiquidFocus()
const lf = getLiquidFocusService()

// ── Part 1: main keeps the notice until it's acted on
lf.start()
assert.equal(lf.getTimerState().awayReset, false)
const afterAway = lf.resetFocusAfterAway()
assert.equal(afterAway.status, 'idle')
assert.equal(afterAway.awayReset, true, 'reset remembers why')
assert.equal(lf.getState().timer.awayReset, true, 'a late mini fetching state gets it')
assert.equal(lf.dismissAwayNotice().awayReset, false, 'Close clears it')
lf.start(); lf.resetFocusAfterAway()
assert.equal(lf.start().awayReset, false, 'Start again clears it')
lf.resetFocusAfterAway(); assert.equal(lf.reset().awayReset, false, 'Stop clears it')
lf.start(); lf.resetFocusAfterAway(); assert.equal(lf.skip().awayReset, false, 'Skip clears it')
lf.reset()

// ── Part 2: the mini, created after the reset, sees idle + notice as its FIRST state
lf.start()
const away = lf.resetFocusAfterAway()
let step = miniStep(null, away, null)
assert.deepEqual(step, { card: 'away', window: 'card' }, 'late mini shows the notice instead of closing')
// a repeat of the same state changes nothing
assert.deepEqual(miniStep(away, away, 'away'), {})
// Close: main clears the notice; the idle state that follows closes the mini
const dismissed = lf.dismissAwayNotice()
assert.deepEqual(miniStep(away, dismissed, 'away'), { card: null, window: 'close' })
// Start again: back to the running pill
lf.reset(); lf.start()
const away2 = lf.resetFocusAfterAway()
assert.deepEqual(miniStep(away2, lf.start(), 'away'), { card: null, window: 'pill' })
// Without a notice, a mini that opens on idle still closes itself (unchanged)
lf.reset()
assert.deepEqual(miniStep(null, lf.getTimerState(), null), { window: 'close' })

destroyLiquidFocus()
console.info('away-notice: ok')
