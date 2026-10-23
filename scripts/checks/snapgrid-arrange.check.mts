/**
 * Check: SnapGrid's "Arrange" puts the most recent normal windows on the
 * screen into every slot, the window you were just in first (John, 24 Oct
 * 2026: "it doesn't take all the most recent 3 windows or closest to the top
 * and make them all arranged, only bottom right and left were arranged").
 *
 * Loads the real src/main/services/snapgrid.ts and the real macOS mover
 * (window-snap-darwin.ts). The PeakFlowHelper is replaced by a fake window
 * server that answers sg-* commands from a recorded window list.
 * Run: node scripts/checks/snapgrid-arrange.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

const S = 'globalThis.__sg'
interface Win {
  pid: number
  windowId: number
  appName: string
  frame: { x: number; y: number; w: number; h: number }
  subrole?: string
  minimized?: boolean
  /** false: the helper can't find it (sg-set fails); 'silent': sg-set says ok but the window stays put */
  movable?: boolean | 'silent'
  /** Not in sg-windows at all (only sg-front sees it) */
  unlisted?: boolean
}
interface World {
  /** Front to back */
  wins: Win[]
  /** What sg-front reports: a window, or 'panel' (PeakFlow's panel is in front) */
  front: Win | 'panel'
  /** The app that was in front when the panel opened (hidePanel hands focus back to it) */
  previousPid?: number
  /** sg-front reports this id for the front window (0 = id unreadable) */
  frontId?: number
  log: string[]
}
const world = (): World => (globalThis as unknown as { __sg: World }).__sg
;(globalThis as unknown as { __sg: World }).__sg = { wins: [], front: 'panel', log: [] }

/** Like macOS (measured on John's Mac, 24 Oct 2026): bringing an app to the
 *  front brings every window of that app forward, keeping their order. */
function activateApp(pid: number): void {
  const w = world()
  w.wins = [...w.wins.filter((v) => v.pid === pid), ...w.wins.filter((v) => v.pid !== pid)]
}
;(globalThis as unknown as { __sgActivate: (pid: number) => void }).__sgActivate = activateApp

// Fake PeakFlowHelper: a tiny window server
;(globalThis as unknown as { __sgSend: (c: string) => string }).__sgSend = (line: string): string => {
  const w = world()
  const [cmd, ...a] = line.split(' ')
  const row = (x: Win, id = x.windowId): Record<string, unknown> => ({
    pid: x.pid, windowId: id, appName: x.appName, bundleId: `test.${x.appName}`, title: '', frame: { ...x.frame },
    ...(x.subrole !== undefined ? { subrole: x.subrole } : {}), ...(x.minimized ? { minimized: true } : {})
  })
  if (cmd === 'sg-front') {
    if (w.front === 'panel') return JSON.stringify({ pid: process.pid, windowId: 9999, appName: 'PeakFlow', frame: { x: 1200, y: 33, w: 380, h: 600 } })
    return JSON.stringify(row(w.front, w.frontId ?? w.front.windowId))
  }
  if (cmd === 'sg-windows') {
    const panel = { pid: process.pid, windowId: 9999, appName: 'PeakFlow', title: '', frame: { x: 1200, y: 33, w: 380, h: 600 }, subrole: 'AXStandardWindow' }
    return JSON.stringify([...(w.front === 'panel' ? [panel] : []), ...w.wins.filter((x) => !x.unlisted).map((x) => row(x))])
  }
  if (cmd === 'sg-set') {
    const [pid, wid, x, y, ww, h] = a.map(Number)
    const t = w.wins.find((v) => v.pid === pid && (wid === 0 ? v === w.wins.find((u) => u.pid === pid) : v.windowId === wid))
    if (!t || t.movable === false) return JSON.stringify({ ok: false, error: 'window not found' })
    if (t.movable === 'silent') return JSON.stringify({ ok: true, frame: t.frame })
    t.frame = { x, y, w: ww, h }
    w.log.push(`set ${t.appName}`)
    return JSON.stringify({ ok: true, frame: t.frame })
  }
  if (cmd === 'sg-raise') {
    const [pid, wid, act] = a.map(Number)
    if (act !== 0) activateApp(pid)
    const t = w.wins.find((v) => v.pid === pid && v.windowId === wid)
    if (t) w.wins = [t, ...w.wins.filter((v) => v !== t)]
    return JSON.stringify({ ok: true })
  }
  if (cmd === 'sg-tiling') return JSON.stringify({ edgeDrag: true })
  return 'null'
}

