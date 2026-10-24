/**
 * The v2 one-app panel: a single small dark window that drops down from the
 * menu-bar (tray) icon and holds all four tools behind a switcher.
 *
 * - Clicking the tray icon toggles it; ⌥⌘1–4 open it on a tool.
 * - It hides (never closes) when it loses focus, so its renderer stays alive.
 * - The renderer reports its content height (PANEL_RESIZE) and the window
 *   follows, capped at PANEL_MAX_HEIGHT.
 */

import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { SystemWindowId, isPanelTool, DICTATION_PAGE } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { restorePreviousApp, rememberFrontApp, getActiveWindow } from './native/active-window'

export const PANEL_WIDTH = 340
const PANEL_MIN_HEIGHT = 120
const PANEL_MAX_HEIGHT = 640
const GAP = 6

let panel: BrowserWindow | null = null
let height = 360
let anchor: (() => Rectangle | null) | null = null
let pendingRoute: string | null = null
let rendererReady = false
let lastHiddenAt = 0
/** While > 0 the panel stays open on blur (native dialogs opened from it). */
let blurHold = 0
let quitting = false
/** The tool the panel is showing ('focusdim', …) or null on an app-wide page */
let currentTool: string | null = null

/** Where the tray icon is, so the panel can sit under it. */
export function setPanelAnchor(fn: () => Rectangle | null): void {
  anchor = fn
}

export function setPanelQuitting(v: boolean): void {
  quitting = v
}

/** Keep the panel open while a native dialog (file picker, etc.) is up. */
export async function holdPanelOpen<T>(fn: () => Promise<T>): Promise<T> {
  blurHold++
  try {
    return await fn()
  } finally {
    blurHold--
  }
}

function pinnedForScreenshots(): boolean {
  return process.env['PEAKFLOW_PANEL_PIN'] === '1'
}

function position(win: BrowserWindow): void {
  const tray = anchor?.() ?? null
  const point = tray ? { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 } : screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const wa = display.workArea
  let x = Math.round(point.x - PANEL_WIDTH / 2)
  x = Math.max(wa.x + GAP, Math.min(x, wa.x + wa.width - PANEL_WIDTH - GAP))
  // Menu bar / top taskbar: drop down. Bottom taskbar (Windows): pop up.
  const trayAtBottom = tray ? tray.y > display.bounds.y + display.bounds.height / 2 : false
  const y = trayAtBottom ? wa.y + wa.height - height - GAP : wa.y + GAP
  win.setBounds({ x, y, width: PANEL_WIDTH, height })
}

