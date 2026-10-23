import assert from 'node:assert/strict'
import { accountHash, checkoutUrl, mapBalanceReply } from '../../src/main/dictation/account-core.ts'

const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
assert.equal(accountHash('  abc\n'), hash)
assert.equal(checkoutUrl(undefined, 'abc'), null)
assert.equal(checkoutUrl('', 'abc'), null)
assert.equal(checkoutUrl('https://shop.lemonsqueezy.com/buy/topup', ' '), null)
assert.equal(checkoutUrl('javascript:alert(1)', 'abc'), null)
assert.equal(checkoutUrl('https://evil.example/buy/topup', 'abc'), null)
const url = checkoutUrl('https://shop.lemonsqueezy.com/buy/topup?test=1', ' abc ')
assert.ok(url?.includes('checkout%5Bcustom%5D%5Baccount%5D='))
assert.equal(new URL(url!).searchParams.get('checkout[custom][account]'), hash)
assert.equal(new URL(url!).searchParams.get('test'), '1')
assert.deepEqual(mapBalanceReply(404, { error: 'off' }), { state: 'hidden' })
assert.deepEqual(mapBalanceReply(402, { error: 'no_addon' }), { state: 'no_addon' })
assert.deepEqual(mapBalanceReply(402, { error: 'other' }), { state: 'hidden' })
assert.deepEqual(mapBalanceReply(403, { error: 'too_many_devices' }), { state: 'hidden' })
assert.deepEqual(mapBalanceReply(401, { error: 'invalid_licence' }), { state: 'hidden' })
for (const state of ['ok', 'low', 'empty']) {
  const reply = { state, balanceMicros: 4070000, minutesLeft: 900, usedSeconds: 60, usedMicros: 1000, disabled: false }
  assert.deepEqual(mapBalanceReply(200, reply), { state, balanceMicros: 4070000, minutesLeft: 900, disabled: false })
}
for (const body of [null, {}, { state: 'ok', balanceMicros: -1, minutesLeft: 3 }, { state: 'ok', balanceMicros: 1, minutesLeft: Infinity }]) {
  assert.deepEqual(mapBalanceReply(200, body), { state: 'hidden' })
}
console.log('dictation-account: ok')
