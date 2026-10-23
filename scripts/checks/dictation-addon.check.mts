/**
 * Check: the $5 dictation add-on client (server answers, errors, the usage line).
 * Run: node scripts/checks/dictation-addon.check.mts
 */
import assert from 'node:assert/strict'
process.env.TZ = 'UTC' // the renewal day is shown in local time
import { fetchAddonStatus, transcribeViaAddon, addonTidyFetch, usageLine } from '../../src/main/dictation/addon.ts'

const auth = { licence: '38b1460a-5104-4067-a91d-77b872934d51', deviceId: '0f8fad5b-d9cb-469f-a165-70867728950e' }
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

// The server's switch is off (or not deployed): the app carries on with the person's own key
assert.equal((await fetchAddonStatus(auth, reply(404, { error: 'off' }))).state, 'off')
assert.equal((await fetchAddonStatus(auth, reply(402, { error: 'no_addon' }))).state, 'none')
assert.equal((await fetchAddonStatus(null)).state, 'none', 'no licence: nothing is sent')
assert.deepEqual(await fetchAddonStatus(auth, reply(403, { error: 'too_many_devices' })), { state: 'error', error: 'devices' })
assert.equal((await fetchAddonStatus(auth, (async () => { throw new Error('offline') }) as unknown as typeof fetch)).state, 'error')
const active = await fetchAddonStatus(auth, reply(200, { balanceMicros: 3_750_000, usedSeconds: 4320, usedMicros: 320_000, periodEnd: '2026-11-22T12:00:00Z', refundCents: 375, exhausted: false }))
assert.equal(active.state, 'active')

// The approved copy
assert.equal(usageLine(active), 'This month: 1h 12m used (32¢). $3.75 comes back to your card on 22 November.')
assert.equal(usageLine({ ...active, exhausted: true }), 'You’ve used this month’s dictation. Add $5 to keep going, or it starts again on 22 November.')
assert.equal(usageLine({ ...active, refundCents: 0, usedSeconds: 50_400, usedMicros: 3_780_000 }), 'This month: 14h 0m used ($3.78).')

// Transcription: the licence and device go in headers, the server's errors map to plain ones
let sent: RequestInit | undefined
const ok = await transcribeViaAddon(new Uint8Array(2000), auth, { mime: 'audio/webm', prompt: 'Names: Iter0 — café', durationMs: 4200 }, (async (_u: string, init: RequestInit) => {
  sent = init
  return new Response(JSON.stringify({ text: ' hello there ', balanceMicros: 1 }))
}) as unknown as typeof fetch)
assert.deepEqual(ok, { ok: true, text: 'hello there', balanceMicros: 1 })
const h = sent?.headers as Record<string, string>
assert.equal(h.Authorization, `Licence ${auth.licence}`)
assert.equal(h['X-Device'], auth.deviceId)
assert.equal(h['X-Duration-Ms'], '4200')
assert.equal(decodeURIComponent(h['X-Prompt']), 'Names: Iter0 — café', 'non-ASCII survives the header')
assert.equal((await transcribeViaAddon(new Uint8Array(2000), auth, { mime: 'audio/webm', durationMs: 1 }, reply(402, { error: 'no_balance' }))).error, 'addon_empty')
assert.equal((await transcribeViaAddon(new Uint8Array(2000), auth, { mime: 'audio/webm', durationMs: 1 }, reply(429, { error: 'daily_limit' }))).error, 'addon_daily')
assert.equal((await transcribeViaAddon(new Uint8Array(10), auth, { mime: 'audio/webm', durationMs: 1 })).error, 'no_speech', 'tiny clip never sent')

// Clean-up goes to the server and comes back shaped like OpenAI's answer
const tidyFetch = addonTidyFetch(auth, (async (url: string, init: RequestInit) => {
  assert.match(url, /\/tidy$/)
  assert.deepEqual(JSON.parse(String(init.body)), { messages: [{ role: 'user', content: 'um hi' }] })
  return new Response(JSON.stringify({ text: 'Hi.' }))
}) as unknown as typeof fetch)
const r = await tidyFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'um hi' }] }) })
assert.deepEqual(await r.json(), { choices: [{ message: { content: 'Hi.' } }] })

console.log('dictation-addon: ok')

// The server address can only be changed to a local test server or getpeakflow.pro (development builds only)
{
  const { allowServerOverride, addonServer } = await import('../../src/main/dictation/addon.ts')
  for (const [raw, want] of [
    ['http://evil.example/api', 'https://getpeakflow.pro/api/dictation'],
    ['http://getpeakflow.pro/api/dictation', 'https://getpeakflow.pro/api/dictation'],
    ['https://getpeakflow.pro.evil.example/x', 'https://getpeakflow.pro/api/dictation'],
    ['http://localhost:3000/api/dictation/', 'http://localhost:3000/api/dictation'],
    ['https://preview.getpeakflow.pro/api/dictation', 'https://preview.getpeakflow.pro/api/dictation']
  ]) {
    process.env.PEAKFLOW_DICTATION_SERVER = raw
    allowServerOverride()
    assert.equal(addonServer(), want, raw)
  }
}
console.log('dictation-addon server override: ok')
