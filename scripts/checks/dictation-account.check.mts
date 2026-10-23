import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import * as core from '../../src/main/dictation/account-core.ts'
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
test('missing blocked maps to null', () => {
  for (const state of ['ok', 'low', 'empty']) {
    const reply = { state, balanceMicros: 4070000, minutesLeft: 900, usedSeconds: 60, usedMicros: 1000, disabled: false }
    assert.deepEqual(mapBalanceReply(200, reply), { state, balanceMicros: 4070000, minutesLeft: 900, disabled: false, blocked: null })
  }
})
for (const body of [null, {}, { state: 'ok', balanceMicros: -1, minutesLeft: 3 }, { state: 'ok', balanceMicros: 1, minutesLeft: Infinity }]) {
  assert.deepEqual(mapBalanceReply(200, body), { state: 'hidden' })
}


const reply = { state: 'ok', balanceMicros: 4070000, minutesLeft: 900, disabled: false, blocked: null }
const buyLink = 'https://shop.lemonsqueezy.com/buy/topup'
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const rowCode = transformSync(readFileSync(new URL('../../src/renderer/src/launcher/DictationAccountRow.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
function render(account: unknown): string {
  const mod = { exports: {} as any }
  let reads = 0
  const rowRequire = (id: string): unknown => {
    if (id === 'react') return { ...React, useState: (initial: unknown) => [reads++ === 0 ? account : initial, () => {}], useEffect: () => {} }
    if (id === '@shared/ipc-types') return { IPC_INVOKE: {}, IPC_SEND: {} }
    if (id === '../panel/hooks') return { invoke: () => { throw new Error('unexpected IPC') } }
    return require(id)
  }
  new Function('require', 'module', 'exports', rowCode)(rowRequire, mod, mod.exports)
  return renderToStaticMarkup(mod.exports.DictationAccountRow()).replaceAll('&#x27;', "'")
}
function fixture(body: unknown = reply) {
  let key = 'abc'
  let device = 'device-a'
  let answer = body
  const requests: { key: string; device: string }[] = []
  const opened: string[] = []
  let pending: (() => Promise<void>) | undefined
  const client = core.createAccountClient({
    topupUrl: buyLink, apiUrl: 'https://example.test/api/dictation',
    readLicence: () => key, readDevice: () => device,
    fetch: async (_url: URL, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      requests.push({ key: headers.Authorization, device: headers['X-Device'] })
      const result = answer
      await pending?.()
      return { status: 200, json: async () => result }
    },
    openExternal: async (url: string) => { opened.push(url) }
  })
  return { client, requests, opened, setKey: (value: string) => { key = value }, setDevice: (value: string) => { device = value }, setAnswer: (value: unknown) => { answer = value }, waitOn: (value: () => Promise<void>) => { pending = value } }
}
for (const disabled of [{ disabled: true, blocked: null }, { disabled: false, blocked: 'disabled' }]) {
  test(`disabled via ${disabled.disabled ? 'flag' : 'blocked'} hides purchases and refuses checkout`, async () => {
    const body = { ...reply, state: 'empty', ...disabled }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const html = render(body)
    assert.ok(html.includes('Dictation is switched off for this licence. Email contact@getpeakflow.pro for help.'))
    assert.ok(!html.includes('<button') && !html.includes('Add $5') && !html.includes('Get dictation'))
    const f = fixture(body)
    assert.equal(await f.client.openDictationCheckout(), false)
    assert.deepEqual(f.opened, [])
  })
}
test('daily limit keeps balance, adds the message, and only low/empty offers a purchase', () => {
  for (const state of ['ok', 'low', 'empty']) {
    const body = { ...reply, state, blocked: 'daily_limit' }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const html = render(body)
    assert.ok(html.includes('$4.07 left'))
    assert.ok(html.includes("You've used today's 3 hours. Dictation is back within 24 hours."))
    assert.equal(html.includes('<button'), state !== 'ok')
  }
})
test('negative safe integer balance stays empty with paused message and Add $5, without an amount', () => {
  for (const balanceMicros of [-500000, Number.MIN_SAFE_INTEGER]) {
    const body = { ...reply, state: 'empty', balanceMicros, minutesLeft: 0 }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const html = render(mapBalanceReply(200, body))
    assert.ok(html.includes('Dictation is paused. Add $5 to keep going.'))
    assert.ok(html.includes('<button') && html.includes('Add $5'))
    assert.ok(!html.includes(' left') && !html.includes('$-'))
  }
  assert.deepEqual(mapBalanceReply(200, { ...reply, balanceMicros: Number.MIN_SAFE_INTEGER - 1 }), { state: 'hidden' })
})
test('checkout uses the same licence for balance headers and account hash', async () => {
  const f = fixture()
  assert.equal(await f.client.openDictationCheckout(), true)
  assert.deepEqual(f.requests, [{ key: 'Licence abc', device: 'device-a' }])
  assert.equal(new URL(f.opened[0]).searchParams.get('checkout[custom][account]'), accountHash('abc'))
})
test('licence change during balance refetches before opening, including disabled replacement', async () => {
  for (const disabled of [false, true]) {
    const f = fixture()
    f.waitOn(async () => { f.setKey('new-key'); f.setAnswer({ ...reply, disabled }) })
    assert.equal(await f.client.openDictationCheckout(), !disabled)
    assert.deepEqual(f.requests.map((r) => r.key), ['Licence abc', 'Licence new-key'])
    assert.equal(f.opened.length, disabled ? 0 : 1)
    if (!disabled) assert.equal(new URL(f.opened[0]).searchParams.get('checkout[custom][account]'), accountHash('new-key'))
  }
})
test('concurrent callers share one request per licence/device, then fetch afresh', async () => {
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.waitOn(() => gate)
  const first = f.client.getDictationAccount()
  const second = f.client.getDictationAccount()
  const checkout = f.client.openDictationCheckout()
  assert.equal(f.requests.length, 1)
  f.setKey('other')
  const other = f.client.getDictationAccount()
  assert.equal(f.requests.length, 2)
  f.setDevice('device-b')
  const device = f.client.getDictationAccount()
  assert.equal(f.requests.length, 3)
  release()
  const results = await Promise.all([first, second, other, device])
  assert.deepEqual(results, [reply, reply, reply, reply])
  assert.equal(await checkout, true)
  assert.equal(f.requests.length, 3) // checkout shares the replacement licence's in-flight answer
  await f.client.getDictationAccount()
  assert.equal(f.requests.length, 4)
})
test('failed balance is hidden and does not leave a stuck in-flight request', async () => {
  const f = fixture()
  f.waitOn(async () => { throw new Error('offline') })
  assert.deepEqual(await f.client.getDictationAccount(), { state: 'hidden' })
  f.waitOn(async () => {})
  assert.deepEqual(await f.client.getDictationAccount(), reply)
  assert.equal(f.requests.length, 2)
})
