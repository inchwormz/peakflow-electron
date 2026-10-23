/**
 * Check: tool actions run only with access (Sol review P1 #1), and only the
 * newest panel request may deliver its answer.
 * Run: node scripts/checks/access-guard.check.mts
 */
import assert from 'node:assert/strict'
import { withToolAccess } from '../../src/main/security/access-guard.ts'
import { createLatest } from '../../src/shared/latest-only.ts'

console.warn = () => {}
let ran = 0
const act = () => { ran++; return 'ran' }
const deny = () => 'denied'

assert.equal(await withToolAccess(async () => ({ allowed: true }), 'LiquidFocus', act, deny), 'ran')
assert.equal(ran, 1)
assert.equal(await withToolAccess(async () => ({ allowed: false }), 'LiquidFocus', act, deny), 'denied')
assert.equal(await withToolAccess(async () => { throw new Error('offline') }, 'FocusDim', act, deny), 'denied')
assert.equal(await withToolAccess(async () => ({}) as { allowed: boolean }, 'QuickBoard', act, deny), 'denied')
assert.equal(ran, 1, 'action never runs without access')

// Stale replies: request A (slow) then B; only B may deliver
const latest = createLatest()
const a = latest.next()
const b = latest.next()
assert.equal(a(), false)
assert.equal(b(), true)
latest.cancel()
assert.equal(b(), false, 'cancel drops the in-flight reply')

console.log('access-guard: ok')
