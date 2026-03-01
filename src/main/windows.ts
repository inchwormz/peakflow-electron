/**
 * Window factory — creates and manages BrowserWindows for each tool.
 *
 * All tool windows are frameless with a dark background (#08080a).
 * The renderer is responsible for drawing its own title bar via the
 * `-webkit-app-region: drag` CSS property.
 */

import { app, BrowserWindow, nativeImage, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import { checkAccess } from './security/access-check'
import { getConfig } from './services/config-store'

/** Cached app icon shared across all windows */
let _appIcon: Electron.NativeImage | undefined
function getAppIcon(): Electron.NativeImage {
  if (_appIcon) return _appIcon
  // Try resources/icon.png first (dev), then process.resourcesPath (packaged)
  const devPath = join(app.getAppPath(), 'resources', 'icon.png')
  _appIcon = nativeImage.createFromPath(devPath)
  if (_appIcon.isEmpty()) {
    const pkgPath = join(process.resourcesPath, 'icon.png')
    _appIcon = nativeImage.createFromPath(pkgPath)
  }
  return _appIcon
}

/** When true, the app is quitting and all windows should close for real */
let appQuitting = false
export function setAppQuitting(v: boolean): void {
  appQuitting = v
}

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
export function createToolWindow(toolId: WindowId, extraQuery?: Record<string, string>): BrowserWindow {
  // Re-use existing window if one is open for this tool
  const existing = windowMap.get(toolId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    const cfg = WINDOW_CONFIGS[toolId]
    if (!existing.isVisible()) {
      // Defer alwaysOnTop until after the OS finishes restoring the window
      if (cfg?.alwaysOnTop) {
        const needsScreenSaver = toolId === ToolId.LiquidFocus || toolId === SystemWindowId.ScreenSlapAlert
        const level = needsScreenSaver ? 'screen-saver' as const : 'normal' as const
        existing.once('show', () => {
          existing.setAlwaysOnTop(true, level)
          existing.focus()
        })
      }
      existing.show()
      if (!cfg?.alwaysOnTop) existing.focus()
    } else {
      if (cfg?.alwaysOnTop) {
        const needsScreenSaver = toolId === ToolId.LiquidFocus || toolId === SystemWindowId.ScreenSlapAlert
        const level = needsScreenSaver ? 'screen-saver' as const : 'normal' as const
        existing.setAlwaysOnTop(true, level)
      }
      existing.focus()
    }
    return existing
  }

  const overrides = WINDOW_CONFIGS[toolId] ?? { width: 500, height: 600 }

  // Use display dimensions for fullscreen / overlay windows
  let targetDisplay = screen.getPrimaryDisplay()

  // For ScreenSlap alerts, check the configured monitor index
  if (toolId === SystemWindowId.ScreenSlapAlert) {
    try {
      const ssConfig = getConfig(ToolId.ScreenSlap) as { monitor_index?: number } | null
      if (ssConfig?.monitor_index !== undefined) {
        const displays = screen.getAllDisplays()
        if (ssConfig.monitor_index < displays.length) {
          targetDisplay = displays[ssConfig.monitor_index]
        }
      }
    } catch {
      // Use primary display as fallback
    }
  }

  // Use full bounds (not workAreaSize) so fullscreen windows cover the taskbar
  const { width: screenW, height: screenH } = overrides.fullscreen
    ? targetDisplay.bounds
    : targetDisplay.workAreaSize

  const winWidth = overrides.fullscreen ? screenW : overrides.width
  const winHeight = overrides.fullscreen ? screenH : overrides.height

  // Position fullscreen windows at the target display origin
  const winX = overrides.fullscreen ? targetDisplay.bounds.x : undefined
  const winY = overrides.fullscreen ? targetDisplay.bounds.y : undefined

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: winX,
    y: winY,
    minWidth: overrides.minWidth,
    minHeight: overrides.minHeight,
    resizable: overrides.resizable !== false,
    alwaysOnTop: overrides.alwaysOnTop ?? false,
    skipTaskbar: overrides.skipTaskbar ?? false,
    fullscreen: overrides.fullscreen ?? false,
    transparent: overrides.transparent ?? false,
    focusable: overrides.focusable !== false,
    icon: getAppIcon(),
    frame: false,
    show: false,
    backgroundColor: '#08080a',
    center: winX === undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Show when the renderer has painted its first frame
  win.once('ready-to-show', () => {
    win.show()
    // 'screen-saver' level keeps windows above fullscreen apps (Chrome, etc.).
    // Re-assert on blur/show/restore because Windows can silently drop it.
    if (toolId === ToolId.LiquidFocus || toolId === SystemWindowId.ScreenSlapAlert) {
      const pinAbove = (): void => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver')
      }
      pinAbove()
      win.on('blur', pinAbove)
      win.on('show', pinAbove)
      win.on('restore', pinAbove)
    }
  })

  // Dashboard: hide to tray instead of closing (app stays resident)
  if (toolId === SystemWindowId.Dashboard) {
    win.on('close', (e) => {
      if (appQuitting) return
      e.preventDefault()
      win.hide()
    })
  }

  // LiquidFocus: hide instead of close when timer is running so the
  // renderer (FocusDetector webcam + phase sounds) stays alive
  if (toolId === ToolId.LiquidFocus) {
    win.on('close', (e) => {
      if (appQuitting) return // let it close during app quit
      try {
        // Lazy import to avoid circular dependency at module load time
        const { getLiquidFocusService } = require('./services/liquidfocus')
        const state = getLiquidFocusService().getTimerState()
        if (state.status === 'running' || state.status === 'paused') {
          e.preventDefault()
          win.hide()
          return
        }
      } catch {
        // If service isn't available, allow normal close
      }
    })
  }

  // Clean up on close
  win.on('closed', () => {
    windowMap.delete(toolId)
  })

  // Load the renderer
  const query: Record<string, string> = { toolId, ...extraQuery }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query).toString()
    const devUrl = `${process.env['ELECTRON_RENDERER_URL']}?${params}`
    win.loadURL(devUrl).catch((err) => {
      console.error(`[PeakFlow] Failed to load dev URL for ${toolId}:`, err)
    })
  } else {
    const prodPath = join(__dirname, '../renderer/index.html')
    win.loadFile(prodPath, { query }).catch((err) => {
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

  // Check trial/license status (pass toolId for per-tool gating)
  const access = await checkAccess(toolId)
  if (!access.allowed) {
    console.log(`[PeakFlow] Access denied for ${toolId}: ${access.message}`)
    // Tool not installed → Dashboard handles install UX, don't show TrialExpired
    if (access.message === 'tool_not_installed') return null
    // Pass denied tool + reason as query params so TrialExpired UI shows context
    createToolWindow(SystemWindowId.TrialExpired, {
      deniedTool: toolId,
      reason: access.message
    })
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
