/**
 * Check: if PeakFlow can't make its own AI folder, a ChatGPT or Claude answer
 * fails cleanly instead of hanging (Sol review P2, 24 Oct 2026). Loads the real
 * local-ai.ts with a stand-in for Electron whose app folder can't be created.
 * Nothing is sent to an AI: the folder error stops the run before any CLI starts.
 * Run: node scripts/checks/local-ai-folder.check.mts
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const stub = (src: string): string => `data:text/javascript,${encodeURIComponent(src)}`
registerHooks({
  resolve(spec, ctx, next) {
    // /dev/null is a file, so making a folder inside it always fails
    if (spec === 'electron') return { url: stub("export const app = { getPath: () => '/dev/null/peakflow' }"), shortCircuit: true }
    if (spec === 'electron-store') return { url: stub('export default class { get() {} set() {} delete() {} }'), shortCircuit: true }
    if (spec === './local-ai-args' || spec === './local-ai-spawn') return { url: pathToFileURL(join(root, `src/main/services/${spec.slice(2)}.ts`)).href, shortCircuit: true }
    return next(spec, ctx)
  }
})
const { runLocalAi } = await import(pathToFileURL(join(root, 'src/main/services/local-ai.ts')).href)

const unhandled: unknown[] = []
process.on('unhandledRejection', (e) => unhandled.push(e))
for (const provider of ['codex', 'claude'] as const) {
  const r = await Promise.race([
    runLocalAi({ prompt: 'hello', provider, tier: 'best' }),
    new Promise((resolve) => setTimeout(() => resolve('HUNG'), 15_000))
  ])
  // No CLI on this computer is also a clean answer
  assert.ok(r !== 'HUNG', `${provider} answer hung when the AI folder can't be made`)
  assert.equal((r as { ok: boolean }).ok, false)
}
await new Promise((r) => setTimeout(r, 50))
assert.deepEqual(unhandled, [])
console.log('local-ai-folder: ok')
process.exit(0)