installTsHooks({
  electron: fake(`
    // Two screens side by side; the second only matters for the two-screen check
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 33, width: 1728, height: 1010 } }
    const d2 = { id: 2, bounds: { x: 1728, y: 0, width: 1728, height: 1117 }, workArea: { x: 1728, y: 33, width: 1728, height: 1010 } }
    const at = (x) => (x >= 1728 ? d2 : d)
    export const screen = { getDisplayMatching: (r) => at(r.x + r.width / 2), getAllDisplays: () => [d, d2], getDisplayNearestPoint: (p) => at(p.x) }
    export class BrowserWindow { static getAllWindows() { return [] } }
    export const shell = { openExternal: () => {} }
    export const app = { isPackaged: false, getAppPath: () => '/x' }`),
  './config-store': fake(`export const getConfig = () => ({ drag_snap: false }); export const setConfig = () => {}`),
  '../security/access-check': fake(`export const checkAccess = async () => ({ allowed: true })`),
  '../security/access-guard': fake(`export const withToolAccess = (_c, _id, fn) => fn()`),
  // Closing the panel with focus in it hands focus back to the previous app
  '../panel': fake(`export const hidePanel = (force) => { ${S}.log.push('hidePanel'); if (!force && ${S}.previousPid) globalThis.__sgActivate(${S}.previousPid) }`),
  './focus-dim': fake(`export const getFocusDimService = () => ({ getState: () => ({ enabled: false }) })`),
  '../launcher/window-commands': fake(`export const setWindowCommandHandler = () => {}`),
  './platform': fake(`export const isMac = true; export const isWindows = false; export const isLinux = false`),
  './window-snap-win32': fake(`export {}`),
  './mac-helper': fake(`export const getMacHelperPath = () => '/fake/peakflow-helper'`),
  './helper-client': fake(`
    export const isValidPid = (v) => Number.isSafeInteger(v) && v > 0
    export class HelperClient { async send(c) { return globalThis.__sgSend(c) } destroy() {} }`)
})

const { getSnapGridService } = await import(srcUrl('src/main/services/snapgrid.ts'))

// Work area 0,33 1728x1010 → main2 slots: left half, top right, bottom right
const LEFT = { x: 0, y: 33, w: 864, h: 1010 }
const TOP_RIGHT = { x: 864, y: 33, w: 864, h: 505 }
const BOTTOM_RIGHT = { x: 864, y: 538, w: 864, h: 505 }

const win = (pid: number, windowId: number, appName: string, x: number, y: number, w: number, h: number, extra: Partial<Win> = {}): Win =>
  ({ pid, windowId, appName, frame: { x, y, w, h }, subrole: 'AXStandardWindow', ...extra })

/** Fresh service; the user was last in `target`, then opened the panel and clicked Arrange. */
async function arrange(wins: Win[], target: Win, key: string, frontId?: number, panelFront = true): Promise<{ msg: string; frames: Map<Win, Win['frame']> }> {
  const w = world()
  w.wins = wins
  w.log = []
  w.front = target
  w.frontId = frontId
  const sg = getSnapGridService()
  ;(sg as unknown as { target: unknown; history: Map<string, unknown> }).target = null
  await sg.getState() // the poll saw the window you were in
  if (panelFront) w.front = 'panel' // then the panel opened and took focus
  w.previousPid = target.pid
  const msg = await sg.arrange(key)
  return { msg, frames: new Map(wins.map((x) => [x, x.frame])) }
}

let failed = 0
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (err) {
    failed++
    console.error(`FAIL ${name}\n  ${(err as Error).message.split('\n').join('\n  ')}`)
  }
}

