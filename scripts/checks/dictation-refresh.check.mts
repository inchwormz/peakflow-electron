import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const unit = transformSync(read('src/renderer/src/panel/tools/dictation/refresh.ts'), { loader: 'ts', format: 'cjs' }).code
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


test('StrictMode cleanup retires old settings requests but fresh setup still delivers', () => {
  const {newestOnly}=load();const claim=newestOnly();const old=claim();claim();const fresh=claim()
  assert.equal(old(),false);assert.equal(fresh(),true)
})
test('page uses one stamp for reload/save/toggle/remove, with watcher checkout lifecycle', () => {
  const page=read('src/renderer/src/panel/tools/dictation/index.tsx')
  assert.ok(page.includes('const current = latest.next()'))
  assert.ok(page.includes('if (current()) setS('))
  assert.ok(page.includes('takeS(setting('))
  assert.ok(page.includes('takeS(invoke<DictationSettings>(IPC_INVOKE.DICTATION_REMOVE_KEY)'))
  assert.ok(page.includes('takeS(invoke<{ ok: boolean;'))
  assert.ok(page.includes('checkoutOpened()'))
  assert.ok(page.includes('watcher.current?.stop()'))
})
