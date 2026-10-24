/**
 * Check: a QuickBoard AI action on a clip over 10,000 characters is refused
 * with 'too_long' instead of being cut (the shortened answer would replace the
 * whole clip when pasted). Up to the limit, the full clip is sent. The paid
 * gate is unchanged and still answers first.
 * Run: node scripts/checks/clipboard-ai-length.check.mts
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const g = globalThis as unknown as { pf: { licensed: boolean; sent: string[] } }
g.pf = { licensed: true, sent: [] }
const stub = (src: string): string => `data:text/javascript,${encodeURIComponent(src)}`
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '../security/access-check') return { url: stub('export const checkAccess = async () => ({ isToolLicensed: globalThis.pf.licensed })'), shortCircuit: true }
    if (spec === '../security/secret-detection') return { url: stub('export const redactPersonalInfo = (s) => s'), shortCircuit: true }
    if (spec === '@shared/tool-ids') return { url: stub("export const ToolId = { QuickBoard: 'quickboard' }"), shortCircuit: true }
    if (spec === './local-ai')
      return {
        url: stub(`export const getDefaultAiProvider = async () => 'codex'
export const listAiProviders = async () => [{ id: 'codex', label: 'ChatGPT', installed: true, signedIn: true }]
export const runLocalAi = async (o) => { globalThis.pf.sent.push(o.prompt); return { ok: true, text: 'done' } }`),
        shortCircuit: true
      }
    if (spec === './clipboard-ai-prompts') return { url: pathToFileURL(join(root, 'src/main/services/clipboard-ai-prompts.ts')).href, shortCircuit: true }
    return next(spec, ctx)
  }
})
const { aiTransform, MAX_TEXT_LENGTH } = await import(pathToFileURL(join(root, 'src/main/services/clipboard-ai.ts')).href)
assert.equal(MAX_TEXT_LENGTH, 10_000)

const atLimit = 'a'.repeat(MAX_TEXT_LENGTH)
assert.deepEqual(await aiTransform('summarize', atLimit), { ok: true, result: 'done' })
assert.equal(g.pf.sent.at(-1), atLimit, 'the full clip is sent')

g.pf.sent = []
assert.deepEqual(await aiTransform('summarize', atLimit + 'b'), { ok: false, error: 'too_long' })
assert.deepEqual(g.pf.sent, [], 'nothing is sent for a clip over the limit')

// Paid gate unchanged: an unlicensed (trial) user still gets not_licensed, whatever the length
g.pf.licensed = false
assert.deepEqual(await aiTransform('summarize', atLimit + 'b'), { ok: false, error: 'not_licensed' })
assert.deepEqual(await aiTransform('summarize', 'short'), { ok: false, error: 'not_licensed' })
console.log('clipboard-ai-length: ok')
