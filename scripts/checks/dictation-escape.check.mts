import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EscapeSession } from '../../src/main/dictation/escape-session.ts'
import { readFileSync } from 'node:fs'

test('Esc passes at rest, consumes recording press/repeats and matching release after disarm', () => {
  const e = new EscapeSession()
  assert.deepEqual(e.feed(true), { swallow: false, cancel: false })
  e.recording = true
  assert.deepEqual(e.feed(true), { swallow: true, cancel: true })
  e.recording = false
  assert.deepEqual(e.feed(true), { swallow: true, cancel: false })
  assert.deepEqual(e.feed(false), { swallow: true, cancel: false })
  assert.deepEqual(e.feed(true), { swallow: false, cancel: false })
})
test('cancel path invalidates audio, drops pending start, and never sends a clip', () => {
  const s = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
  const cancel = s.slice(s.indexOf('function cancel()'), s.indexOf('async function onAudio'))
  assert.match(cancel, /send: false/)
  assert.match(cancel, /sessionId\+\+/)
  assert.match(cancel, /recordingStart.cancel\(\)/)
  assert.match(s, /onRecordingEscape\(\(\) => \{/)
  assert.match(s, /phase: 'cancelled', message: 'Cancelled'/)
})

test('actual Windows hook Esc branch pairs interception and forwards every idle Esc', () => {
  const hook = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
  const start = hook.indexOf('            if (k.vkCode == 27)')
  const branch = hook.slice(start, hook.indexOf('            HashSet<uint> physical', start))
    .replace(/\brecordingEscape\b/g, 'state.recordingEscape').replace(/\bescapeDown\b/g, 'state.escapeDown').replace(/new IntPtr\(1\)/g, '1')
  const feed = new Function('state', 'k', 'isDown', 'isUp', 'Emit', branch + ';return 0')
  const state = { recordingEscape: false, escapeDown: false }
  const emitted: string[] = []
  const key = (down: boolean) => feed(state, { vkCode: 27 }, down, !down, (s: string) => emitted.push(s))
  assert.equal(key(true), 0); assert.equal(key(false), 0)
  state.recordingEscape = true
  assert.equal(key(true), 1); assert.equal(key(true), 1)
  assert.deepEqual(emitted, ['recording-escape'])
  assert.equal(state.recordingEscape, false)
  assert.equal(key(false), 1)
  assert.equal(key(true), 0)
})
