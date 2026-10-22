/**
 * SnapGrid service: put any app window into a half, third or corner.
 *
 * - Layouts act on the "target": the last window of another app that was in
 *   front. The panel takes focus when it opens, so the target is tracked by
 *   polling the front window a few times a second.
 * - "Put it back" restores the frame a window had before SnapGrid moved it.
 * - Hovering a layout in the panel shows where the window(s) will go on a
 *   click-through overlay.
 * - macOS only: dragging a window to a screen edge snaps it, unless macOS's
 *   own edge tiling (macOS 15+) is on, because two previews would fight.
 *   Windows always has Snap for drags, so SnapGrid adds keys and layouts there.
 */

import { BrowserWindow, screen, shell } from 'electron'
import type { Display } from 'electron'
import { ToolId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { SNAP_LAYOUT_BY_KEY, ARRANGE_BY_KEY } from '@shared/snapgrid-layouts'
import type { FracRect, SnapLayoutKey, ArrangeKey, SnapGridState } from '@shared/snapgrid-layouts'
import type { SnapGridConfig } from '@shared/config-schemas'
import { getConfig, setConfig } from './config-store'
import { checkAccess } from '../security/access-check'
import { withToolAccess } from '../security/access-guard'
import { windowSnap } from '../native/window-snap'
import { hidePanel } from '../panel'
import { getFocusDimService } from './focus-dim'
import { setWindowCommandHandler } from '../launcher/window-commands'
import type { SnapRect, SnapWindow, DragEvent } from '../native/window-snap'

const POLL_MS = 350
const EDGE = 6 // px from a screen edge that counts as "at the edge" while dragging
const CORNER = 80 // px from a corner that counts as the corner

function ownPid(w: SnapWindow | null): boolean {
  return !!w && w.pid === process.pid
}

function displayOf(r: SnapRect): Display {
  return screen.getDisplayMatching({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) })
}

