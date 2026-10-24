// $5 / $10 / $20 top-ups (John, 24 Oct 2026: "just did 5/10/20 no need for 15")
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as core from '../../src/main/dictation/account-core.ts'
import { accountHash } from '../../src/main/dictation/account-core.ts'
import { mapBalanceReply } from '../../src/main/dictation/addon.ts'

const reply = { state: 'ok', balanceMicros: 4070000, minutesLeft: 900, usedSeconds: 0, usedMicros: 0, disabled: false, blocked: null }
const urls = {
  5: 'https://shop.lemonsqueezy.com/buy/five',
  10: 'https://shop.lemonsqueezy.com/buy/ten',
  20: 'https://shop.lemonsqueezy.com/buy/twenty'
}
function client(topupUrls: Record<number, string | undefined>, body: unknown = reply) {
  const opened: string[] = []
  const c = core.createAccountClient({
    topupUrls,
    readAuth: () => ({ licence: 'abc', deviceId: 'd' }),
    fetchStatus: async () => mapBalanceReply(200, body),
    openExternal: async (url: string) => { opened.push(url) }
  } as any)
  return { c, opened }
}

test('each amount opens its own prefilled checkout with the account hash', async () => {
  const { c, opened } = client(urls)
  for (const amount of [5, 10, 20]) assert.equal(await c.openDictationCheckout(amount), true)
  assert.deepEqual(opened.map((u) => new URL(u).pathname), ['/buy/five', '/buy/ten', '/buy/twenty'])
  for (const u of opened) assert.equal(new URL(u).searchParams.get('checkout[custom][account]'), accountHash('abc'))
})

test('the account lists only amounts whose URL is set, in order', async () => {
  assert.deepEqual((await client(urls).c.getDictationAccount() as any).amounts, [5, 10, 20])
  assert.deepEqual((await client({ 20: urls[20], 5: urls[5], 10: '', 15: 'https://shop.lemonsqueezy.com/buy/fifteen' }).c.getDictationAccount() as any).amounts, [5, 20])
  assert.deepEqual((await client(urls, { error: 'no_addon' }).c.getDictationAccount() as any), { state: 'hidden' }) // 200 with a bad body
  assert.deepEqual(await client({}).c.getDictationAccount(), { state: 'hidden' })
})

test('unknown, unset or non-number amounts never open a checkout', async () => {
  const { c, opened } = client({ 5: urls[5], 20: urls[20] })
  for (const amount of [10, 15, 7, 0, -5, '5', null, undefined, 5.5, { amount: 5 }]) assert.equal(await c.openDictationCheckout(amount as any), false, String(amount))
  assert.deepEqual(opened, [])
  assert.equal(await c.openDictationCheckout(20), true)
})

test('a disabled account opens no checkout for any amount', async () => {
  const { c, opened } = client(urls, { ...reply, disabled: true })
  for (const amount of [5, 10, 20]) assert.equal(await c.openDictationCheckout(amount), false)
  assert.deepEqual(opened, [])
})

// The amount choice, Get dictation and Add $N buttons moved to the Dictation
// tool page (24 Oct 2026). Their rules, including AM1 and AM2 below, are
// checked in dictation-tool.check.mts against src/shared/dictation-view.ts.

test('no page or pill text still promises a fixed $5 top-up', () => {
  const view = readFileSync(new URL('../../src/shared/dictation-view.ts', import.meta.url), 'utf8')
  const index = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
  assert.ok(!view.includes("'Add $5'") && !view.includes('Add $5 to keep going'))
  assert.ok(index.includes("addon_empty: 'Dictation is paused. Top up in PeakFlow › Dictation'"))
  assert.ok(index.includes('openDictationCheckout(amount)'))
})

test('[NO15] only $5, $10 and $20 are offered, even when a stale $15 URL is configured', async () => {
  const { c, opened } = client({ ...urls, 15: 'https://shop.lemonsqueezy.com/buy/fifteen' })
  assert.deepEqual([...core.TOPUP_AMOUNTS], [5, 10, 20])
  assert.equal(core.isTopupAmount(15), false)
  assert.equal(await c.openDictationCheckout(15), false)
  assert.deepEqual(opened, [])
  for (const path of ['src/shared/dictation-account.ts', 'src/main/dictation/account-core.ts', 'src/main/dictation/account.ts', 'src/main/env.d.ts', 'src/main/dictation/addon.ts']) {
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    assert.ok(!/TOPUP_URL_15|\$15|\b5 \| 10 \| 15|\b15: import/.test(text), path)
  }
})
