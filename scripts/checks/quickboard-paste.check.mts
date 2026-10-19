/**
 * Check: every QuickBoard paste-next entry point (the panel's IPC handlers and
 * the paste-next shortcut both call src/main/quickboard-paste.ts) runs through
 * the REAL checkAccess (src/main/security/access-check.ts). Only the stored
 * licence/trial state and the clipboard services are faked (module hooks), so:
 * locked → nothing pastes; licensed and active trial → pastes (no lockout).
 * Sol re-review P1 #1. Run: node scripts/checks/quickboard-paste.check.mts
 */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const fx = (f: string) => pathToFileURL(join(here, 'fixtures/qb-entry', f)).href
const fakes: Record<string, string> = {
  './license': fx('license.mjs'),
  './trial': fx('trial.mjs'),
  './services/clipboard-sequential': fx('sequential.mjs'),
  './services/clipboard-workflows': fx('workflows.mjs'),
  './services/clipboard-forms': fx('forms.mjs')
}
registerHooks({
  resolve(spec, ctx, next) {
    if (fakes[spec]) return { url: fakes[spec], shortCircuit: true }
    if (spec.startsWith('@shared/')) return { url: pathToFileURL(join(root, 'src/shared', spec.slice(8) + '.ts')).href, shortCircuit: true }
    if (spec.startsWith('.') && ctx.parentURL?.endsWith('.ts') && !/\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx)
    return next(spec, ctx)
  },
  // src/shared/tool-ids.ts uses an enum, which Node's type stripping can't run
  load(url, ctx, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, ctx)
    const src = readFileSync(fileURLToPath(url), 'utf8')
    return { format: 'module', source: transformSync(src, { loader: 'ts', format: 'esm' }).code, shortCircuit: true }
  }
})

const { state } = await import(fx('state.mjs'))
const qb = await import(pathToFileURL(join(root, 'src/main/quickboard-paste.ts')).href)
console.warn = () => {}

async function runAll(): Promise<string[]> {
  state.calls = []
  await qb.guardedQueueStart(['a', 'b'])
  await qb.guardedQueueNext()
  await qb.guardedWorkflowPasteNext()
  await qb.guardedFormPasteNext()
  state.workflow = true
  await qb.guardedPasteNextAny() // shortcut, workflow active
  state.workflow = false
  state.form = true
  await qb.guardedPasteNextAny() // shortcut, form fill active
  state.form = false
  await qb.guardedPasteNextAny() // shortcut, paste queue
  return state.calls
}
const ALL = ['start:a,b', 'queue-paste', 'workflow-paste', 'form-paste', 'workflow-paste', 'form-paste', 'queue-paste']

// Locked: trial over, no licence
Object.assign(state, { licensed: false, coversTool: false, installed: true, trialDays: 0 })
assert.deepEqual(await runAll(), [], 'locked: nothing pastes')
assert.equal(await qb.guardedQueueNext(), false)

// Locked: licensed for a different tool, QuickBoard trial over
Object.assign(state, { licensed: true, coversTool: false, trialDays: 0 })
assert.deepEqual(await runAll(), [], 'other-tool licence: nothing pastes')

// Licensed for QuickBoard: every entry point pastes
Object.assign(state, { licensed: true, coversTool: true, trialDays: 0 })
assert.deepEqual(await runAll(), ALL, 'licensed: no lockout')

// Active trial, no licence: every entry point pastes
Object.assign(state, { licensed: false, coversTool: false, installed: true, trialDays: 9 })
assert.deepEqual(await runAll(), ALL, 'active trial: no lockout')

console.log('quickboard-paste: ok')
