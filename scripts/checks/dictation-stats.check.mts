import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isoWeek, addWeekly, weeklyNow, minutesSaved } from '../../src/shared/dictation-stats.ts'

test('ISO weeks use Monday and the ISO week-year across New Year', () => {
  assert.equal(isoWeek(new Date(2021, 0, 1)), '2020-W53')
  assert.equal(isoWeek(new Date(2021, 0, 4)), '2021-W01')
  assert.equal(isoWeek(new Date(2026, 9, 25)), '2026-W43')
  assert.equal(isoWeek(new Date(2026, 9, 26)), '2026-W44')
})
test('typed words and actual spoken duration accumulate independently of text history', () => {
  const now = new Date(2026, 9, 26)
  let s = addWeekly(undefined, 'one two three four', 6000, now)
  assert.deepEqual(s, { week: '2026-W44', words: 4, spokenSeconds: 6 })
  s = addWeekly(s, 'five six', 2000, now)
  assert.equal(s.words, 6); assert.equal(s.spokenSeconds, 8)
  assert.equal(minutesSaved(s), 0)
  assert.equal(minutesSaved({ ...s, words: 400, spokenSeconds: 60 }), 9)
  assert.equal(minutesSaved({ ...s, words: 80, spokenSeconds: 90 }), 1)
  assert.equal(addWeekly(s, 'new week', -100, new Date(2026, 10, 2)).words, 2)
  assert.equal(weeklyNow(s, new Date(2026, 10, 2)).spokenSeconds, 0)
})
