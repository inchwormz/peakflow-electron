/**
 * The launcher window: one frameless bar, created hidden at startup and kept
 * alive, so the hotkey only has to show it (no page load on open).
 *
 * macOS: an NSPanel ('panel' type) that takes the keyboard without making
 * PeakFlow the active app, like Spotlight. The app you were in stays active,
 * so closing the bar hands focus straight back and the AI actions can read
 * that app's selection. It floats over full-screen apps too.
 */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { SystemWindowId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import type { LauncherOpenInfo } from '@shared/launcher/types'

export const LAUNCHER_WIDTH = 680
const MIN_H = 64
const MAX_H = 540

let win: BrowserWindow | null = null
let height = 380
let quitting = false
let blurHold = 0
let shownAt = 0
let onHidden: (() => void) | null = null

export function setLauncherQuitting(v: boolean): void {
  quitting = v
}

export function onLauncherHidden(fn: () => void): void {
  onHidden = fn
}

export function getLauncherWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

function send(channel: string, ...args: unknown[]): void {
  const w = getLauncherWindow()
  if (!w || w.webContents.isDestroyed() || w.webContents.isLoading()) return
  try {
    w.webContents.send(channel, ...args)
  } catch { /* reloading */ }
}

function place(w: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const x = Math.round(wa.x + (wa.width - LAUNCHER_WIDTH) / 2)
  const y = Math.round(wa.y + wa.height * 0.18)
  w.setBounds({ x, y, width: LAUNCHER_WIDTH, height })
}

function create(): BrowserWindow {
  const w = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    transparent: false,
    backgroundColor: '#0f0f0f',
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  w.setAlwaysOnTop(true, 'pop-up-menu')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.on('blur', () => {
    if (blurHold > 0 || w.webContents.isDevToolsOpened() || process.env['PEAKFLOW_LAUNCHER_PIN'] === '1') return
    // A blur straight after showing is the OS settling focus, not the person clicking away
    if (Date.now() - shownAt < 150) return
    hideLauncher()
  })
  w.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hideLauncher()
  })
  w.on('closed', () => {
    win = null
  })
  w.webContents.on('render-process-gone', (_e, d) => {
    if (!quitting && d.reason !== 'clean-exit' && !w.isDestroyed()) w.webContents.reload()
  })
  const query = { toolId: SystemWindowId.Launcher }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return w
}

/** Create the hidden bar early so the first open is instant. */
export function initLauncherWindow(): void {
  if (!getLauncherWindow()) win = create()
}

export function isLauncherVisible(): boolean {
  return !!getLauncherWindow()?.isVisible()
}

export function showLauncher(info: Partial<LauncherOpenInfo> = {}): void {
  if (!getLauncherWindow()) win = create()
  const w = win!
  shownAt = Date.now()
  // Tell the page first so it resets while still hidden (no flash of the last search)
  send(IPC_SEND.LAUNCHER_SHOWN, { at: info.at ?? shownAt, view: info.view } satisfies LauncherOpenInfo)
  place(w)
  w.show()
  w.focus()
  w.setAlwaysOnTop(true, 'pop-up-menu')
}

export function hideLauncher(): void {
  const w = getLauncherWindow()
  if (!w || !w.isVisible()) return
  w.hide()
  send(IPC_SEND.LAUNCHER_HIDDEN)
  onHidden?.()
}

export function toggleLauncher(at = Date.now()): void {
  if (isLauncherVisible()) hideLauncher()
  else showLauncher({ at })
}

/** Keep the bar open while something briefly takes focus (copying the selection). */
export function holdLauncherOpen(on: boolean): void {
  blurHold = Math.max(0, blurHold + (on ? 1 : -1))
}

/** Bring the bar back after it stepped aside, without resetting the page. */
export function refocusLauncher(): void {
  const w = getLauncherWindow()
  if (!w) return
  shownAt = Date.now()
  if (!w.isVisible()) w.show()
  w.focus()
  w.setAlwaysOnTop(true, 'pop-up-menu')
}

/** Step aside (hide without telling the page) so the app underneath gets the keyboard. */
export function stepAsideLauncher(): void {
  const w = getLauncherWindow()
  if (w?.isVisible()) w.hide()
}

/** The page reports its content height; the top edge stays put. */
export function resizeLauncher(h: unknown): void {
  if (typeof h !== 'number' || !Number.isFinite(h)) return
  height = Math.round(Math.max(MIN_H, Math.min(MAX_H, h)))
  const w = getLauncherWindow()
  if (!w) return
  const b = w.getBounds()
  if (b.height !== height) w.setBounds({ x: b.x, y: b.y, width: LAUNCHER_WIDTH, height })
}

export function sendToLauncher(channel: string, ...args: unknown[]): void {
  send(channel, ...args)
}
