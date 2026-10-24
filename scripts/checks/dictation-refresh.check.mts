// Settings after a top-up (coordinator visual review, 24 Oct 2026: V1 stale own-key row, V2 duplicate "Dictation" title, V3 stale balance)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { addonChanged } from '../../src/main/dictation/addon.ts'

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const ok = { state: 'ok' as const, balanceMicros: 4_070_000, minutesLeft: 904, disabled: false, blocked: null }

test('[V1] main re-checks the add-on whenever the settings row asks, and only announces a real change', () => {
  assert.equal(addonChanged(ok, { ...ok }), false)
  assert.equal(addonChanged({ state: 'none' }, ok), true)
  assert.equal(addonChanged(ok, { ...ok, balanceMicros: 4_069_000 }), true)
  assert.equal(addonChanged(ok, { ...ok, blocked: 'daily_limit' }), true)
  const index = read('src/main/dictation/index.ts')
  // The account row's own request also refreshes main's view, so the settings below it see the new state
  assert.ok(/DICTATION_ACCOUNT, async \(e\) =>[\s\S]{0,300}refreshAddon\(true\)/.test(index))
  assert.ok(index.includes('addonChanged(addon, next)'))
})

test('[V1] the dictation rows reload when the add-on state changes', () => {
  const app = read('src/renderer/src/launcher/LauncherApp.tsx')
  const rows = app.slice(app.indexOf('function DictationRows'))
  assert.ok(rows.includes('IPC_SEND.DICTATION_ACCOUNT_CHANGED'))
})

test('[V2] no add-on: the own-key row has its own title and sub-line; otherwise it is unchanged', () => {
  const app = read('src/renderer/src/launcher/LauncherApp.tsx')
  assert.ok(app.includes('// copy: Your own OpenAI key'))
  assert.ok(app.includes("const OWN_KEY_LABEL = 'Your own OpenAI key'"))
  assert.ok(app.includes('// copy: Or use your own key: about 1 cent for 2 minutes of talking.'))
  assert.ok(app.includes("const OWN_KEY_OFFER = 'Or use your own key: about 1 cent for 2 minutes of talking.'"))
  // The old wording stays for builds where the add-on isn't offered at all
  assert.ok(app.includes('Hold a key and talk; your words are typed for you. Needs your own OpenAI key (about 1 cent for 2 minutes of talking).'))
  assert.ok(app.includes('offer={'))
})

const require = createRequire(import.meta.url)
const rowCode = transformSync(read('src/renderer/src/launcher/DictationAccountRow.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
function load(): any {
  const mod = { exports: {} as any }
  const stub = (id: string): unknown => {
    if (id === '@shared/ipc-types') return { IPC_INVOKE: {}, IPC_SEND: {} }
    if (id === '../panel/hooks') return { invoke: () => { throw new Error('unexpected IPC') } }
    return require(id)
  }
  new Function('require', 'module', 'exports', rowCode)(stub, mod, mod.exports)
  return mod.exports
}

test('[V3] coming back from checkout re-checks now and once more shortly after; ordinary focus checks once', () => {
  const { recheckDelays } = load()
  assert.deepEqual(recheckDelays(false), [0])
  assert.deepEqual(recheckDelays(true), [0, 6000])
  const row = read('src/renderer/src/launcher/DictationAccountRow.tsx')
  assert.ok(row.includes("window.addEventListener('focus'"))
})
