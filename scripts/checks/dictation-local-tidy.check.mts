import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localTidy, needsTidy, parseMyWords, intentGuard } from '../../src/main/dictation/smart.ts'
const words = parseMyWords('PeakFlow\nSiobhan')

test('only one leading standalone um/uh is removed, preserving the remaining text', () => {
  for (const prefix of ['Um, ', 'uh ', 'UH,']) {
    const raw = prefix + 'Please send it today.'
    const text = localTidy(raw, words)
    assert.equal(text, 'Please send it today.')
    assert.equal(intentGuard(raw, text!, words), null)
  }
  for (const raw of ['Um, Do not send $1,200.', 'Uh, Siobhan will send it.', 'Um, Only send three copies.']) {
    assert.equal(localTidy(raw, words), raw.replace(/^(Um|Uh), /, ''))
  }
})

test('corrections, further fillers, repetition, quoted speech and name conflicts defer to remote tidy', () => {
  for (const raw of [
    'Um, Send five no wait six.', 'Uh, I mean do not send it.', 'Um, Do not not send it.',
    'Um, Please please send it.', 'Um, You know the name.', 'Um, Uh send it today.',
    'Um, "Please send it today."', "Uh, 'Please send it today.'", 'Um, “Please send it today.”', 'Um, Please send `it` today.', 'Um, Please send «it» today.',
    'Um, Please send\nit today.', 'Um, Please send peak flow today.', 'Umm, Please send it today.',
    'Umber please send it today.', 'Um. Please send it today.', 'Um, please send it today.',
    'Um, Please send it today', 'Um, Send it.', 'Please send it today.'
  ]) assert.equal(localTidy(raw, words), null, raw)
  assert.equal(localTidy('Um, Please send it today.', parseMyWords('Um')), null)
  assert.equal(localTidy('Uh, Please send it today.', parseMyWords('Uh Huh')), null)
  assert.equal(needsTidy('Please send it today.', words), false, 'the existing clean bypass remains')
})

test('word and character caps apply after removing the filler', () => {
  assert.equal(localTidy('Um, One two three.', words), 'One two three.')
  const sentence = 'One ' + Array.from({ length: 19 }, (_, i) => `w${i}`).join(' ') + '.'
  assert.equal(localTidy('Um, ' + sentence, words), sentence)
  assert.equal(localTidy('Um, ' + sentence + ' extra.', words), null)
  assert.equal(localTidy('Um, One ' + 'x'.repeat(150) + ' three.', words), null)
})