// 1. Recorded on John's Mac, 24 Oct 2026 (app names and frames only).
//    Agents' headed browser windows ("Playwright", subrole AXUnknown) sit
//    between his own windows. They are not windows he used, so they must not
//    take a slot.
await test('helper and invisible windows never take a slot (recorded list)', async () => {
  const claude = win(65386, 54887, 'Claude', 0, 33, 1639, 1008)
  const pw1 = win(4517, 56249, 'Playwright', 864, 538, 390, 664, { subrole: 'AXUnknown' })
  const chrome1 = win(91928, 55270, 'Google Chrome', 0, 33, 1728, 1009)
  const pw2 = win(4517, 56330, 'Playwright', 200, 300, 390, 664, { subrole: 'AXUnknown' })
  const chrome2 = win(91928, 49044, 'Google Chrome', 864, 33, 864, 505)
  const utm = win(99445, 56028, 'UTM', 82, 370, 1207, 808)
  const minimised = win(12199, 54640, 'WhatsApp', 462, 241, 1200, 800, { minimized: true })
  const { msg, frames } = await arrange([claude, pw1, chrome1, pw2, chrome2, minimised, utm], claude, 'main2')
  assert.deepEqual(frames.get(claude), LEFT, 'the window he was in goes in the main slot')
  assert.deepEqual(frames.get(chrome1), TOP_RIGHT, 'next most recent normal window, top right')
  assert.deepEqual(frames.get(chrome2), BOTTOM_RIGHT, 'third most recent normal window, bottom right')
  assert.deepEqual(frames.get(pw1), { x: 864, y: 538, w: 390, h: 664 }, 'Playwright window untouched')
  assert.deepEqual(frames.get(pw2), { x: 200, y: 300, w: 390, h: 664 }, 'Playwright window untouched')
  assert.equal(msg, '3 windows arranged')
})

// 2. A window the helper can't move hands its slot to the next window.
await test('a window that will not move does not leave its slot empty', async () => {
  const a = win(101, 1, 'A', 100, 100, 800, 600)
  const stuck = win(102, 2, 'Stuck', 150, 150, 800, 600, { movable: false })
  const c = win(103, 3, 'C', 200, 200, 800, 600)
  const d = win(104, 4, 'D', 250, 250, 800, 600)
  const { msg, frames } = await arrange([a, stuck, c, d], a, 'main2')
  assert.deepEqual(frames.get(a), LEFT)
  assert.deepEqual(frames.get(c), TOP_RIGHT)
  assert.deepEqual(frames.get(d), BOTTOM_RIGHT)
  assert.equal(msg, '3 windows arranged')
})

// 3. The front window's id couldn't be read ("pid:0"): it is still used once.
await test('the window you were in is used once even without its window id', async () => {
  const a = win(201, 11, 'A', 100, 100, 800, 600)
  const b = win(202, 12, 'B', 150, 150, 800, 600)
  const c = win(203, 13, 'C', 200, 200, 800, 600)
  const { frames } = await arrange([a, b, c], a, 'main2', 0)
  assert.deepEqual(frames.get(a), LEFT)
  assert.deepEqual(frames.get(b), TOP_RIGHT)
  assert.deepEqual(frames.get(c), BOTTOM_RIGHT)
})

// 4. Grid: four slots, four most recent windows in order.
await test('grid fills all four slots front to back', async () => {
  const ws = [1, 2, 3, 4, 5].map((i) => win(300 + i, 20 + i, `W${i}`, 50 * i, 50 * i, 700, 500))
  const { frames, msg } = await arrange(ws, ws[0], 'grid')
  assert.deepEqual(frames.get(ws[0]), { x: 0, y: 33, w: 864, h: 505 })
  assert.deepEqual(frames.get(ws[1]), { x: 864, y: 33, w: 864, h: 505 })
  assert.deepEqual(frames.get(ws[2]), { x: 0, y: 538, w: 864, h: 505 })
  assert.deepEqual(frames.get(ws[3]), { x: 864, y: 538, w: 864, h: 505 })
  assert.deepEqual(frames.get(ws[4]), { x: 250, y: 250, w: 700, h: 500 }, 'fifth window untouched')
  assert.equal(msg, '4 windows arranged')
})