function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
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
    backgroundColor: '#0b0b0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.on('blur', () => {
    if (blurHold > 0 || pinnedForScreenshots() || win.webContents.isDevToolsOpened()) return
    hidePanel()
  })
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hidePanel()
  })
  win.on('closed', () => {
    panel = null
    rendererReady = false
  })
  // A reload (or a renderer restart) queues the route until the page is back
  win.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    rendererReady = false
    if (!quitting && d.reason !== 'clean-exit' && !win.isDestroyed()) win.webContents.reload()
  })
  // A route is only sent once the page is listening (panelRendererReady) AND has
  // finished loading (send() drops messages to a loading page). The panel asks
  // for any route queued before it was listening; one queued after that, while
  // the page was still loading, is flushed here.
  win.webContents.on('did-finish-load', () => flushPendingRoute(win))

  const query = { toolId: SystemWindowId.Panel }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`).catch((err) => {
      console.error('[PeakFlow] Failed to load panel (dev):', err)
    })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query }).catch((err) => {
      console.error('[PeakFlow] Failed to load panel:', err)
    })
  }
  return win
}

/**
 * The panel page has mounted and is listening (PANEL_READY). Returns the route
 * asked for while it was loading, if any; later routes are sent directly.
 */
export function panelRendererReady(sender: Electron.WebContents): string | null {
  const win = getPanel()
  if (!win || sender !== win.webContents) return null
  rendererReady = true
  const route = pendingRoute
  pendingRoute = null
  return route
}

/** Deliver the queued route if the page can take it now; otherwise keep it queued. */
function flushPendingRoute(win: BrowserWindow): void {
  if (!pendingRoute || !rendererReady || win.webContents.isDestroyed() || win.webContents.isLoading()) return
  send(win, IPC_SEND.PANEL_NAVIGATE, pendingRoute)
  pendingRoute = null
}

export function getPanel(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null
}

/** Create the panel window early (hidden) so the first click is instant. */
export function initPanel(): void {
  if (!getPanel()) panel = create()
}

/** Show the panel, optionally on a route such as 'quickboard' or 'liquidfocus/settings'. */
export function showPanel(route?: string): void {
  if (!getPanel()) panel = create()
  const win = panel!
  if (route) {
    setPanelRoute(route)
    pendingRoute = route
    flushPendingRoute(win)
  }
  position(win)
  if (process.platform === 'darwin' && !win.isVisible()) rememberFrontApp()
  win.show()
  win.focus()
  win.setAlwaysOnTop(true, 'pop-up-menu')
  send(win, IPC_SEND.PANEL_VISIBILITY, true)
  watchUnfocusedShow(win)
}

let unfocusedWatch: ReturnType<typeof setInterval> | null = null

/**
 * Windows can refuse focus to an app that isn't in front (on launch, for
 * example). The panel then shows without focus, never gets a blur, and sat
 * on top of every other app. Until it does get focus, hide it once the user
 * switches to another window.
 */
function watchUnfocusedShow(win: BrowserWindow): void {
  if (unfocusedWatch) clearInterval(unfocusedWatch)
  const key = (w: ReturnType<typeof getActiveWindow>): string => (w ? `${w.pid}:${w.title}` : '')
  const start = key(getActiveWindow())
  let ticks = 0
  unfocusedWatch = setInterval(() => {
    ticks++
    const front = getActiveWindow()
    const done = win.isDestroyed() || !win.isVisible() || win.isFocused()
    if (!done && front && front.pid !== process.pid && key(front) !== start) hidePanel(true)
    if (done || !win.isVisible() || ticks > 240) {
      if (unfocusedWatch) clearInterval(unfocusedWatch)
      unfocusedWatch = null
    }
  }, 250)
}

export function hidePanel(force = false): void {
  const win = getPanel()
  if (!win || !win.isVisible()) return
  // Closed with Esc or the tray icon (not by clicking another app). On a Mac,
  // hiding the focused panel left PeakFlow in front with no window, and macOS
  // washed the whole screen light grey for about half a second. Give focus
  // back to the previous app first; the panel's blur handler then hides it,
  // the same path as clicking another app, which shows no wash.
  if (!force && process.platform === 'darwin' && win.isFocused() && restorePreviousApp()) {
    setTimeout(() => {
      if (win.isVisible()) hidePanel(true)
    }, 300)
    return
  }
  win.hide()
  lastHiddenAt = Date.now()
  send(win, IPC_SEND.PANEL_VISIBILITY, false)
}

/** Tray click. A click that itself caused the blur-hide must not re-open it. */
export function togglePanel(): void {
  const win = getPanel()
  if (win?.isVisible()) {
    hidePanel()
    return
  }
  if (Date.now() - lastHiddenAt < 250) return
  showPanel()
}

/** Renderer reports its content height; keep the top edge fixed. */
export function resizePanel(h: number): void {
  if (!Number.isFinite(h)) return
  height = Math.round(Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, h)))
  const win = getPanel()
  if (!win) return
  if (win.isVisible()) position(win)
  else win.setSize(PANEL_WIDTH, height)
}

/** Record the panel's route (from showPanel or the renderer's own navigation). */
export function setPanelRoute(route: string): void {
  const tool = route.split('/')[0]
  currentTool = isPanelTool(tool) || tool === DICTATION_PAGE ? tool : null
}

/** The tool on screen in the panel, or null when it's hidden or on an app-wide page. */
export function visiblePanelTool(): string | null {
  return isPanelVisible() ? currentTool : null
}

export function isPanelVisible(): boolean {
  return !!getPanel()?.isVisible()
}

/** Send to the panel page, skipping a page that is reloading or gone. */
function send(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  const wc = win.webContents
  if (wc.isDestroyed() || wc.isCrashed() || wc.isLoading()) return
  try {
    wc.send(channel, ...args)
  } catch {
    /* frame disposed mid-reload; the page asks for its state when it loads */
  }
}
