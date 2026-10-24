// $5 / $10 / $20 top-ups (John, 24 Oct 2026: "Add the ability to add 10 , 15 or 20", then "just did 5/10/20 no need for 15")
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
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
  assert.deepEqual((await client({ 20: urls[20], 5: urls[5], 10: '', 15: 'https://shop.lemonsqueezy.com/buy/fifteen' } as any).c.getDictationAccount() as any).amounts, [5, 20])
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

// ─── the settings row ────────────────────────────────────────────────────────

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const rowCode = transformSync(readFileSync(new URL('../../src/renderer/src/launcher/DictationAccountRow.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
function render(account: unknown, chosen?: number): string {
  const mod = { exports: {} as any }
  let reads = 0
  const rowRequire = (id: string): unknown => {
    if (id === 'react') return { ...React, useState: (initial: unknown) => { const i = reads++; return [i === 0 ? account : i === 3 && chosen !== undefined ? chosen : initial, () => {}] }, useEffect: () => {}, useRef: (v: unknown) => ({ current: v }) }
    if (id === '@shared/ipc-types') return { IPC_INVOKE: {}, IPC_SEND: {} }
    if (id === '../panel/hooks') return { invoke: () => { throw new Error('unexpected IPC') } }
    if (id === './dictation-refresh') return { watchAccount: () => ({ checkoutOpened: () => {}, stop: () => {} }) }
    return require(id)
  }
  new Function('require', 'module', 'exports', rowCode)(rowRequire, mod, mod.exports)
  return renderToStaticMarkup(mod.exports.DictationAccountRow()).replaceAll('&#x27;', "'")
}
const four = [5, 10, 20]

test('low and empty show the amount choice and an Add button for the chosen amount', () => {
  for (const state of ['low', 'empty']) {
    const html = render({ ...reply, state, amounts: four })
    assert.ok(html.includes('aria-label="Top-up amount"'), state)
    for (const a of four) assert.ok(html.includes(`>$${a}</button>`), `${state} $${a}`)
    assert.ok(html.includes('aria-pressed="true">$5</button>'))
    assert.ok(html.includes('Add $5</button>'))
    assert.ok(render({ ...reply, state, amounts: four }, 10).includes('Add $10</button>'))
  }
  assert.ok(render({ ...reply, state: 'empty', amounts: four }).includes('Dictation is paused. Top up to keep going.'))
})

test('Get dictation offers the same amount choice', () => {
  const html = render({ state: 'no_addon', amounts: four })
  assert.ok(html.includes('Get dictation</button>') && html.includes('aria-label="Top-up amount"'))
  assert.ok(html.includes('$5 buys about 15 hours of talking. Unused time never expires.'))
})

test('unset amounts are hidden; one amount shows no choice', () => {
  const two = render({ ...reply, state: 'low', amounts: [5, 20] })
  assert.ok(two.includes('>$20</button>') && !two.includes('>$10</button>') && !two.includes('>$15</button>'))
  const one = render({ ...reply, state: 'low', amounts: [10] })
  assert.ok(!one.includes('Top-up amount') && one.includes('Add $10</button>'))
  assert.ok(!render({ ...reply, amounts: four }).includes('Top-up amount'), 'ok balance offers nothing')
  assert.ok(!render({ ...reply, state: 'empty', disabled: true, amounts: four }).includes('<button'), 'disabled offers nothing')
})

test('[NO15] there is no $15 top-up anywhere in the app (the store sells $5, $10 and $20)', () => {
  const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  assert.deepEqual([...core.TOPUP_AMOUNTS], [5, 10, 20])
  for (const f of ['src/shared/dictation-account.ts', 'src/main/dictation/account-core.ts', 'src/main/dictation/account.ts', 'src/main/env.d.ts', 'src/main/dictation/addon.ts']) {
    assert.ok(!/TOPUP_URL_15|\$15|\b5 \| 10 \| 15|\b15: import/.test(read(f)), f)
  }
})

test('no row text or pill text still promises a fixed $5 top-up', () => {
  const row = readFileSync(new URL('../../src/renderer/src/launcher/DictationAccountRow.tsx', import.meta.url), 'utf8')
  const index = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
  assert.ok(!row.includes("'Add $5'") && !row.includes('Add $5 to keep going'))
  assert.ok(index.includes("addon_empty: 'Dictation is paused. Top up in Launcher Settings'"))
  assert.ok(index.includes('openDictationCheckout(amount)'))
})

// ─── review round 1 (24 Oct, Sol app 1 P2; Sol app 2 P3) ────────────────────

test('[AM1] with one amount and no choice shown, Get dictation names the price', () => {
  for (const a of [5, 10, 20]) {
    const html = render({ state: 'no_addon', amounts: [a] })
    assert.ok(html.includes(`Get dictation for $${a}</button>`), String(a))
    assert.ok(!html.includes('Top-up amount'))
  }
  assert.ok(render({ state: 'no_addon', amounts: four }).includes('>Get dictation</button>'), 'the choice shows the price when there are several')
})

test('[AM2] a chosen amount that is no longer offered falls back to the smallest offered one', () => {
  const html = render({ ...reply, state: 'low', amounts: [5, 20] }, 10)
  assert.ok(html.includes('aria-pressed="true">$5</button>') && html.includes('Add $5</button>'))
  assert.ok(render({ ...reply, state: 'low', amounts: [10, 20] }, 20).includes('Add $20</button>'))
})