/** Fraction of a screen's usable area → absolute rect, snapped to whole points so neighbours meet exactly. */
function place(f: FracRect, d: Display): SnapRect {
  const wa = d.workArea
  const x0 = Math.round(wa.x + f.x * wa.width)
  const y0 = Math.round(wa.y + f.y * wa.height)
  const x1 = Math.round(wa.x + (f.x + f.w) * wa.width)
  const y1 = Math.round(wa.y + (f.y + f.h) * wa.height)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

class SnapGridService {
  private target: SnapWindow | null = null
  private history = new Map<string, SnapRect[]>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private osDrag = false
  private overlay: BrowserWindow | null = null
  private overlayReady: Promise<void> | null = null
  private drag: { pid: number; windowId: number; zone: FracRect | null; display: Display | null } | null = null

  private conf(): SnapGridConfig {
    return getConfig(ToolId.SnapGrid) as SnapGridConfig
  }

  init(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS)
    void this.poll()
    void this.refreshDragWatch()
  }

  destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    windowSnap.destroy()
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy()
    this.overlay = null
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const front = await windowSnap.getFrontWindow()
      if (front && !ownPid(front) && front.id !== this.target?.id) {
        this.target = front
        this.broadcast()
      } else if (front && !ownPid(front)) {
        this.target = front
      }
    } finally {
      this.polling = false
    }
  }

  /** The window layouts act on, with a fresh frame. */
  private async currentTarget(): Promise<SnapWindow | null> {
    const front = await windowSnap.getFrontWindow()
    if (front && !ownPid(front)) {
      this.target = front
      return front
    }
    if (!this.target) return null
    // The panel is in front: re-read the last target's frame from the window list
    const all = await windowSnap.listWindows()
    const fresh = all.find((w) => w.id === this.target!.id) ?? all.find((w) => w.pid === this.target!.pid && !ownPid(w))
    if (fresh) this.target = fresh
    else this.target = null
    return this.target
  }

  /** Windows on the target's screen, target first, then front to back. */
  private async windowsOnTargetScreen(target: SnapWindow | null): Promise<SnapWindow[]> {
    const all = (await windowSnap.listWindows()).filter((w) => !ownPid(w))
    if (!target) return all
    const d = displayOf(target.frame)
    const same = all.filter((w) => w.id !== target.id && displayOf(w.frame).id === d.id)
    const self = all.find((w) => w.id === target.id) ?? target
    return [self, ...same]
  }

  private remember(w: SnapWindow): void {
    const stack = this.history.get(w.id) ?? []
    stack.push({ ...w.frame })
    if (stack.length > 10) stack.shift()
    this.history.set(w.id, stack)
    if (this.history.size > 100) this.history.delete(this.history.keys().next().value as string)
  }

  /** Where a layout puts a window (null when it can't apply). */
  private rectFor(key: SnapLayoutKey, w: SnapWindow): SnapRect | null {
    const layout = SNAP_LAYOUT_BY_KEY[key]
    const d = displayOf(w.frame)
    if (layout.rect) return place(layout.rect, d)
    const wa = d.workArea
    if (key === 'centre') {
      const width = Math.min(w.frame.w, wa.width)
      const height = Math.min(w.frame.h, wa.height)
      return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), w: width, h: height }
    }
    if (key === 'next') {
      const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      if (displays.length < 2) return null
      const i = displays.findIndex((x) => x.id === d.id)
      const to = displays[(i + 1) % displays.length].workArea
      const fx = (w.frame.x - wa.x) / wa.width
      const fy = (w.frame.y - wa.y) / wa.height
      const width = Math.min(Math.round((w.frame.w / wa.width) * to.width), to.width)
      const height = Math.min(Math.round((w.frame.h / wa.height) * to.height), to.height)
      return {
        x: Math.round(Math.min(Math.max(to.x + fx * to.width, to.x), to.x + to.width - width)),
        y: Math.round(Math.min(Math.max(to.y + fy * to.height, to.y), to.y + to.height - height)),
        w: width,
        h: height
      }
    }
    return null
  }

  // ─── actions (all gated on the licence/trial) ─────────────────────────────

  /** Snap the target window. Returns a short message for the panel's toast. */
  applyLayout(key: SnapLayoutKey, opts: { fromPanel?: boolean } = {}): Promise<string> {
    return withToolAccess(checkAccess, ToolId.SnapGrid, async () => {
      this.hidePreview()
      const w = await this.currentTarget()
      if (!w) return 'Click the window you want to move first'
      const r = this.rectFor(key, w)
      if (!r) return key === 'next' ? 'Only one screen is connected' : 'That layout can’t be used here'
      this.remember(w)
      const after = await windowSnap.setWindowFrame(w, r)
      if (!after) {
        this.history.get(w.id)?.pop()
        return `${w.appName || 'That window'} can’t be moved`
      }
      if (opts.fromPanel) await this.finishFromPanel(w)
      this.broadcast()
      return `${w.appName}: ${SNAP_LAYOUT_BY_KEY[key].name.toLowerCase()}`
    }, () => 'Your trial has ended')
  }

  arrange(key: ArrangeKey): Promise<string> {
    return withToolAccess(checkAccess, ToolId.SnapGrid, async () => {
      this.hidePreview()
      const target = await this.currentTarget()
      const wins = (await this.windowsOnTargetScreen(target)).slice(0, ARRANGE_BY_KEY[key].max)
      if (!wins.length) return 'No windows to arrange'
      const d = displayOf(wins[0].frame)
      const rects = ARRANGE_BY_KEY[key].rects(wins.length).map((f) => place(f, d))
      let moved = 0
      // Back to front, so the front window is moved (and raised) last
      for (let i = rects.length - 1; i >= 0; i--) {
        this.remember(wins[i])
        if (await windowSnap.setWindowFrame(wins[i], rects[i])) moved++
        else this.history.get(wins[i].id)?.pop()
      }
      for (let i = rects.length - 1; i >= 0; i--) await windowSnap.raiseWindow(wins[i])
      this.hidePanelSoon()
      this.broadcast()
      return moved === 1 ? '1 window arranged' : `${moved} windows arranged`
    }, () => 'Your trial has ended')
  }

  async undo(opts: { fromPanel?: boolean } = {}): Promise<string> {
    const w = await this.currentTarget()
    const stack = w ? this.history.get(w.id) : undefined
    if (!w || !stack?.length) return 'Nothing to put back'
    const prev = stack.pop()!
    await windowSnap.setWindowFrame(w, prev)
    if (opts.fromPanel) await this.finishFromPanel(w)
    this.broadcast()
    return `${w.appName} put back`
  }

  /** Hover preview in the panel: show where the window(s) would go. */
  async preview(kind: 'layout' | 'arrange' | null, key?: string): Promise<void> {
    if (!kind) return this.hidePreview()
    const target = await this.currentTarget()
    if (kind === 'layout' && target && key && key in SNAP_LAYOUT_BY_KEY) {
      const r = this.rectFor(key as SnapLayoutKey, target)
      if (r) this.showPreview([r], displayOf(r))
      else this.hidePreview()
    } else if (kind === 'arrange' && key && key in ARRANGE_BY_KEY) {
      const wins = (await this.windowsOnTargetScreen(target)).slice(0, ARRANGE_BY_KEY[key as ArrangeKey].max)
      if (!wins.length) return this.hidePreview()
      const d = displayOf(wins[0].frame)
      this.showPreview(ARRANGE_BY_KEY[key as ArrangeKey].rects(wins.length).map((f) => place(f, d)), d)
    }
  }

  /** After a click in the panel: close it and bring the moved window forward. */
  private async finishFromPanel(w: SnapWindow): Promise<void> {
    this.hidePanelSoon()
    await windowSnap.raiseWindow(w)
  }

  private hidePanelSoon(): void {
    hidePanel()
  }

  // ─── state ────────────────────────────────────────────────────────────────

  async getState(): Promise<SnapGridState> {
    const target = await this.currentTarget()
    const wins = await this.windowsOnTargetScreen(target)
    this.osDrag = await windowSnap.osHandlesEdgeDrag()
    void this.refreshDragWatch()
    let dim = false
    try {
      dim = getFocusDimService().getState().enabled
    } catch {
      /* FocusDim not started */
    }
    return {
      target: target ? { appName: target.appName, icon: target.icon } : null,
      windows: wins.slice(0, 6).map((w) => ({ appName: w.appName, icon: w.icon })),
      dragSnap: this.conf().drag_snap,
      osDrag: this.osDrag,
      dim,
      canUndo: !!(target && this.history.get(target.id)?.length)
    }
  }

  private broadcast(): void {
    void this.getState().then((s) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_SEND.SNAPGRID_STATE_CHANGED, s)
      }
    }).catch(() => {})
  }

  setDragSnap(on: boolean): void {
    setConfig(ToolId.SnapGrid, 'drag_snap', on)
    void this.refreshDragWatch()
  }

  openOsWindowSettings(): void {
    void shell.openExternal(process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.Desktop-Settings.extension' : 'ms-settings:multitasking')
  }

  // ─── drag to edge (macOS) ─────────────────────────────────────────────────

  private async refreshDragWatch(): Promise<void> {
    if (process.platform !== 'darwin') return
    this.osDrag = await windowSnap.osHandlesEdgeDrag()
    if (this.conf().drag_snap && !this.osDrag) windowSnap.startDragWatch((e) => this.onDrag(e))
    else windowSnap.stopDragWatch()
  }

  private zoneAt(x: number, y: number): { rect: FracRect | null; display: Display } {
    const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) })
    const b = d.bounds
    const left = x <= b.x + EDGE
    const right = x >= b.x + b.width - 1 - EDGE
    const top = y <= b.y + EDGE
    const bottom = y >= b.y + b.height - 1 - EDGE
    const nearTop = y <= b.y + CORNER
    const nearBottom = y >= b.y + b.height - CORNER
    let key: SnapLayoutKey | null = null
    if ((left || right) && nearTop) key = left ? 'tl' : 'tr'
    else if ((left || right) && nearBottom) key = left ? 'bl' : 'br'
    else if (left) key = 'left'
    else if (right) key = 'right'
    else if (top) key = 'fill'
    else if (bottom) {
      // Bottom edge: thirds, picked by where along the edge you are
      const fx = (x - b.x) / b.width
      key = fx < 1 / 3 ? 't1' : fx < 2 / 3 ? 't2' : 't3'
    }
    return { rect: key ? SNAP_LAYOUT_BY_KEY[key].rect : null, display: d }
  }

  private onDrag(e: DragEvent): void {
    if (e.e === 'start') {
      if (e.pid === process.pid) return
      this.drag = { pid: e.pid, windowId: e.windowId, zone: null, display: null }
      return
    }
    if (!this.drag) return
    if (e.e === 'move') {
      const { rect, display } = this.zoneAt(e.x, e.y)
      if (rect !== this.drag.zone || display.id !== this.drag.display?.id) {
        this.drag.zone = rect
        this.drag.display = display
        if (rect) this.showPreview([place(rect, display)], display)
        else this.hidePreview()
      }
      return
    }
    if (e.e === 'end') {
      const drag = this.drag
      this.drag = null
      this.hidePreview()
      const { rect, display } = this.zoneAt(e.x, e.y)
      if (!rect) return
      void withToolAccess(checkAccess, ToolId.SnapGrid, async () => {
        const all = await windowSnap.listWindows()
        const w = all.find((x) => x.id === `${drag.pid}:${drag.windowId}`)
        if (!w) return
        // Let macOS finish the drag before we set the final frame
        await new Promise((r) => setTimeout(r, 60))
        await windowSnap.setWindowFrame(w, place(rect, display))
      }, () => undefined)
    }
  }

  // ─── preview overlay ──────────────────────────────────────────────────────

  private ensureOverlay(): Promise<void> {
    if (this.overlay && !this.overlay.isDestroyed() && this.overlayReady) return this.overlayReady
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      title: '__peakflow_snap__',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    win.setIgnoreMouseEvents(true)
    // Above app windows, below the panel ('pop-up-menu')
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.overlay = win
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.z{position:absolute;box-sizing:border-box;border-radius:12px;background:rgba(110,116,128,.3);border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.5),inset 0 0 0 1px rgba(0,0,0,.35),0 12px 48px rgba(0,0,0,.35);transition:left .12s ease,top .12s ease,width .12s ease,height .12s ease}
</style></head><body></body></html>`
    this.overlayReady = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
    win.on('closed', () => {
      if (this.overlay === win) {
        this.overlay = null
        this.overlayReady = null
      }
    })
    return this.overlayReady
  }

  private showPreview(rects: SnapRect[], d: Display): void {
    const pad = 6
    const local = rects.map((r) => ({ x: r.x - d.bounds.x + pad, y: r.y - d.bounds.y + pad, w: r.w - pad * 2, h: r.h - pad * 2 }))
    void this.ensureOverlay().then(() => {
      const win = this.overlay
      if (!win || win.isDestroyed()) return
      const b = win.getBounds()
      if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) win.setBounds(d.bounds)
      // No script in the page (the app's CSP blocks inline scripts): draw from here
      const boxes = local.map((r) => `<div class="z" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`).join('')
      void win.webContents.executeJavaScript(`document.body.innerHTML=${JSON.stringify(boxes)}`).catch(() => {})
      if (process.platform === 'darwin') win.setOpacity(1)
      if (!win.isVisible()) win.showInactive()
    })
  }

  private hidePreview(): void {
    const win = this.overlay
    if (win && !win.isDestroyed() && win.isVisible()) {
      // Transparent first: macOS fades out the last frame on hide, and the
      // page clear below lands after that frame was captured. Not on Windows:
      // window opacity there stops a transparent window drawing at all.
      if (process.platform === 'darwin') win.setOpacity(0)
      void win.webContents.executeJavaScript("document.body.innerHTML=''").catch(() => {})
      win.hide()
    }
  }
}

let service: SnapGridService | null = null

export function getSnapGridService(): SnapGridService {
  if (!service) service = new SnapGridService()
  return service
}

export function initSnapGrid(): void {
  getSnapGridService().init()
  // The launcher lists window commands ("left half" …) only while this is set.
  setWindowCommandHandler((key) => getSnapGridService().applyLayout(key as SnapLayoutKey))
}

export function destroySnapGrid(): void {
  setWindowCommandHandler(null)
  service?.destroy()
  service = null
}
