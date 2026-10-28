import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'
installTsHooks()
const { GuaranaCore, validGuaranaMinutes } = await import(srcUrl('src/main/services/guarana-core.ts'))
const { GUARANA_MAX_MINUTES } = await import(srcUrl('src/shared/guarana.ts'))

let now = 1000
let id = 0
let timerId = 0
const held = new Map<number, string>()
const timers = new Map<number, { callback: () => void; ms: number }>()
const operations: string[] = []
let saves = 0
let broadcasts = 0
let failStart = false
let failSave = false
const core = new GuaranaCore({
  blocker: {
    start(type: string) { const next = ++id; if (!failStart) held.set(next, type); operations.push(`start:${next}`); return next },
    stop(n: number) { assert(held.has(n)); operations.push(`stop:${n}`); held.delete(n) },
    isStarted(n: number) { return held.has(n) }
  },
  now: () => now,
  setTimer(callback: () => void, ms: number) { assert(ms > 0 && ms <= 2 ** 31 - 1); const n = ++timerId; timers.set(n, { callback, ms }); return n },
  clearTimer(n: number) { timers.delete(n) },
  savePrefs() { if (failSave) throw new Error('disk'); saves++ },
  changed() { broadcasts++ }
})
assert.deepEqual(core.getState(), { active: false, endsAt: null, minutes: null, keepScreenOn: true, defaultMinutes: null })
for (const invalid of [undefined, 0, -1, 1.5, '15', true, {}, [], NaN, Infinity, GUARANA_MAX_MINUTES + 1]) {
  assert.equal(validGuaranaMinutes(invalid), false)
  core.start(invalid)
}
assert.equal(held.size, 0)
assert.equal(broadcasts, 0)
assert.equal(validGuaranaMinutes(null), true)
assert.equal(validGuaranaMinutes(GUARANA_MAX_MINUTES), true)
core.start(1)
assert.equal(core.getState().endsAt, 61_000)
assert.equal(held.size, 1)
assert.equal([...held.values()][0], 'prevent-display-sleep')
const firstTimer = [...timers.values()][0].callback
// Restart replaces its timer and an already queued old callback cannot end it.
now += 10_000
core.start(2)
assert.equal(timers.size, 1)
assert.equal(core.getState().endsAt, 131_000)
firstTimer()
assert.equal(core.getState().active, true)
assert.equal(timers.size, 1)
const oldBlocker = [...held.keys()][0]
core.setPrefs({ keepScreenOn: false, defaultMinutes: 30 })
assert.deepEqual(operations.slice(-2), [`start:${id}`, `stop:${oldBlocker}`])
assert.equal(held.size, 1)
assert.equal([...held.values()][0], 'prevent-app-suspension')
assert.equal(timers.size, 1)
assert.equal(core.getState().endsAt, 131_000)
assert.equal(saves, 1)
const snapshot = core.getState()
for (const invalid of [null, [], true, { keepScreenOn: 1 }, { defaultMinutes: 0 }, { defaultMinutes: undefined }, { active: true }]) core.setPrefs(invalid)
assert.deepEqual(core.getState(), snapshot)
assert.equal(saves, 1)
// Failure to acquire or persist a replacement leaves the previous blocker and prefs intact.
failStart = true
assert.throws(() => core.setPrefs({ keepScreenOn: true }))
assert.deepEqual(core.getState(), snapshot)
assert.equal(held.size, 1)
failStart = false
failSave = true
assert.throws(() => core.setPrefs({ keepScreenOn: true }))
assert.deepEqual(core.getState(), snapshot)
assert.equal(held.size, 1)
failSave = false
// A timer firing early (wall clock moved back) rearms instead of ending early.
const scheduled = [...timers.entries()][0]
timers.delete(scheduled[0]); scheduled[1].callback()
assert.equal(core.getState().active, true)
assert.equal(timers.size, 1)
now = 131_000
const expired = [...timers.entries()][0]
timers.delete(expired[0]); expired[1].callback()
assert.equal(core.getState().active, false)
assert.equal(held.size, 0)
assert.equal(timers.size, 0)
core.start(1)
now += 61_000
assert.equal(core.checkExpiry(), true, 'resume/unlock expires without running timer')
assert.equal(held.size, 0)
assert.equal(timers.size, 0)
assert.equal(core.getState().endsAt, null)
const beforeStop = broadcasts
core.stop(); core.stop()
assert.equal(broadcasts, beforeStop, 'idempotent stop')
core.start(GUARANA_MAX_MINUTES)
assert.equal([...timers.values()][0].ms, 86_400_000)
core.start(null)
assert.equal(timers.size, 0)
now += 100_000_000
assert.equal(core.checkExpiry(), false, 'indefinite session survives resume')
assert.equal(core.getState().active, true)
core.stop()
assert.equal(held.size, 0)
// Relaunch restores preferences but never an active session.
const fresh = new GuaranaCore({ blocker: {}, now: () => now }, { keepScreenOn: false, defaultMinutes: 30 })
assert.deepEqual(fresh.getState(), { active: false, endsAt: null, minutes: null, keepScreenOn: false, defaultMinutes: 30 })
console.info('guarana: validation, timers, resume expiry, blocker swap, failures and relaunch passed')

