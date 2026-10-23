/**
 * Check: QuickBoard's AI page only starts and only pastes while the panel is
 * open on that page (Sol re-review P2 #3). Drives the real run logic that
 * AiRun (ClipPages.tsx) uses, src/renderer/src/panel/tools/quickboard/ai-run.ts,
 * in the order the props arrive.
 * Run: node scripts/checks/ai-run.check.mts
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@shared/')) return { url: pathToFileURL(join(root, 'src/shared', spec.slice(8) + '.ts')).href, shortCircuit: true }
    return next(spec, ctx)
  }
})
const { createAiRun } = await import(pathToFileURL(join(root, 'src/renderer/src/panel/tools/quickboard/ai-run.ts')).href)

const tick = () => new Promise((r) => setTimeout(r, 0))
function harness() {
  const log: string[] = []
  let reply: (v: { ok: boolean; result?: string; error?: string }) => void = () => {}
  const run = createAiRun({
    transform: (type: string) => {
      log.push(`ai:${type}`)
      return new Promise((r) => { reply = r })
    },
    paste: (id: string, text: string) => log.push(`paste:${id}:${text}`),
    hide: () => log.push('hide'),
    leave: () => log.push('leave'),
    setState: (s: { phase: string; error: string }) => log.push(`state:${s.phase}${s.error ? ':' + s.error : ''}`)
  })
  return { run, log, reply: (v: { ok: boolean; result?: string; error?: string }) => reply(v) }
}
const clip = { id: 'c1', type: 'text' }
const props = (o: object) => ({ clip, text: 'hello', type: 'fix', lang: undefined, attempt: 0, visible: true, ...o })

// 1. The reviewed sequence: panel closes while history is loading, then history arrives
{
  const h = harness()
  h.run.update(props({ clip: undefined }))
  h.run.update(props({ clip: undefined, visible: false }))
  h.run.update(props({ visible: false }))
  await tick()
  assert.deepEqual(h.log, ['leave'], 'no AI start and no paste while hidden')
}

// 2. Panel closes while the AI is running: its result never pastes
{
  const h = harness()
  h.run.update(props({}))
  h.run.update(props({ visible: false }))
  h.reply({ ok: true, result: 'Hello.' })
  await tick()
  assert.deepEqual(h.log, ['state:run', 'ai:fix', 'leave'])
}

// 3. Leaving the page (unmount) while the AI runs: no paste
{
  const h = harness()
  h.run.update(props({}))
  h.run.dispose()
  h.reply({ ok: true, result: 'Hello.' })
  await tick()
  assert.deepEqual(h.log, ['state:run', 'ai:fix'])
}

// 4. Try again while an older run is still going: only the newest pastes
{
  const h = harness()
  h.run.update(props({}))
  const first = h.reply
  h.run.update(props({ attempt: 1 }))
  h.reply({ ok: true, result: 'second' })
  await tick()
  first({ ok: true, result: 'first' })
  await tick()
  assert.deepEqual(h.log.filter((l) => l.startsWith('paste')), ['paste:c1:second'])
}

// 5. Normal run, panel open the whole time: hide, paste, back to the list
{
  const h = harness()
  h.run.update(props({}))
  h.run.update(props({})) // re-render with the same props doesn't start a second run
  h.reply({ ok: true, result: 'Hello.' })
  await tick()
  assert.deepEqual(h.log, ['state:run', 'ai:fix', 'hide', 'paste:c1:Hello.', 'leave'])
}

// 6. Error shows on the page; StrictMode remount starts afresh
{
  const h = harness()
  h.run.update(props({}))
  h.reply({ ok: false, error: 'timeout' })
  await tick()
  assert.deepEqual(h.log, ['state:run', 'ai:fix', 'state:error:timeout'])
  h.run.dispose()
  h.run.update(props({}))
  assert.equal(h.log.filter((l) => l === 'ai:fix').length, 2)
}

console.log('ai-run: ok')
