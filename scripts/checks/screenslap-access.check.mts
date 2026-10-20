/**
 * Check: ScreenSlap only monitors the calendar and shows meeting alerts while
 * it has access (trial or licence). An expired, unlicensed user with a
 * connected calendar gets no polling and no alerts (Sol trial review T3).
 * Loads the real src/main/services/screenslap.ts and access-guard.ts;
 * electron, the calendar, config and the access answer are fakes.
 * Run: node scripts/checks/screenslap-access.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

type S = { allowed: boolean; windows: number; polling: number; events: unknown[] }
const g = globalThis as unknown as { __ss: S }
g.__ss = { allowed: false, windows: 0, polling: 0, events: [] }
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
  './google-calendar': fake(`export const getCalendarService = () => ({
    getStatus: () => ({ connected: true }),
    startPolling: () => { globalThis.__ss.polling++ }, stopPolling: () => {},
    getEvents: () => globalThis.__ss.events })`),
  '../security/access-check': fake(`export const checkAccess = async (tool) => ({ allowed: tool === 'screenslap' && globalThis.__ss.allowed, message: 'x' })`)
})
console.log = () => {}
console.warn = () => {}
const { getScreenSlapService, destroyScreenSlap } = await import(srcUrl('src/main/services/screenslap.ts'))
const tick = () => new Promise((r) => setTimeout(r, 5))
const meeting = (id: string) => ({ id, summary: 'Standup', startTime: new Date(Date.now() + 60_000).toISOString(),
  durationMinutes: 30, allDay: false, meetingLink: null, meetingService: null })
type Svc = { start: () => Promise<void>; testAlert: () => Promise<void>; checkForAlerts: () => void; getState: () => { monitoring?: boolean } }

// Expired, unlicensed, calendar connected: launch starts nothing
let svc = getScreenSlapService() as Svc
await svc.start()
assert.equal(g.__ss.polling, 0, 'no calendar polling without access')
// a meeting is due (e.g. monitoring began while the trial was running): no alert
g.__ss.events = [meeting('m1')]
svc.checkForAlerts()
await tick()
assert.equal(g.__ss.windows, 0, 'no alert window without access')
// the settings page test alert can't fire either
await svc.testAlert()
assert.equal(g.__ss.windows, 0)
destroyScreenSlap()

// In trial or licensed: monitoring starts and the alert shows
g.__ss.allowed = true
svc = getScreenSlapService() as Svc
await svc.start()
assert.equal(g.__ss.polling, 1, 'polls with access')
g.__ss.events = [meeting('m2')]
svc.checkForAlerts()
await tick()
assert.ok(g.__ss.windows > 0, 'alert shows with access')
// the same meeting doesn't alert twice
const shown = g.__ss.windows
svc.checkForAlerts()
await tick()
assert.equal(g.__ss.windows, shown)
destroyScreenSlap()

console.info('screenslap-access: ok')
// the shown alert's auto-dismiss timer (an hour here) would keep the process alive
process.exit(0)
