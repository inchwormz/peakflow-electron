// Own-key clean-up: gpt-4.1-nano is retired, so clean-up runs on gpt-6-luna with the server's request shape
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLEANUP_MODEL, cleanUp, reasoningEffortFor, type MyWords } from '../../src/main/dictation/smart.ts'
import { addonTidyFetch } from '../../src/main/dictation/addon.ts'

const words: MyWords = { hints: ['PeakFlow', 'Siobhan'], replacements: [] }
const bytes = (s: string): number => new TextEncoder().encode(s).length
const messageBytes = (messages: Array<{ content: string }>): number => messages.reduce((s, m) => s + bytes(m.content), 0)

function capture(reply = 'Ship it tomorrow.') {
  const sent: { url?: string; headers?: Record<string, string>; body?: Record<string, any> } = {}
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.url = url
    sent.headers = init.headers as Record<string, string>
    sent.body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  }) as typeof fetch
  return { sent, fetchImpl }
}

test('default clean-up model is gpt-6-luna and the request matches the server path', async () => {
  assert.equal(CLEANUP_MODEL, 'gpt-6-luna')
  const { sent, fetchImpl } = capture()
  const r = await cleanUp('um ship it tomorrow', { key: 'k', words, fetchImpl })
  assert.equal(r.cleaned, true)
  assert.equal(r.text, 'Ship it tomorrow.')
  assert.equal(sent.body?.model, 'gpt-6-luna')
  assert.equal(sent.body?.temperature, 0)
  assert.equal(sent.body?.reasoning_effort, 'none')
  assert.equal(sent.body?.max_completion_tokens, 1000)
  assert.equal('max_tokens' in (sent.body ?? {}), false)
})

test('reasoning_effort matches what each model accepts', () => {
  assert.equal(reasoningEffortFor('gpt-6-luna'), 'none')
  assert.equal(reasoningEffortFor('gpt-5.1'), 'none')
  assert.equal(reasoningEffortFor('gpt-5.2'), 'none')
  assert.equal(reasoningEffortFor('gpt-5.4-mini'), 'none')
  assert.equal(reasoningEffortFor('gpt-5.4-nano'), 'none')
  assert.equal(reasoningEffortFor('gpt-5'), 'minimal')
  assert.equal(reasoningEffortFor('gpt-5-mini'), 'minimal')
  assert.equal(reasoningEffortFor('gpt-5-nano'), 'minimal')
  assert.equal(reasoningEffortFor('o3'), 'low')
  assert.equal(reasoningEffortFor('o4-mini'), 'low')
  assert.equal(reasoningEffortFor('gpt-4.1-mini'), null)
})

test('gpt-5.4-nano gets reasoning none and temperature 0', async () => {
  const { sent, fetchImpl } = capture()
  await cleanUp('ship it tomorrow', { key: 'k', words, model: 'gpt-5.4-nano', fetchImpl })
  assert.equal(sent.body?.model, 'gpt-5.4-nano')
  assert.equal(sent.body?.reasoning_effort, 'none')
  assert.equal(sent.body?.temperature, 0)
  assert.equal(sent.body?.max_completion_tokens, 1000)
})

test('gpt-5-nano and gpt-5-mini get reasoning minimal and no temperature', async () => {
  for (const model of ['gpt-5-nano', 'gpt-5-mini']) {
    const { sent, fetchImpl } = capture()
    await cleanUp('ship it tomorrow', { key: 'k', words, model, fetchImpl })
    assert.equal(sent.body?.model, model)
    assert.equal(sent.body?.reasoning_effort, 'minimal', model)
    assert.equal(sent.body?.max_completion_tokens, 1000)
    assert.equal('temperature' in (sent.body ?? {}), false, model)
  }
})

test('o-series models get reasoning low and no temperature', async () => {
  for (const model of ['o3', 'o4-mini']) {
    const { sent, fetchImpl } = capture()
    await cleanUp('ship it tomorrow', { key: 'k', words, model, fetchImpl })
    assert.equal(sent.body?.model, model)
    assert.equal(sent.body?.reasoning_effort, 'low', model)
    assert.equal(sent.body?.max_completion_tokens, 1000)
    assert.equal('temperature' in (sent.body ?? {}), false, model)
  }
})

test('non-reasoning models keep temperature 0 and get no reasoning fields', async () => {
  const { sent, fetchImpl } = capture()
  await cleanUp('ship it tomorrow', { key: 'k', words, model: 'gpt-4.1-mini', fetchImpl })
  assert.equal(sent.body?.temperature, 0)
  assert.equal('reasoning_effort' in (sent.body ?? {}), false)
  assert.equal('max_completion_tokens' in (sent.body ?? {}), false)
})

