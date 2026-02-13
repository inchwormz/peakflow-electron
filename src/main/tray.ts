/**
 * System tray icon and context menu.
 *
 * PeakFlow lives in the system tray — there is no main window.
 * Double-clicking the tray icon opens LiquidFocus (the flagship tool).
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { ToolId, TOOL_DISPLAY_NAMES, DEFAULT_HOTKEYS } from '@shared/tool-ids'
import { createToolWindow } from './windows'

let tray: Tray | null = null

/**
 * Build a 16x16 amber circle as a placeholder tray icon.
 * Uses raw RGBA pixel data to avoid needing an icon file at this stage.
 */
function createPlaceholderIcon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4) // RGBA

  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 1 // 1px margin

  // Amber: #f59e0b
  const R = 0xf5
  const G = 0x9e
  const B = 0x0b
  const A = 0xff

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5
      const dy = y - cy + 0.5
      const offset = (y * size + x) * 4

      if (dx * dx + dy * dy <= r * r) {
        buf[offset] = R
        buf[offset + 1] = G
        buf[offset + 2] = B
        buf[offset + 3] = A
      } else {
        // Transparent
        buf[offset] = 0
        buf[offset + 1] = 0
        buf[offset + 2] = 0
        buf[offset + 3] = 0
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size })
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
        createToolWindow(ToolId.ScreenSlap)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.FocusDim],
      accelerator: hotkeyFocusDim ? formatHotkeyLabel(hotkeyFocusDim) : undefined,
      click: (): void => {
        createToolWindow(ToolId.FocusDim)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.QuickBoard],
      accelerator: hotkeyQuickBoard ? formatHotkeyLabel(hotkeyQuickBoard) : undefined,
      click: (): void => {
        createToolWindow(ToolId.QuickBoard)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.LiquidFocus],
      click: (): void => {
        createToolWindow(ToolId.LiquidFocus)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.MeetReady],
      click: (): void => {
        createToolWindow(ToolId.MeetReady)
      }
    },
    {
      label: TOOL_DISPLAY_NAMES[ToolId.SoundSplit],
      click: (): void => {
        createToolWindow(ToolId.SoundSplit)
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: (): void => {
        // TODO: Implement auto-updater integration
        console.log('[PeakFlow] Update check not yet implemented')
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

  const icon = createPlaceholderIcon()
  tray = new Tray(icon)

  tray.setToolTip('PeakFlow \u2014 Mac-level productivity for Windows')
  tray.setContextMenu(buildContextMenu())

  // Double-click opens LiquidFocus (the "main" tool)
  tray.on('double-click', () => {
    createToolWindow(ToolId.LiquidFocus)
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
