import assert from 'node:assert/strict'
import { test } from 'node:test'
import { historyTime } from '../../src/shared/dictation-history-time.ts'

test('recent times are short, with calendar yesterday and NZ date order', () => {
  const now = new Date(2026, 9, 26, 12)
  const ago = (ms: number) => historyTime(now.getTime() - ms, now)
  assert.equal(ago(0), 'Just now')
  assert.equal(ago(59_999), 'Just now')
  assert.equal(ago(60_000), '1 min ago')
  assert.equal(ago(300_000), '5 min ago')
  assert.equal(ago(7_200_000), '2 h ago')
  assert.equal(historyTime(new Date(2026, 9, 25, 23).getTime(), now), 'Yesterday')
  assert.equal(historyTime(new Date(2026, 9, 20).getTime(), now), 'Tue 20 Oct')
  assert.equal(historyTime(new Date(2025, 9, 20).getTime(), now), 'Mon 20 Oct 2025')
  assert.equal(historyTime(NaN, now), '')
  const midnight = new Date(2026, 9, 26, 0, 2)
  assert.equal(historyTime(new Date(2026, 9, 25, 23, 57).getTime(), midnight), 'Yesterday')
})
