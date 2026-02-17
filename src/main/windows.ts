/**
 * Window factory — creates and manages BrowserWindows for each tool.
 *
 * All tool windows are frameless with a dark background (#08080a).
 * The renderer is responsible for drawing its own title bar via the
 * `-webkit-app-region: drag` CSS property.
 */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import { checkAccess } from './security/access-check'

type WindowId = ToolId | SystemWindowId

/** Active window instances keyed by their WindowId string */
const windowMap = new Map<string, BrowserWindow>()

// ─── Per-window size and behavior overrides ────────────────────────────────────

interface WindowOverrides {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  alwaysOnTop?: boolean
  skipTaskbar?: boolean
  fullscreen?: boolean
  transparent?: boolean
  focusable?: boolean
}

const WINDOW_CONFIGS: Record<string, WindowOverrides> = {
  [SystemWindowId.Dashboard]: { width: 420, height: 560, resizable: false },
  [ToolId.FocusDim]: { width: 340, height: 680, resizable: false },
  [ToolId.QuickBoard]: { width: 340, height: 540, alwaysOnTop: true, skipTaskbar: true },
  [ToolId.MeetReady]: { width: 340, height: 540 },
  [ToolId.SoundSplit]: { width: 340, height: 540, minWidth: 340, minHeight: 400 },
  [ToolId.LiquidFocus]: { width: 420, height: 640, minWidth: 340, minHeight: 540, alwaysOnTop: true },
  [ToolId.ScreenSlap]: { width: 400, height: 600 },
  [SystemWindowId.ScreenSlapAlert]: {
    width: 0,
    height: 0,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true
  },
  [SystemWindowId.FocusDimOverlay]: {
    width: 0,
    height: 0,
    transparent: true,
    focusable: false,
    skipTaskbar: true
  },
  [SystemWindowId.TrialExpired]: {
    width: 460,
    height: 420,
    resizable: false,
    alwaysOnTop: true
  },
  [SystemWindowId.Settings]: { width: 500, height: 600 }
}

/**
 * Create (or focus) a BrowserWindow for the given tool / system window.
 *
 * If a window with the same `toolId` already exists it is focused and
 * returned immediately — no duplicate windows are created.
 */
export function createToolWindow(toolId: WindowId): BrowserWindow {
  // Re-use existing window if one is open for this tool
  const existing = windowMap.get(toolId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }

  const overrides = WINDOW_CONFIGS[toolId] ?? { width: 500, height: 600 }

  // Use primary display dimensions for fullscreen / overlay windows
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize

  const winWidth = overrides.fullscreen ? screenW : overrides.width
  const winHeight = overrides.fullscreen ? screenH : overrides.height

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: overrides.minWidth,
    minHeight: overrides.minHeight,
    resizable: overrides.resizable !== false,
    alwaysOnTop: overrides.alwaysOnTop ?? false,
    skipTaskbar: overrides.skipTaskbar ?? false,
    fullscreen: overrides.fullscreen ?? false,
    transparent: overrides.transparent ?? false,
    focusable: overrides.focusable !== false,
    frame: false,
    show: false,
    backgroundColor: '#08080a',
    center: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Show when the renderer has painted its first frame
  win.once('ready-to-show', () => {
    win.show()
  })

  // Clean up on close
  win.on('closed', () => {
    windowMap.delete(toolId)
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const devUrl = `${process.env['ELECTRON_RENDERER_URL']}?toolId=${toolId}`
    win.loadURL(devUrl).catch((err) => {
      console.error(`[PeakFlow] Failed to load dev URL for ${toolId}:`, err)
    })
  } else {
    const prodPath = join(__dirname, '../renderer/index.html')
    win.loadFile(prodPath, { query: { toolId } }).catch((err) => {
      console.error(`[PeakFlow] Failed to load production file for ${toolId}:`, err)
    })
  }

  windowMap.set(toolId, win)
  console.log(`[PeakFlow] Window created: ${toolId}`)

  return win
}

/**
 * Retrieve an existing window by its tool / system ID.
 * Returns `undefined` if no window is open for that ID.
 */
export function getToolWindow(toolId: string): BrowserWindow | undefined {
  const win = windowMap.get(toolId)
  if (win && !win.isDestroyed()) return win
  // Stale entry — clean it up
  if (win) windowMap.delete(toolId)
  return undefined
}

/**
 * Open a tool window with trial/license enforcement.
 *
 * If the user's trial has expired and they have no license, the tool window
 * is NOT created. Instead the TrialExpired window is shown.
 *
 * System windows (Dashboard, Settings, overlays, alerts) bypass this check.
 */
export async function openToolWithAccessCheck(toolId: WindowId): Promise<BrowserWindow | null> {
  // System windows are never gated
  const isSystemWindow = Object.values(SystemWindowId).includes(toolId as SystemWindowId)
  if (isSystemWindow) {
    return createToolWindow(toolId)
  }

  // Check trial/license status
  const access = await checkAccess()
  if (!access.allowed) {
    console.log(`[PeakFlow] Access denied for ${toolId}: ${access.message}`)
    createToolWindow(SystemWindowId.TrialExpired)
    return null
  }

  return createToolWindow(toolId)
}

/**
 * Close and remove a window by its tool / system ID.
 * No-op if the window doesn't exist.
 */
export function closeToolWindow(toolId: string): void {
  const win = windowMap.get(toolId)
  if (win && !win.isDestroyed()) {
    win.close()
    // The 'closed' handler will remove it from windowMap
  }
}
