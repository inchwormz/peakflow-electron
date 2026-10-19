/**
 * Check: an AI transform result pastes only if its run is still the active
 * one; leaving the page, closing the panel or a retry drops it (Sol review P2 #3).
 * Mirrors AiRun in src/renderer/src/panel/tools/quickboard/ClipPages.tsx.
 * Run: node scripts/checks/stale-ai-paste.check.mts
 */
import assert from 'node:assert/strict'
import { createLatest } from '../../src/shared/latest-only.ts'

const pasted: string[] = []
function aiRun(latest: ReturnType<typeof createLatest>, reply: Promise<string>): Promise<void> {
  const isCurrent = latest.next()
  return reply.then((r) => {
    if (isCurrent()) pasted.push(r)
  })
}
const later = (v: string, ms: number) => new Promise<string>((r) => setTimeout(() => r(v), ms))

// User leaves (unmount / panel hidden) before the result arrives: no paste
let latest = createLatest()
let p = aiRun(latest, later('left', 10))
latest.cancel()
await p
assert.deepEqual(pasted, [])

// Retry while the first run is still going: only the retry pastes
latest = createLatest()
const first = aiRun(latest, later('first', 20))
const retry = aiRun(latest, later('retry', 5))
await Promise.all([first, retry])
assert.deepEqual(pasted, ['retry'])

// Normal run pastes
p = aiRun(createLatest(), later('ok', 1))
await p
assert.deepEqual(pasted, ['retry', 'ok'])

console.log('stale-ai-paste: ok')
