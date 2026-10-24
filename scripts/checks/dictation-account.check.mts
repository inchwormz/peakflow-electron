import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as core from '../../src/main/dictation/account-core.ts'
import { accountHash, checkoutUrl, accountFromStatus } from '../../src/main/dictation/account-core.ts'
import { payView, buyLabel, COPY } from '../../src/shared/dictation-view.ts'

import { mapBalanceReply as parseBalanceReply } from '../../src/main/dictation/addon.ts'
const mapBalanceReply = (status: number, body: unknown) => accountFromStatus(parseBalanceReply(status, body))

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
assert.deepEqual(mapBalanceReply(403, { error: 'too_many_devices' }), { state: 'devices' })
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
// The balance and buy buttons moved from the launcher row to the Dictation tool
// page (24 Oct 2026); these checks now run against its rules (dictation-view.ts).
const view = (account: any) => payView(account) as any
function fixture(body: unknown = reply) {
  let key = 'abc'
  let device = 'device-a'
  let answer = body
  const requests: { key: string; device: string }[] = []
  const opened: string[] = []
  let pending: (() => Promise<void>) | undefined
  const client = core.createAccountClient({
    topupUrls: { 5: buyLink },
    readAuth: () => ({ licence: key, deviceId: device }),
    fetchStatus: async (auth) => {
      requests.push({ key: `Licence ${auth.licence}`, device: auth.deviceId })
      const result = answer
      await pending?.()
      return parseBalanceReply(200, result)
    },
    openExternal: async (url: string) => { opened.push(url) }
  })
  return { client, requests, opened, setKey: (value: string) => { key = value }, setDevice: (value: string) => { device = value }, setAnswer: (value: unknown) => { answer = value }, waitOn: (value: () => Promise<void>) => { pending = value } }
}
for (const disabled of [{ disabled: true, blocked: null }, { disabled: false, blocked: 'disabled' }]) {
  test(`disabled via ${disabled.disabled ? 'flag' : 'blocked'} hides purchases and refuses checkout`, async () => {
    const body = { ...reply, state: 'empty', ...disabled }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const v = view({ ...body, amounts: [5] })
    assert.equal(v.notice, 'Dictation is switched off for this licence. Email contact@getpeakflow.pro for help.')
    assert.deepEqual(v.amounts, [], 'no amount, so no Add or Get dictation button')
    assert.equal(v.line, null)
    const f = fixture(body)
    assert.equal(await f.client.openDictationCheckout(5), false)
    assert.deepEqual(f.opened, [])
  })
}
// Changed 24 Oct 2026: the tool page offers Add in every balance state (John: "your balance and Add $5–$20"), not only low/empty
test('daily limit keeps balance, adds the message, and offers Add', () => {
  for (const state of ['ok', 'low', 'empty']) {
    const body = { ...reply, state, blocked: 'daily_limit' }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const v = view({ ...body, amounts: [5] })
    assert.ok(v.line.includes('US$4.07 left'))
    assert.equal(v.notice, COPY.dailyLimit)
    assert.deepEqual(v.amounts, [5])
  }
})
test('negative safe integer balance stays empty with paused message and an Add button, without an amount', () => {
  for (const balanceMicros of [-500000, Number.MIN_SAFE_INTEGER]) {
    const body = { ...reply, state: 'empty', balanceMicros, minutesLeft: 0 }
    assert.deepEqual(mapBalanceReply(200, body), body)
    const v = view({ ...mapBalanceReply(200, body), amounts: [5] })
    assert.equal(v.notice, 'Dictation is paused. Top up to keep going.')
    assert.equal(buyLabel(v, 5), 'Add US$5')
    assert.deepEqual(v.amounts, [5])
    assert.equal(v.line, null)
  }
  assert.deepEqual(mapBalanceReply(200, { ...reply, balanceMicros: Number.MIN_SAFE_INTEGER - 1 }), { state: 'hidden' })
})
test('checkout uses the same licence for balance headers and account hash', async () => {
  const f = fixture()
  assert.equal(await f.client.openDictationCheckout(5), true)
  assert.deepEqual(f.requests, [{ key: 'Licence abc', device: 'device-a' }])
  assert.equal(new URL(f.opened[0]).searchParams.get('checkout[custom][account]'), accountHash('abc'))
})
test('licence change during balance refetches before opening, including disabled replacement', async () => {
  for (const disabled of [false, true]) {
    const f = fixture()
    f.waitOn(async () => { f.setKey('new-key'); f.setAnswer({ ...reply, disabled }) })
    assert.equal(await f.client.openDictationCheckout(5), !disabled)
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
  const checkout = f.client.openDictationCheckout(5)
  assert.equal(f.requests.length, 1)
  f.setKey('other')
  const other = f.client.getDictationAccount()
  assert.equal(f.requests.length, 2)
  f.setDevice('device-b')
  const device = f.client.getDictationAccount()
  assert.equal(f.requests.length, 3)
  release()
  const results = await Promise.all([first, second, other, device])
  assert.deepEqual(results, Array(4).fill({ ...reply, amounts: [5] }))
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
  assert.deepEqual(await f.client.getDictationAccount(), { ...reply, amounts: [5] })
  assert.equal(f.requests.length, 2)
})

test('the tool page shows each balance state and purchase action', () => {
  assert.deepEqual(view({ state: 'hidden' }), { kind: 'own-key' })
  const offer = view({ state: 'no_addon', amounts: [5] })
  assert.equal(COPY.offer, 'US$5 buys about 15 hours of talking. Unused time never expires.')
  assert.equal(buyLabel(offer, 5), 'Get dictation for US$5')
  const ok = view({ ...reply, amounts: [5] })
  assert.equal(ok.line, 'US$4.07 left · about 15 hours')
  assert.equal(buyLabel(ok, 5), 'Add US$5')
  assert.deepEqual(view(reply).amounts, [], 'no buy link, no button')
  for (const body of [{ ...reply, state: 'empty', amounts: [5] }, { ...reply, balanceMicros: -1, amounts: [5] }]) {
    const v = view(body)
    assert.equal(v.notice, 'Dictation is paused. Top up to keep going.')
    assert.equal(buyLabel(v, 5), 'Add US$5')
    assert.equal(v.line, null)
  }
  assert.deepEqual(view({ state: 'devices' }), { kind: 'devices' })
  assert.equal(COPY.devices, 'Dictation is already on two other computers.')
})
test('one server client and device source, one add-on settings row, and clip refresh wiring', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const account = read('src/main/dictation/account.ts')
  assert.ok(account.includes('fetchStatus: fetchAddonStatus'))
  assert.ok(!account.includes('MAIN_VITE_DICTATION_API_URL') && !account.includes('electron-store'))
  const index = read('src/main/dictation/index.ts')
  assert.ok(index.includes('createDictationAccountClient(addonAuth)'))
  assert.ok(index.includes('if (auth) void refreshAddon(true)'))
  assert.ok(index.includes("addon_empty: 'Dictation is paused. Top up in PeakFlow › Dictation'"))
  assert.ok(index.includes('webContents.send(IPC_SEND.DICTATION_ACCOUNT_CHANGED)'))
  const page = read('src/renderer/src/panel/tools/dictation/index.tsx')
  assert.ok(/useIpcEvent\(IPC_SEND\.DICTATION_ACCOUNT_CHANGED, \(\) => \{\s*reloadAccount\(\)\s*\/\/[^\n]*\n\s*reloadS\(\)/.test(page), 'balance and settings reload together')
  assert.ok(/!viaAddon\(\) && Date\.now\(\) - catchUpAt > 10_000\) \{\s*catchUpAt = Date\.now\(\)\s*void refreshAddon\(true\)/.test(index), 'a fresh purchase catches main up, one direction only')
  assert.ok(page.includes('useIpcEvent(IPC_SEND.LICENSE_STATUS_CHANGED, reloadAccount)'))
  assert.equal(page.split('IPC_INVOKE.DICTATION_CHECKOUT').length - 1, 1, 'one buy path')
})

test('same-state disabled changes reapply the hold watcher', async () => {
  const source = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
  const path = source.slice(source.indexOf('const viaAddon ='), source.indexOf('function settings():'))
  const code = transformSync(path, { loader: 'ts', format: 'cjs' }).code
  for (const disabled of [{ disabled: true, blocked: null }, { disabled: false, blocked: 'disabled' }]) {
    let next = { ...reply, ...disabled }
    const run = new Function('fetchAddonStatus', `
      let addon = { state: 'none' }, addonCheckedAt = 0, addonRefresh = null, addonRetry = null
      let watcherUpdates = 0
      const addonAuth = () => ({ licence: 'abc', deviceId: 'device' })
      const applyWatcher = () => { watcherUpdates++ }
      const settings = () => ({ enabled: false })
      const getPill = () => {}
      const BrowserWindow = { getAllWindows: () => [] }
      const IPC_SEND = {}
      const console = { log: () => {} }
      ${code}
      return { refresh: () => refreshAddon(true), updates: () => watcherUpdates, usable: viaAddon }
    `)(async () => next)
    await run.refresh()
    assert.equal(run.usable(), false)
    assert.equal(run.updates(), 1)
    next = reply
    await run.refresh()
    assert.equal(run.usable(), true)
    assert.equal(run.updates(), 2)
    next = { ...reply, ...disabled }
    await run.refresh()
    assert.equal(run.usable(), false)
    assert.equal(run.updates(), 3)
  }
})
