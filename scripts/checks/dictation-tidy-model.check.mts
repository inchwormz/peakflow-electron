// Own-key clean-up: gpt-4.1-nano is retired, so clean-up runs on gpt-6-luna with the server's request shape
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLEANUP_MODEL, cleanUp, type MyWords } from '../../src/main/dictation/smart.ts'

const words: MyWords = { hints: ['PeakFlow', 'Siobhan'], replacements: [] }

function capture(reply = 'Ship it tomorrow.') {
  const sent: { url?: string; body?: Record<string, any> } = {}
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.url = url
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

test('other reasoning models (gpt-5*, o-series) get max_completion_tokens and reasoning_effort, no temperature', async () => {
  for (const model of ['gpt-5.4-nano', 'o4-mini']) {
    const { sent, fetchImpl } = capture()
    await cleanUp('ship it tomorrow', { key: 'k', words, model, fetchImpl })
    assert.equal(sent.body?.model, model)
    assert.equal(sent.body?.max_completion_tokens, 1000)
    assert.equal(sent.body?.reasoning_effort, 'none')
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
    const total = messages.reduce((s, m) => s + new TextEncoder().encode(m.content).length, 0)
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
  const total = messages.reduce((s, m) => s + new TextEncoder().encode(m.content).length, 0)
  assert.ok(total <= 8000, `messages are ${total} bytes`)
})

console.log('dictation-tidy-model: ok')
