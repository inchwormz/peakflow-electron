import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { RecordingStart } from '../../src/main/dictation/recording-start.ts'

test('cold press waits for listener ready, warm press dispatches immediately; canceled press never starts', () => {
  const sent: number[] = []
  const gate = new RecordingStart<number>((v) => sent.push(v))
  gate.start(1)
  assert.deepEqual(sent, [])
  gate.ready()
  assert.deepEqual(sent, [1])
  gate.start(2)
  assert.deepEqual(sent, [1, 2])
  gate.reset()
  gate.start(3)
  gate.cancel()
  gate.ready()
  assert.deepEqual(sent, [1, 2])
  gate.reset()
  gate.start(4)
  gate.start(5)
  gate.ready()
  assert.deepEqual(sent, [1, 2, 5])
})
test('pill transparency is applied before React; shared window backgrounds remain intact', () => {
  const html = readFileSync(new URL('../../src/renderer/index.html', import.meta.url), 'utf8')
  const bootstrap = readFileSync(new URL('../../src/renderer/public/dictation-route.js', import.meta.url), 'utf8')
  assert.ok(bootstrap.includes("get('toolId') === 'dictation'"))
  assert.ok(html.includes('<script src="./dictation-route.js"></script>'))
  assert.ok(!html.includes('<script>'), 'no CSP-blocked inline script')
  for (const selector of ['html[data-dictation-pill]', 'html[data-dictation-pill] body', 'html[data-dictation-pill] #root']) assert.ok(html.includes(selector))
  assert.ok(html.includes('background: #0a0a0a'))
})
