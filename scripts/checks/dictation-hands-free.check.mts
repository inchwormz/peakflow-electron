import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DictationGesture } from '../../src/main/dictation/gesture.ts'

test('two short presses lock; a single clean tap finishes', () => {
  const g = new DictationGesture()
  assert.equal(g.feed('down', 0), 'start')
  assert.equal(g.feed('up', 100), 'drop')
  assert.equal(g.feed('down', 450), 'start')
  assert.equal(g.feed('up', 550), 'lock')
  assert.equal(g.locked, true)
  assert.equal(g.feed('down', 900), 'none')
  assert.equal(g.feed('up', 1000), 'stop')
})
test('long holds, slow taps and shortcuts never lock or finish a locked session', () => {
  const g = new DictationGesture()
  g.feed('down', 0); assert.equal(g.feed('up', 300), 'stop')
  g.feed('down', 500); g.feed('up', 550)
  g.feed('down', 1000); assert.equal(g.feed('up', 1050), 'drop')
  g.feed('down', 1100); g.feed('cancel', 1150)
  assert.equal(g.feed('up', 1200), 'none')
  g.feed('down', 1300); g.feed('up', 1350); g.feed('down', 1400); g.feed('up', 1450)
  assert.equal(g.locked, true)
  g.feed('down', 1500); assert.equal(g.feed('cancel', 1550), 'none')
  assert.equal(g.feed('up', 1600), 'none'); assert.equal(g.locked, true)
  g.reset(); assert.equal(g.locked, false)
})