test('word list is cut to fit the server 8000-byte cap and the cut is logged once', async () => {
  const many: MyWords = { hints: Array.from({ length: 400 }, (_, i) => `Brandname${i}Long`), replacements: [] }
  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')) }
  try {
    const { sent, fetchImpl } = capture()
    await cleanUp('um hello there', { key: 'k', words: many, fetchImpl })
    const messages = sent.body?.messages as Array<{ content: string }>
    const total = messageBytes(messages)
    assert.ok(total <= 8000, `messages are ${total} bytes`)
    assert.ok(messages[0].content.includes('Brandname0Long'), 'first words kept, in order')
    assert.ok(!messages[0].content.includes('Brandname399Long'), 'last words dropped')
    await cleanUp('um hello there again', { key: 'k', words: many, fetchImpl })
    assert.equal(warnings.filter((w) => w.includes('word list cut')).length, 1, 'logged once per process')
  } finally {
    console.warn = realWarn
  }
})

test('a long dictation leaves room in the cap: hints shrink so the total stays under 8000 bytes', async () => {
  const many: MyWords = { hints: Array.from({ length: 300 }, (_, i) => `Name${i}`), replacements: [] }
  const longRaw = 'word '.repeat(1100) // about 5500 bytes: the hint list shrinks to what is left
  const { sent, fetchImpl } = capture()
  await cleanUp(longRaw, { key: 'k', words: many, fetchImpl })
  const messages = sent.body?.messages as Array<{ content: string }>
  assert.ok(messageBytes(messages) <= 8000, `messages are ${messageBytes(messages)} bytes`)
})

test('a 300-byte app name, the full word list and a 1000-byte dictation stay within 8000 bytes', async () => {
  const many: MyWords = { hints: Array.from({ length: 400 }, (_, i) => `Term${i}Word`), replacements: [] }
  const app = 'A'.repeat(300)
  const raw = 'x'.repeat(1000)
  const { sent, fetchImpl } = capture()
  await cleanUp(raw, { key: 'k', words: many, ctx: { app }, fetchImpl })
  const messages = sent.body?.messages as Array<{ content: string }>
  const total = messageBytes(messages)
  assert.ok(total <= 8000, `messages are ${total} bytes`)
  assert.ok(messages[0].content.includes(`It is being typed into ${app}.`), 'app line kept')
  assert.ok(messages[0].content.includes('Term0Word'), 'some word list still sent')
})

test('a dictation too long for one request is not sent: raw text returned, logged once', async () => {
  const warnings: string[] = []
  const realWarn = console.warn
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')) }
  try {
    let calls = 0
    const fetchImpl = (async () => { calls++; return new Response('{}') }) as typeof fetch
    const raw = 'word '.repeat(1700) // 8500 bytes on its own
    const r1 = await cleanUp(raw, { key: 'k', words, fetchImpl })
    const r2 = await cleanUp(raw, { key: 'k', words, fetchImpl })
    assert.equal(calls, 0, 'no request sent')
    assert.equal(r1.text, raw)
    assert.equal(r1.cleaned, false)
    assert.equal(r1.rejected, 'too long')
    assert.equal(r2.rejected, 'too long')
    assert.equal(warnings.filter((w) => w.includes('clean-up skipped: dictation too long for one request')).length, 1, 'logged once')
  } finally {
    console.warn = realWarn
  }
})

test('the add-on tidy fetch sends only { messages } and never the add-on placeholder as a key', async () => {
  const sent: { url?: string; headers?: Record<string, string>; body?: Record<string, any> } = {}
  const server = (async (url: string, init: RequestInit) => {
    sent.url = url
    sent.headers = init.headers as Record<string, string>
    sent.body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ text: 'Ship it tomorrow.' }))
  }) as typeof fetch
  const auth = { licence: 'LIC-TEST', deviceId: 'dev-test' }
  const r = await cleanUp('um ship it tomorrow', { key: 'add-on', words, fetchImpl: addonTidyFetch(auth, server) })
  assert.equal(r.cleaned, true)
  assert.equal(r.text, 'Ship it tomorrow.')
  assert.ok(sent.url?.endsWith('/tidy'), `url ${sent.url}`)
  assert.deepEqual(Object.keys(sent.body ?? {}), ['messages'], 'body is only messages')
  assert.equal(sent.headers?.Authorization, 'Licence LIC-TEST')
  assert.ok(!String(sent.headers?.Authorization).includes('add-on'), 'placeholder never sent as a key')
})

console.log('dictation-tidy-model: ok')
