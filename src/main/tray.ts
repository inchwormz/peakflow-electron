/**
 * System tray icon and context menu.
 *
 * PeakFlow lives in the system tray — there is no main window.
 * Double-clicking the tray icon opens the Dashboard hub.
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { ToolId, SystemWindowId, TOOL_DISPLAY_NAMES, DEFAULT_HOTKEYS } from '@shared/tool-ids'
import { createToolWindow, openToolWithAccessCheck } from './windows'
import { checkForUpdates } from './services/auto-updater'

let tray: Tray | null = null

/**
 * Load the PeakFlow tray icon from resources.
 */
function getTrayIcon(): Electron.NativeImage {
  const iconPath = join(app.getAppPath(), 'resources', 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.warn('[PeakFlow] Tray icon not found at', iconPath, '— using fallback')
    // Fallback: try the full-size icon and resize it
    const fallbackPath = join(app.getAppPath(), 'resources', 'icon.png')
    const fallback = nativeImage.createFromPath(fallbackPath)
    if (!fallback.isEmpty()) return fallback.resize({ width: 32, height: 32 })
    // Last resort: try from process.resourcesPath (packaged app)
    const pkgPath = join(process.resourcesPath, 'tray-icon.png')
    return nativeImage.createFromPath(pkgPath)
  }
  return icon
}

/**
 * Format a hotkey string for display in the tray menu.
 * e.g. "CommandOrControl+Shift+D" -> "Ctrl+Shift+D"
 */
function formatHotkeyLabel(hotkey: string): string {
  return hotkey.replace('CommandOrControl', 'Ctrl')
}

/**
 * Build the tray context menu with all tool entries.
 */
function buildContextMenu(): Electron.Menu {
  const hotkeyFocusDim = DEFAULT_HOTKEYS[ToolId.FocusDim]
  const hotkeyQuickBoard = DEFAULT_HOTKEYS[ToolId.QuickBoard]

  return Menu.buildFromTemplate([
    {
      label: 'PeakFlow',
      enabled: false
    },
    { type: 'separator' },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.ScreenSlap],
      click: (): void => {
        openToolWithAccessCheck(ToolId.ScreenSlap)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.FocusDim],
      accelerator: hotkeyFocusDim ? formatHotkeyLabel(hotkeyFocusDim) : undefined,
      click: (): void => {
        openToolWithAccessCheck(ToolId.FocusDim)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.QuickBoard],
      accelerator: hotkeyQuickBoard ? formatHotkeyLabel(hotkeyQuickBoard) : undefined,
      click: (): void => {
        openToolWithAccessCheck(ToolId.QuickBoard)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.LiquidFocus],
      click: (): void => {
        openToolWithAccessCheck(ToolId.LiquidFocus)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.MeetReady],
      click: (): void => {
        openToolWithAccessCheck(ToolId.MeetReady)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.SoundSplit],
      click: (): void => {
        openToolWithAccessCheck(ToolId.SoundSplit)
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: (): void => {
        checkForUpdates()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit PeakFlow',
      click: (): void => {
        app.quit()
      }
    }
  ])
}

/**
 * Create the system tray icon and attach the context menu.
 * Must be called after `app.whenReady()`.
 */
export function createTray(): void {
  if (tray) {
    console.warn('[PeakFlow] Tray already exists, skipping creation')
    return
  }

  const icon = getTrayIcon()
  tray = new Tray(icon)

  tray.setToolTip('PeakFlow \u2014 Mac-level productivity for Windows')
  tray.setContextMenu(buildContextMenu())

  // Double-click opens the Dashboard hub
  tray.on('double-click', () => {
    createToolWindow(SystemWindowId.Dashboard)
  })

  console.log('[PeakFlow] System tray created')
}

/**
 * Destroy the tray icon. Called during app shutdown.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
    console.log('[PeakFlow] System tray destroyed')
  }
}
