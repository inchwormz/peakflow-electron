/**
 * Check: the watchdog's dialog guard always closes exactly once, including
 * when a dialog promise never settles (finding 9).
 * Run: node scripts/checks/modal-guard.check.mts
 */
import assert from 'node:assert/strict'
import { guardModal } from '../../src/main/services/modal-guard.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let depth = 0
const open = () => { depth++ }
const close = () => { depth-- }

// sync dialog
assert.equal(guardModal(() => 7, null, open, close, 50)(), 7)
assert.equal(depth, 0)

// throwing dialog
assert.throws(() => guardModal(() => { throw new Error('boom') }, null, open, close, 50)())
assert.equal(depth, 0)

// async dialog that settles (resolve and reject)
await guardModal(() => Promise.resolve(1), null, open, close, 50)()
await guardModal(() => Promise.reject(new Error('x')), null, open, close, 50)().catch(() => {})
assert.equal(depth, 0)

// async dialog that never settles: depth returns to 0 after the cap
guardModal(() => new Promise(() => {}), null, open, close, 50)()
assert.equal(depth, 1)
await sleep(80)
assert.equal(depth, 0, 'never-settling dialog must stop pausing the watchdog')

// settling after the cap does not close twice
let late: (v: unknown) => void = () => {}
guardModal(() => new Promise((r) => { late = r }), null, open, close, 30)()
await sleep(50)
late(1)
await sleep(5)
assert.equal(depth, 0, 'close fires exactly once')

// this binding is preserved
const obj = { v: 3, get(this: { v: number }) { return this.v } }
assert.equal(guardModal(obj.get, obj, open, close, 50)(), 3)

console.log('modal-guard check: OK')