// 5. John's case: the window he was in has a second window in the same app
//    (two Chrome windows) further back. Bringing that app forward must not
//    leave the second window over the other slots.
await test('another window of the same app does not end up over the slots', async () => {
  const chromeA = win(401, 31, 'Google Chrome', 200, 150, 900, 620)
  const notes = win(402, 32, 'Notes', 350, 220, 900, 620)
  const mail = win(403, 33, 'Mail', 500, 300, 900, 620)
  const chromeB = win(401, 34, 'Google Chrome', 60, 60, 1500, 950)
  const { frames } = await arrange([chromeA, notes, mail, chromeB], chromeA, 'main2')
  assert.deepEqual(frames.get(chromeA), LEFT)
  assert.deepEqual(frames.get(notes), TOP_RIGHT)
  assert.deepEqual(frames.get(mail), BOTTOM_RIGHT)
  const order = world().wins.map((v) => v.appName + ':' + v.windowId)
  assert.deepEqual(order.slice(0, 3).sort(), ['Google Chrome:31', 'Mail:33', 'Notes:32'], `arranged windows must be the front three, got ${order.join(', ')}`)
  assert.equal(order[0], 'Google Chrome:31', 'the main window ends in front')
})

// 6. Sol review: the helper reads back a frame even when the app ignored the
//    move. A window still where it was must pass its slot on.
await test('a window that ignores the move passes its slot on', async () => {
  const a = win(501, 41, 'A', 100, 100, 800, 600)
  const stubborn = win(502, 42, 'Stubborn', 150, 150, 800, 600, { movable: 'silent' })
  const c = win(503, 43, 'C', 200, 200, 800, 600)
  const d = win(504, 44, 'D', 250, 250, 800, 600)
  const { frames, msg } = await arrange([a, stubborn, c, d], a, 'main2')
  assert.deepEqual(frames.get(c), TOP_RIGHT)
  assert.deepEqual(frames.get(d), BOTTOM_RIGHT)
  assert.equal(msg, '3 windows arranged')
  // Re-review: already at the slot's corner but refusing to resize
  const a2 = win(511, 45, 'A', 100, 100, 800, 600)
  const small = win(512, 46, 'Small', 864, 33, 200, 100, { movable: 'silent' })
  const c2 = win(513, 47, 'C', 200, 200, 800, 600)
  const d2 = win(514, 48, 'D', 250, 250, 800, 600)
  const r2 = await arrange([a2, small, c2, d2], a2, 'main2')
  assert.deepEqual(r2.frames.get(c2), TOP_RIGHT)
  assert.deepEqual(r2.frames.get(d2), BOTTOM_RIGHT)
})

// 7. Sol review: a target on the second screen that isn't a normal window must
//    not pull Arrange onto the first screen.
await test('arrange stays on the target screen when the target is left out', async () => {
  const panelish = win(601, 51, 'Floating', 2000, 100, 400, 300, { subrole: 'AXFloatingWindow' })
  const left1 = win(602, 52, 'Screen1', 100, 100, 800, 600)
  const right1 = win(603, 53, 'Screen2a', 1900, 200, 800, 600)
  const right2 = win(604, 54, 'Screen2b', 2000, 250, 800, 600)
  const { frames } = await arrange([panelish, left1, right1, right2], panelish, 'halves')
  assert.deepEqual(frames.get(left1), { x: 100, y: 100, w: 800, h: 600 }, 'first-screen window untouched')
  assert.deepEqual(frames.get(right1), { x: 1728, y: 33, w: 864, h: 1010 })
  assert.deepEqual(frames.get(right2), { x: 2592, y: 33, w: 864, h: 1010 })
  assert.deepEqual(frames.get(panelish), { x: 2000, y: 100, w: 400, h: 300 }, 'floating window untouched')
})

// 8. Sol review: Windows lists titled windows only, so the window you were in
//    may be missing from the list. With it still in front (the panel didn't
//    take focus), it takes the main slot.
await test('the window you were in still leads when the list leaves it out', async () => {
  const a = win(701, 61, 'Untitled', 100, 100, 800, 600, { unlisted: true, subrole: undefined })
  const b = win(702, 62, 'B', 150, 150, 800, 600, { subrole: undefined })
  const c = win(703, 63, 'C', 200, 200, 800, 600, { subrole: undefined })
  const { frames } = await arrange([a, b, c], a, 'main2', undefined, false)
  assert.deepEqual(frames.get(a), LEFT)
  assert.deepEqual(frames.get(b), TOP_RIGHT)
  assert.deepEqual(frames.get(c), BOTTOM_RIGHT)
})

process.exit(failed ? 1 : 0)
