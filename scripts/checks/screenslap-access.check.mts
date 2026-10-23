/**
 * Check: ScreenSlap only monitors the calendar and shows meeting alerts while
 * it has access (trial or licence), including when access changes while the
 * app runs (Sol trial review T3, re-review T6, T7). Loads the real
 * src/main/services/screenslap.ts and access-guard.ts; electron, the calendar,
 * config and the access answer are fakes.
 * Run: node scripts/checks/screenslap-access.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

type S = {
  allowed: boolean; windows: number; polling: number; stops: number; events: unknown[]
  pollAllowed: null | (() => Promise<boolean>); gate: null | Promise<void>
}
const g = globalThis as unknown as { __ss: S }
g.__ss = { allowed: false, windows: 0, polling: 0, stops: 0, events: [], pollAllowed: null, gate: null }
installTsHooks({
  electron: fake(`
    const noop = () => {}
    const any = (o) => new Proxy(o, { get: (t, p) => (p in t ? t[p] : p === 'webContents' ? any({}) : noop) })
    export class BrowserWindow {
      constructor() { globalThis.__ss.windows++; return any(this) }
      static getAllWindows() { return [] }
    }
    export const screen = { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }] }
    export const shell = { openExternal: async () => {} }`),
  '@electron-toolkit/utils': fake('export const is = { dev: false }'),
  './config-store': fake(`export const getConfig = () => ({ alert_minutes_before: 2, alert_check_seconds: 3600,
    fetch_interval_minutes: 60, alert_duration_seconds: 3600, monitor_index: -1, sound_enabled: false })`),
  './google-calendar': fake(`const s = globalThis.__ss
    export const getCalendarService = () => ({
      getStatus: () => ({ connected: true }),
      startPolling: (_m, allowed) => { s.polling++; s.pollAllowed = allowed },
      stopPolling: () => { s.stops++ },
      getEvents: () => s.events })`),
  '../security/access-check': fake(`export const checkAccess = async (tool) => {
    if (globalThis.__ss.gate) await globalThis.__ss.gate
    return { allowed: tool === 'screenslap' && globalThis.__ss.allowed, message: 'x' } }`)
})
console.log = () => {}
console.warn = () => {}
const { getScreenSlapService, destroyScreenSlap } = await import(srcUrl('src/main/services/screenslap.ts'))
const tick = () => new Promise((r) => setTimeout(r, 5))
const meeting = (id: string) => ({ id, summary: 'Standup', startTime: new Date(Date.now() + 60_000).toISOString(),
  durationMinutes: 30, allDay: false, meetingLink: null, meetingService: null })
type Svc = { start: () => Promise<void>; stop: () => void; testAlert: () => Promise<void>; checkForAlerts: () => void; getState: () => { monitoring: boolean } }
const svc = (): Svc => getScreenSlapService() as Svc

// 1. Expired, unlicensed, calendar connected: launch starts nothing
await svc().start()
assert.equal(g.__ss.polling, 0, 'no calendar polling without access')
g.__ss.events = [meeting('m1')]
svc().checkForAlerts()
await tick()
assert.equal(g.__ss.windows, 0, 'no alert window without access')
await svc().testAlert()
assert.equal(g.__ss.windows, 0, 'no test alert without access')
destroyScreenSlap()

// 2. With access: monitoring starts, the alert shows, once per meeting
g.__ss.allowed = true
await svc().start()
assert.equal(g.__ss.polling, 1, 'polls with access')
g.__ss.events = [meeting('m2')]
svc().checkForAlerts()
await tick()
assert.ok(g.__ss.windows > 0, 'alert shows with access')
const shown = g.__ss.windows
svc().checkForAlerts()
await tick()
assert.equal(g.__ss.windows, shown, 'no second alert for the same meeting')
destroyScreenSlap()

// 3. T3: polling started during the trial; the trial ends; the next poll is refused and monitoring stops
g.__ss.allowed = true
await svc().start()
assert.equal(svc().getState().monitoring, true)
g.__ss.allowed = false
assert.equal(await g.__ss.pollAllowed!(), false, 'poll refused after expiry')
assert.equal(svc().getState().monitoring, false, 'monitoring stopped after expiry')

// 4. T6 (same instance): expired → a meeting comes due and is denied → a licence is activated → it alerts
g.__ss.windows = 0
await svc().start() // still expired: nothing
g.__ss.allowed = true
await svc().start() // monitoring during trial
g.__ss.allowed = false // trial ends
g.__ss.events = [meeting('m3')]
svc().checkForAlerts()
await tick()
assert.equal(g.__ss.windows, 0, 'denied while expired')
g.__ss.allowed = true // licence activated (ipc-handlers calls start())
await svc().start()
assert.equal(svc().getState().monitoring, true)
svc().checkForAlerts()
await tick()
assert.ok(g.__ss.windows > 0, 'the same meeting alerts after activation')
destroyScreenSlap()

// 5. T7: access check is slow; Stop happens while it waits; polling must not start afterwards
g.__ss.allowed = true
g.__ss.polling = 0
let release!: () => void
g.__ss.gate = new Promise<void>((r) => { release = r })
const starting = svc().start()
svc().stop()
release()
await starting
assert.equal(g.__ss.polling, 0, 'a stopped start never begins polling')
assert.equal(svc().getState().monitoring, false)
// …and destroy during the wait behaves the same
g.__ss.gate = new Promise<void>((r) => { release = r })
const starting2 = svc().start()
destroyScreenSlap()
release()
await starting2
assert.equal(g.__ss.polling, 0, 'a destroyed start never begins polling')
g.__ss.gate = null

console.info('screenslap-access: ok')
// the shown alert's auto-dismiss timer (an hour here) would keep the process alive
process.exit(0)