// Real service wiring and the legacy launcher command share a single assertion.
const runtime = { handlers: new Map(), app: new Map(), power: new Map(), held: new Set(), next: 0,
  prefs: { keepScreenOn: false, defaultMinutes: 15 }, updates: [] }
;(globalThis as any).__guaranaCheck = runtime
const R = 'globalThis.__guaranaCheck'
installTsHooks({
  electron: fake(`
    export const app = { on: (event, cb) => { const list = ${R}.app.get(event) ?? []; list.push(cb); ${R}.app.set(event, list) } };
    export const ipcMain = { handle: (name, cb) => ${R}.handlers.set(name, cb) };
    export const powerMonitor = { on: (event, cb) => ${R}.power.set(event, cb) };
    export const powerSaveBlocker = {
      start: () => { const id = ++${R}.next; ${R}.held.add(id); return id },
      stop: id => ${R}.held.delete(id), isStarted: id => ${R}.held.has(id)
    };
  `),
  'electron-store': fake(`export default class {
    get store() { return ${R}.prefs }
    set(prefs) { ${R}.prefs = prefs }
  }`),
  '../panel': fake(`export const sendToPanel = (...args) => ${R}.updates.push(args)`),
  '../native/mac-helper': fake('export const runMacHelper = async () => null')
})
const service = await import(srcUrl('src/main/services/guarana.ts'))
const launcher = await import(srcUrl('src/main/launcher/system.ts'))
service.initGuarana()
service.initGuarana()
assert.equal(runtime.handlers.size, 4)
assert.equal(runtime.power.size, 2)
assert.equal(service.getGuaranaState().active, false)
assert.equal(service.getGuaranaState().keepScreenOn, false)
const invoke = (channel: string, value?: unknown) => runtime.handlers.get('guarana:' + channel)({}, value)
invoke('start', '15')
assert.equal(runtime.held.size, 0)
invoke('set-prefs', { keepScreenOn: 'true' })
assert.equal(service.getGuaranaState().keepScreenOn, false)
launcher.setKeepAwake(true)
assert.equal(service.getGuaranaState().active, true)
assert.equal(service.getGuaranaState().minutes, 15)
assert.equal(runtime.held.size, 1)
invoke('stop')
assert.equal(launcher.isKeepAwake(), false)
assert.equal(runtime.held.size, 0)
invoke('start', null)
assert.equal(launcher.isKeepAwake(), true)
launcher.setKeepAwake(false)
assert.equal(service.getGuaranaState().active, false)
assert.equal(runtime.held.size, 0)
invoke('start', null)
for (const cb of runtime.app.get('before-quit')) cb()
for (const cb of runtime.app.get('will-quit')) cb()
assert.equal(runtime.held.size, 0)
assert(runtime.updates.every(([channel]) => channel === 'guarana:state-changed'))
console.info('guarana: IPC, saved prefs, launcher sharing and quit cleanup passed')
