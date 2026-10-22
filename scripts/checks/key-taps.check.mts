/**
 * Check: the dictation key's hold / tap / double-tap timing.
 * Run: node scripts/checks/key-taps.check.mts
 */
import assert from 'node:assert/strict'
import { KeyTaps, TAP_MS, DOUBLE_GAP_MS } from '../../src/main/launcher/key-taps.ts'

const run = (steps: Array<[('down' | 'up' | 'cancel'), number]>): string[] => {
  const k = new KeyTaps()
  return steps.flatMap(([e, t]) => k.feed(e, t))
}

// A hold passes straight through to dictation
assert.deepEqual(run([['down', 0], ['up', 2000]]), ['down', 'up'])
// One tap passes through (dictation drops it as too short): no double
assert.deepEqual(run([['down', 0], ['up', 120]]), ['down', 'up'])
// Two quick taps: the second press is swallowed, then 'double'
assert.deepEqual(run([['down', 0], ['up', 100], ['down', 250], ['up', 330]]), ['down', 'up', 'double'])
// Gap too long: two separate taps
assert.deepEqual(run([['down', 0], ['up', 100], ['down', 100 + DOUBLE_GAP_MS + 1], ['up', 600]]), ['down', 'up', 'down', 'up'])
// Gap exactly at the limit still counts
assert.deepEqual(run([['down', 0], ['up', 100], ['down', 100 + DOUBLE_GAP_MS], ['up', 520]]), ['down', 'up', 'double'])
// First press was a hold: the next quick press is an ordinary press, not a double
assert.deepEqual(run([['down', 0], ['up', 1500], ['down', 1600], ['up', 1700]]), ['down', 'up', 'down', 'up'])
// Tap, then press and hold: the second press never starts dictation, and no double
assert.deepEqual(run([['down', 0], ['up', 100], ['down', 200], ['up', 200 + TAP_MS + 500]]), ['down', 'up'])
// Triple tap: one double, then the third tap starts fresh
assert.deepEqual(
  run([['down', 0], ['up', 80], ['down', 200], ['up', 280], ['down', 400], ['up', 480]]),
  ['down', 'up', 'double', 'down', 'up']
)
// Four quick taps: two doubles
assert.deepEqual(
  run([['down', 0], ['up', 80], ['down', 200], ['up', 280], ['down', 400], ['up', 480], ['down', 600], ['up', 680]]),
  ['down', 'up', 'double', 'down', 'up', 'double']
)
// A shortcut (another key joins in) cancels and breaks the double
assert.deepEqual(run([['down', 0], ['cancel', 50], ['up', 90], ['down', 200], ['up', 260]]), ['down', 'cancel', 'up', 'down', 'up'])
// Cancel during the second press: swallowed, no double
assert.deepEqual(run([['down', 0], ['up', 80], ['down', 200], ['cancel', 230], ['up', 260]]), ['down', 'up', 'up'])

console.log('key-taps: ok')
