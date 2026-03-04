/**
 * System tray icon and context menu.
 *
 * PeakFlow lives in the system tray — there is no main window.
 * Double-clicking the tray icon opens the Dashboard hub.
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ToolId, SystemWindowId, TOOL_DISPLAY_NAMES, DEFAULT_HOTKEYS } from '@shared/tool-ids'
import { createToolWindow, openToolWithAccessCheck } from './windows'
import { checkForUpdates } from './services/auto-updater'
import { isToolInstalled } from './security/trial'
import { sendViaEmail, revealLogFile } from './services/bug-report'
import { getFocusDimService } from './services/focus-dim'
import { getConfig } from './services/config-store'
import type { FocusDimConfig } from '@shared/config-schemas'

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
 * Ordered list of tools for tray menu (display order).
 */
const TRAY_TOOL_ORDER: ToolId[] = [
  ToolId.ScreenSlap,
  ToolId.FocusDim,
  ToolId.QuickBoard,
  ToolId.LiquidFocus,
  ToolId.MeetReady,
  ToolId.SoundSplit
]

/**
 * Build the tray context menu — only shows installed tools.
 */
function buildContextMenu(): Electron.Menu {
  const toolItems: Electron.MenuItemConstructorOptions[] = []

  for (const id of TRAY_TOOL_ORDER) {
    if (!isToolInstalled(id)) continue

    if (id === ToolId.FocusDim) {
      // FocusDim gets a submenu with toggle + intensity presets + settings
      const svc = getFocusDimService()
      const fdState = svc.getState()
      const conf = getConfig(ToolId.FocusDim) as FocusDimConfig
      const hotkeyLabel = formatHotkeyLabel(
        conf.hotkey.split('+').map(p => {
          const l = p.trim().toLowerCase()
          if (l === 'ctrl' || l === 'control') return 'Ctrl'
          return l.charAt(0).toUpperCase() + l.slice(1)
        }).join('+')
      )

      const intensityPresets = [
        { label: 'Light (30%)', value: 0.3 },
        { label: 'Medium (50%)', value: 0.5 },
        { label: 'Heavy (70%)', value: 0.7 },
        { label: 'Max (85%)', value: 0.85 }
      ]

      toolItems.push({
        label: 'FocusDim',
        submenu: [
          {
            label: fdState.enabled ? 'Disable' : 'Enable',
            accelerator: hotkeyLabel,
            click: (): void => { svc.toggle() }
          },
          { type: 'separator' },
          ...intensityPresets.map((p) => ({
            label: p.label,
            type: 'radio' as const,
            checked: Math.abs(p.value - fdState.opacity) < 0.02,
            click: (): void => { svc.setOpacity(p.value) }
          })),
          { type: 'separator' as const },
          {
            label: 'Settings...',
            click: (): void => { openToolWithAccessCheck(ToolId.FocusDim) }
          }
        ]
      })
      continue
    }

    const hotkey = DEFAULT_HOTKEYS[id]
    toolItems.push({
      label: TOOL_DISPLAY_NAMES[id],
      accelerator: hotkey ? formatHotkeyLabel(hotkey) : undefined,
      click: (): void => {
        openToolWithAccessCheck(id)
      }
    })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'PeakFlow', enabled: false },
    { type: 'separator' }
  ]

  if (toolItems.length > 0) {
    template.push(...toolItems)
    template.push({ type: 'separator' })
  }

  template.push(
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: !is.dev && app.getLoginItemSettings().openAtLogin,
      enabled: !is.dev,
      click: (menuItem): void => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked })
      }
    },
    {
      label: 'Check for Updates',
      click: (): void => {
        checkForUpdates()
      }
    },
    {
      label: 'Report a Bug',
      submenu: [
        { label: 'Send via Email', click: (): void => { sendViaEmail() } },
        { label: 'Open Log File', click: (): void => { revealLogFile() } }
      ]
    },
    { type: 'separator' },
    {
      label: 'Quit PeakFlow',
      click: (): void => {
        app.quit()
      }
    }
  )

  return Menu.buildFromTemplate(template)
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
 * Rebuild the tray context menu (e.g. after a tool is installed).
 */
export function rebuildTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildContextMenu())
    console.log('[PeakFlow] Tray menu rebuilt')
  }
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
