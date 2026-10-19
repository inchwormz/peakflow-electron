/**
 * Check: a route asked for while the panel page loads (a shortcut pressed at
 * start-up or during a reload) is kept until the page says it is listening,
 * then handed over, never sent into a page that can't hear it (Sol review 2,
 * P2). Loads the real src/main/panel.ts; electron is a fake window.
 * Run: node scripts/checks/panel-route.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

installTsHooks({
  electron: fake(`
    export class BrowserWindow {
      constructor() {
        this.h = {}; this.wh = {}; this.sent = []; this.loading = true; this.visible = false
        const w = this
        this.webContents = {
          on: (e, f) => { (w.wh[e] ??= []).push(f) },
          send: (c, ...a) => { w.sent.push([c, ...a]) },
          isDestroyed: () => false, isCrashed: () => false, isLoading: () => w.loading,
          isDevToolsOpened: () => false, reload() {}
        }
        globalThis.__win = this
      }
      emit(e) { for (const f of this.wh[e] ?? []) f() }
      on(e, f) { (this.h[e] ??= []).push(f) }
      setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setBounds() {} setSize() {} focus() {}
      loadURL() { return Promise.resolve() } loadFile() { return Promise.resolve() }
      isDestroyed() { return false } show() { this.visible = true } hide() { this.visible = false } isVisible() { return this.visible }
    }
    const area = { x: 0, y: 0, width: 1400, height: 900 }
    export const screen = { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ workArea: area, bounds: area }) }`),
  '@electron-toolkit/utils': fake('export const is = { dev: false }')
})
const panel = await import(srcUrl('src/main/panel.ts'))
const win = () => (globalThis as unknown as { __win: { sent: unknown[][]; loading: boolean; webContents: object; emit: (e: string) => void } }).__win
const navs = () => win().sent.filter((m) => m[0] === 'panel:navigate').map((m) => m[1])

// Shortcut pressed while the page is still loading
panel.initPanel()
panel.showPanel('quickboard')
win().loading = false
win().emit('did-finish-load') // page loaded, but React listeners may not be up yet
assert.deepEqual(navs(), [], 'nothing sent into a page that may not be listening')

// A different window can't take the route
assert.equal(panel.panelRendererReady({}), null)
// The panel says it is listening: it gets the latest route asked for, once
assert.equal(panel.panelRendererReady(win().webContents), 'quickboard')
assert.equal(panel.panelRendererReady(win().webContents), null, 'handed over once (StrictMode re-ask gets nothing)')

// Once ready, routes go straight to the page
panel.showPanel('liquidfocus')
assert.deepEqual(navs(), ['liquidfocus'])

// A reload makes it wait again
win().emit('did-start-loading')
win().loading = true
panel.showPanel('screenslap')
panel.showPanel('focusdim')
assert.deepEqual(navs(), ['liquidfocus'])
win().loading = false
win().emit('did-finish-load')
assert.equal(panel.panelRendererReady(win().webContents), 'focusdim', 'the newest request wins')

console.log('panel-route: ok')
