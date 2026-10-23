/**
 * Check: a dictation that can't be turned into text is kept to try again,
 * long clips get a longer limit, and the copy names Ctrl+V on Windows
 * (review finding S11, 24 Oct 2026: "Dictation loses what was said when the connection drops").
 * Run: node scripts/checks/dictation-retry.check.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transcribeTimeoutMs, keepsClip, sayTryAgain, pasteKeys, KEEP_CLIP_MS, ownerForSend, mayRetry } from '../../src/main/dictation/retry.ts'

const src = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('the limit grows with the clip: 30 s plus half its length, at most 5 minutes', () => {
  assert.equal(transcribeTimeoutMs(0), 30_000)
  assert.equal(transcribeTimeoutMs(4_000), 32_000)
  assert.equal(transcribeTimeoutMs(60_000), 60_000)
  assert.equal(transcribeTimeoutMs(5 * 60_000), 180_000, 'the longest recording (5 min) gets 3 minutes')
  assert.equal(transcribeTimeoutMs(20 * 60_000), 300_000)
  assert.equal(transcribeTimeoutMs(-5), 30_000)
  assert.equal(transcribeTimeoutMs(Number.NaN), 30_000)
  assert.equal(transcribeTimeoutMs(10_000, 45_000), 45_000, "the add-on keeps its 45 s floor")
})

test('every failure keeps the audio except an empty clip or no microphone', () => {
  for (const e of ['network', 'failed', 'model_unavailable', 'bad_key', 'no_key', 'addon_empty', 'addon_devices', 'addon_daily', 'addon_off'] as const) assert.equal(keepsClip(e), true, e)
  for (const e of ['no_speech', 'mic_denied', 'mic_none'] as const) assert.equal(keepsClip(e), false, e)
  assert.equal(sayTryAgain('network'), true)
  assert.equal(sayTryAgain('addon_empty'), false, 'its own message already says where to top up')
  assert.equal(KEEP_CLIP_MS, 30 * 60_000)
})

test('Ctrl+V on Windows, ⌘V on a Mac', () => {
  assert.equal(pasteKeys(false), 'Ctrl+V')
  assert.equal(pasteKeys(true), '⌘V')
  assert.ok(!src('src/main/dictation/index.ts').includes("'Copied: press ⌘V to paste'"))
})

test('wiring: failures keep the clip, every transcription call gets the scaled limit, and both places can try again', () => {
  const main = src('src/main/dictation/index.ts')
  assert.ok(main.includes('keepClip(kept ? clip : null)'))
  assert.ok(main.includes('if (keptClip) keepClip(null)'), 'a success clears it')
  const calls = main.slice(main.indexOf('async function runClip'), main.indexOf('const sttMs'))
  assert.equal((calls.match(/await transcribe\(/g) ?? []).length, 3)
  assert.equal((calls.match(/stream: true, timeoutMs \}/g) ?? []).length, 3)
  assert.ok(calls.includes('timeoutMs: transcribeTimeoutMs(durationMs, 45_000)'))
  assert.ok(/IPC_INVOKE\.DICTATION_RETRY, async \(e\) => \{\s*if \(!fromUi\(e\)/.test(main), 'only the panel or launcher can retry')
  assert.ok(src('src/main/launcher/index.ts').includes("id === 'dictation:retry'"))
  assert.ok(src('src/renderer/src/panel/tools/dictation/index.tsx').includes('IPC_INVOKE.DICTATION_RETRY'))
})

test('[R2] a connection that drops mid-stream keeps the clip and frees dictation', () => {
  const main = src('src/main/dictation/index.ts')
  const run = main.slice(main.indexOf('async function runClip('), main.indexOf('async function runClipSteps'))
  assert.ok(/try \{\s*await runClipSteps\(clip\)\s*\} catch/.test(run))
  assert.ok(run.includes('keepClip(clip)') && run.includes("fail('network', true)"), 'fail() also clears busy')
  assert.ok(/function fail[^]*?busy = false/.test(main))
})

test('[R3] a kept clip stays with the account it was first sent under', () => {
  // Recorded under A, the key changes to B while the request is out, the request fails: still A's
  const sentUnder = ownerForSend(undefined, 'A')
  assert.equal(sentUnder, 'A')
  assert.equal(mayRetry(sentUnder, 'B'), false, 'B is never billed for A')
  assert.equal(mayRetry(sentUnder, 'A'), true)
  // Recorded with no key and no licence: the first account it is sent with owns it from then on
  const first = ownerForSend('', 'A')
  assert.equal(first, 'A')
  assert.equal(mayRetry(first, 'B'), false, 'after a try under A it never goes to B')
  assert.equal(mayRetry('', 'A'), true, 'before any try, adding a key can send it')
  assert.equal(ownerForSend('A', 'B'), 'A', 'a retry never changes the owner')
})

test('[R3] wiring: the owner is fixed before the first request and checked before every retry', () => {
  const main = src('src/main/dictation/index.ts')
  const run = main.slice(main.indexOf('async function runClip('), main.indexOf('async function runClipSteps'))
  assert.ok(run.indexOf('ownerForSend(sent.owner, clipOwner())') < run.indexOf('await runClipSteps(clip)'))
  assert.ok(main.includes("owner: clip.owner ?? ''"), 'keepClip never takes the current credentials')
  assert.ok(main.includes('!mayRetry(keptClip.owner, clipOwner())'))
  assert.ok(main.includes("return key || licence ? createHash('sha256')"))
  const at = main.indexOf('export async function retryDictation')
  assert.ok(main.slice(at, main.indexOf('/** The last dictation, for', at)).includes('getKeptDictation() ? keptClip : null'))
})

test('[R4] the audio is dropped 30 minutes after recording even if PeakFlow sits untouched', () => {
  const main = src('src/main/dictation/index.ts')
  const keep = main.slice(main.indexOf('function keepClip'), main.indexOf('/** Keep recording this long'))
  assert.ok(keep.includes('keptTimer = setTimeout(() => keepClip(null), KEEP_CLIP_MS - (Date.now() - keptClip.at))'))
  assert.ok(keep.includes('if (keptTimer) clearTimeout(keptTimer)'))
  assert.ok(!main.includes('{ ...clip, at: Date.now() }'), 'a failed retry no longer restarts the clock')
})
