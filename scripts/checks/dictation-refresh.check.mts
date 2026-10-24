// Settings after a top-up (coordinator visual review, 24 Oct 2026: V1 stale own-key row, V2 duplicate "Dictation" title, V3 stale balance)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
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

const unit = transformSync(read('src/renderer/src/launcher/dictation-refresh.ts'), { loader: 'ts', format: 'cjs' }).code
function load(): any {
  const mod = { exports: {} as any }
  new Function('module', 'exports', unit)(mod, mod.exports)
  return mod.exports
}

/** Controlled promises, fake timers and event sources for driving watchAccount */
function rig() {
  const { watchAccount } = load()
  const calls: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const values: unknown[] = []
  let errors = 0
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let nextTimer = 1
  const sources = { focus: new Set<() => void>(), shown: new Set<() => void>(), changed: new Set<() => void>(), licensed: new Set<() => void>() }
  const on = (set: Set<() => void>) => (fn: () => void) => { set.add(fn); return () => void set.delete(fn) }
  const watcher = watchAccount({
    fetch: () => new Promise((resolve, reject) => calls.push({ resolve, reject })),
    onValue: (v: unknown) => values.push(v),
    onError: () => { errors++ },
    setTimer: (fn: () => void, ms: number) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id },
    clearTimer: (id: number) => void timers.delete(id),
    onFocus: on(sources.focus),
    onRefreshEvents: [on(sources.shown), on(sources.changed), on(sources.licensed)]
  })
  const fire = (set: Set<() => void>): void => [...set].forEach((fn) => fn())
  const runTimers = (): void => { const due = [...timers.entries()]; timers.clear(); due.forEach(([, t]) => t.fn()) }
  return { calls, values, timers, sources, watcher, fire, runTimers, errors: () => errors }
}
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

test('[V3] one look on mount, and one more for each focus, launcher-shown, account-change and licence event', () => {
  const t = rig()
  assert.equal(t.calls.length, 1)
  t.fire(t.sources.focus)
  assert.equal(t.calls.length, 2)
  t.fire(t.sources.shown)
  t.fire(t.sources.changed)
  t.fire(t.sources.licensed)
  assert.equal(t.calls.length, 5)
  assert.equal(t.timers.size, 0)
})

test('[V3] a focus after a checkout re-checks now and exactly once more 6 s later; the next focus is ordinary', () => {
  const t = rig()
  t.watcher.checkoutOpened()
  t.fire(t.sources.focus)
  assert.equal(t.calls.length, 2)
  assert.equal(t.timers.size, 1)
  assert.equal([...t.timers.values()][0].ms, 6000)
  t.runTimers()
  assert.equal(t.calls.length, 3)
  t.fire(t.sources.focus)
  assert.equal(t.calls.length, 4)
  assert.equal(t.timers.size, 0)
})

test('[V3] an ordinary focus (no checkout) never schedules the extra look', () => {
  const t = rig()
  t.fire(t.sources.focus)
  t.fire(t.sources.focus)
  assert.equal(t.timers.size, 0)
  assert.equal(t.calls.length, 3)
})

test('[V3] a slower, older answer never overwrites a newer one (and a stale failure does not blank the row)', async () => {
  const t = rig()
  t.fire(t.sources.changed)
  t.calls[1].resolve('new')
  await settle()
  t.calls[0].resolve('old')
  await settle()
  assert.deepEqual(t.values, ['new'])
  t.fire(t.sources.changed)
  t.fire(t.sources.changed)
  t.calls[3].resolve('newest')
  await settle()
  t.calls[2].reject(new Error('late'))
  await settle()
  assert.deepEqual(t.values, ['new', 'newest'])
  assert.equal(t.errors(), 0)
})

test('[V3] a failure of the newest look reports once', async () => {
  const t = rig()
  t.calls[0].reject(new Error('offline'))
  await settle()
  assert.equal(t.errors(), 1)
})

test('[V3] stopping removes every listener and pending timer, and drops answers still on their way', async () => {
  const t = rig()
  t.watcher.checkoutOpened()
  t.fire(t.sources.focus)
  assert.equal(t.timers.size, 1)
  t.watcher.stop()
  assert.equal(t.timers.size, 0)
  assert.equal(t.sources.focus.size + t.sources.shown.size + t.sources.changed.size + t.sources.licensed.size, 0)
  t.calls[1].resolve('late')
  await settle()
  assert.deepEqual(t.values, [])
})

function settingsRig() {
  const { settingsStamps } = load()
  const stamps = settingsStamps()
  let shown = 'initial'
  const apply = (ok: () => boolean, v: string): void => { if (ok()) shown = v }
  return { stamps, apply, shown: () => shown }
}

test('[V3] settings: a reload that started before a toggle cannot restore the old value', () => {
  const t = settingsRig()
  const reload = t.stamps.reload()
  const toggle = t.stamps.mutate()
  t.apply(toggle, 'Off')
  t.apply(reload, 'On')
  assert.equal(t.shown(), 'Off')
})

test('[V3] settings: a reload that starts while a key save is checking cannot drop the save, even answering first', () => {
  const t = settingsRig()
  const save = t.stamps.mutate()
  const reload = t.stamps.reload()
  t.apply(reload, 'no key yet')
  t.apply(save, 'key saved')
  assert.equal(t.shown(), 'key saved')
})

test('[V3] settings: a reload that starts after a toggle cannot drop the toggle either', () => {
  const t = settingsRig()
  const toggle = t.stamps.mutate()
  const reload = t.stamps.reload()
  t.apply(reload, 'On')
  t.apply(toggle, 'Off')
  assert.equal(t.shown(), 'Off')
})

test('[V3] settings: only a later mutation supersedes a mutation; a reload after a mutation still lands when it answers last', () => {
  const t = settingsRig()
  const first = t.stamps.mutate()
  const second = t.stamps.mutate()
  t.apply(second, 'second')
  t.apply(first, 'first')
  assert.equal(t.shown(), 'second')
  const reload = t.stamps.reload()
  t.apply(reload, 'fresh')
  assert.equal(t.shown(), 'fresh')
})

test('[V3] settings: after stop nothing lands', () => {
  const t = settingsRig()
  const reload = t.stamps.reload()
  t.stamps.stop()
  t.apply(reload, 'late')
  assert.equal(t.shown(), 'initial')
})

test('[V3] the settings rows and the balance row use these units', () => {
  const app = read('src/renderer/src/launcher/LauncherApp.tsx')
  const rows = app.slice(app.indexOf('function DictationRows'), app.indexOf('function AiSetup'))
  assert.ok(rows.includes('settingsStamps()'))
  // reload, set and remove go through take(); save key and unmount stamp directly
  assert.equal((rows.match(/take\('(reload|mutate)', invoke/g) ?? []).length, 3)
  assert.equal((rows.match(/claim\.(mutate|stop)\(\)/g) ?? []).length, 2)
  const row = read('src/renderer/src/launcher/DictationAccountRow.tsx')
  assert.ok(row.includes('watchAccount<DictationAccount>('))
  assert.ok(row.includes('checkoutOpened()'))
})
