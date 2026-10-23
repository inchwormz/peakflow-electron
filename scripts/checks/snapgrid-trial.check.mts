/**
 * Check: an ended trial stops SnapGrid cleanly (S14, 24 Oct 2026). Loads the
 * real src/main/services/snapgrid.ts; electron, the window helper, the panel
 * and the access answer are fakes.
 * - No access: drag-snapping is not started, a drag that starts anyway shows
 *   no preview and snaps nothing, and keys move nothing.
 * - The first blocked key or drag opens the panel's trial-ended screen; later
 *   ones stay quiet (once per run). Clicks inside the panel never open it.
 * - A licence entered later starts drag-snapping again.
 * Run: node scripts/checks/snapgrid-trial.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

if (process.platform !== 'darwin') {
  console.info('snapgrid-trial: skipped (drag-snapping is macOS only)')
  process.exit(0)
}

type S = {
  allowed: boolean; watching: boolean; onDrag: null | ((e: unknown) => void)
  panels: string[]; previews: number; frames: number; licence: Array<() => void>
}
const g = globalThis as unknown as { __sg: S }
g.__sg = { allowed: false, watching: false, onDrag: null, panels: [], previews: 0, frames: 0, licence: [] }
installTsHooks({
  electron: fake(`
    const s = globalThis.__sg
    const d = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } }
    export class BrowserWindow {
      constructor() {
        this.webContents = { send() {}, executeJavaScript: async () => {} }
        s.previews++
      }
      static getAllWindows() { return [] }
      setIgnoreMouseEvents() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} on() {}
      loadURL() { return Promise.resolve() } isDestroyed() { return false } isVisible() { return false }
      getBounds() { return d.bounds } setBounds() {} setOpacity() {} showInactive() {} hide() {} destroy() {}
    }
    export const screen = { getDisplayMatching: () => d, getDisplayNearestPoint: () => d, getAllDisplays: () => [d] }
    export const shell = { openExternal: async () => {} }`),
  './config-store': fake(`export const getConfig = () => ({ drag_snap: true }); export const setConfig = () => {}`),
  '../security/access-check': fake(`export const checkAccess = async () => ({ allowed: globalThis.__sg.allowed, message: 'trial_expired' })`),
  '../security/license': fake(`export const onLicenceChanged = (cb) => { globalThis.__sg.licence.push(cb); return () => {} }`),
  '../native/window-snap': fake(`const s = globalThis.__sg
    const w = { id: '42:7', pid: 42, appName: 'Notes', frame: { x: 100, y: 100, w: 600, h: 400 } }
    export const windowSnap = {
      osHandlesEdgeDrag: async () => false,
      startDragWatch: (cb) => { s.watching = true; s.onDrag = cb },
      stopDragWatch: () => { s.watching = false },
      getFrontWindow: async () => w, listWindows: async () => [w],
      setWindowFrame: async () => { s.frames++; return w.frame }, raiseWindow: async () => {}, destroy: () => {}
    }`),
  '../panel': fake(`export const hidePanel = () => {}; export const showPanel = (r) => globalThis.__sg.panels.push(r)`),
  './focus-dim': fake(`export const getFocusDimService = () => ({ getState: () => ({ enabled: false }) })`),
  '../launcher/window-commands': fake(`export const setWindowCommandHandler = () => {}`)
})
console.log = () => {}
console.warn = () => {}

const { getSnapGridService, initSnapGrid, destroySnapGrid } = await import(srcUrl('src/main/services/snapgrid.ts'))
const s = g.__sg
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1)) }
let svc = getSnapGridService()
const drag = async (allowedWhenDragging = s.allowed): Promise<void> => {
  s.allowed = allowedWhenDragging
  s.onDrag!({ e: 'start', pid: 42, windowId: 7 })
  await settle()
  s.onDrag?.({ e: 'move', x: 2, y: 400 })
  await settle()
  s.onDrag?.({ e: 'end', x: 2, y: 400 })
  await new Promise((r) => setTimeout(r, 100))
}

// 1a. Trial over at launch, first thing is a drag: no preview, no snap, the
// notice once, then the drag watch stops
s.allowed = false
initSnapGrid()
await settle()
assert.equal(s.watching, true, 'watch kept only until the notice is shown')
await drag(false)
assert.equal(s.previews, 0, 'no preview')
assert.equal(s.frames, 0, 'no snap')
assert.deepEqual(s.panels, ['snapgrid'], 'first blocked drag opens the trial-ended screen')
assert.equal(s.watching, false, 'then drag-snapping is off')
assert.equal(await svc.applyLayout('left'), 'Your trial has ended')
assert.deepEqual(s.panels, ['snapgrid'], 'only once')
destroySnapGrid()

// 1b. Trial over at launch, first thing is a key: keys move nothing, notice once, watch stops
s.panels.length = 0; s.licence.length = 0
s.allowed = false
initSnapGrid()
svc = getSnapGridService()
await settle()
assert.equal(await svc.applyLayout('left'), 'Your trial has ended')
assert.equal(s.frames, 0)
assert.deepEqual(s.panels, ['snapgrid'], 'first blocked key opens the trial-ended screen')
await settle()
assert.equal(s.watching, false, 'drag watch stops after the notice')
await svc.applyLayout('right')
await svc.arrange('grid')
assert.deepEqual(s.panels, ['snapgrid'], 'only once')
destroySnapGrid()

// 2. Trial ends while running: the next drag shows no preview, snaps nothing, says so once
s.panels.length = 0; s.previews = 0; s.frames = 0; s.licence.length = 0
s.allowed = true
initSnapGrid()
svc = getSnapGridService()
await settle()
assert.equal(s.watching, true, 'drag watch on with access')
await drag(true)
assert.equal(s.frames, 1, 'with access a drag to the left edge snaps')
assert.ok(s.previews >= 1, '…with a preview')
s.previews = 0; s.frames = 0
await drag(false)
assert.equal(s.previews, 0, 'no preview after the trial ended')
assert.equal(s.frames, 0, 'no snap after the trial ended')
assert.equal(s.watching, false, 'drag watch stopped')
assert.deepEqual(s.panels, ['snapgrid'], 'trial-ended screen once')
// Clicks inside the panel never open it again
await svc.applyLayout('left', { fromPanel: true })
assert.deepEqual(s.panels, ['snapgrid'])

// 3. A licence entered later turns drag-snapping back on
s.allowed = true
for (const cb of s.licence) cb()
await settle()
assert.equal(s.watching, true, 'licence change restarts the drag watch')
destroySnapGrid()

console.info('snapgrid-trial: ok')
