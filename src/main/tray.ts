/**
 * System tray icon and context menu.
 *
 * PeakFlow lives in the system tray — there is no main window.
 * v2: clicking the tray icon toggles the one-app panel; right-clicking shows
 * this native menu.
 */

import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ToolId, TOOL_DISPLAY_NAMES, PANEL_TOOLS } from '@shared/tool-ids'
import { openToolWithAccessCheck } from './windows'
import { setPanelAnchor, showPanel, togglePanel } from './panel'
import { checkForUpdates } from './services/auto-updater'
import { isToolInstalled } from './security/trial'
import { sendViaEmail, revealLogFile } from './services/bug-report'
import { getFocusDimService } from './services/focus-dim'
import { getConfig } from './services/config-store'
import type { FocusDimConfig } from '@shared/config-schemas'
import { isToolSupportedOn } from '@shared/platform-tools'
import { switchAccel } from '@shared/global-keys'
import { openLauncher, openLauncherSettings, launcherHotkey } from './launcher'

let tray: Tray | null = null

/**
 * Load the PeakFlow tray icon from resources.
 */
function getTrayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // macOS menu bar: monochrome template image (+ @2x picked up automatically)
    // so the system tints it for light/dark menu bars.
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const template = nativeImage.createFromPath(join(base, 'trayTemplate.png'))
    if (!template.isEmpty()) {
      template.setTemplateImage(true)
      return template
    }
    console.warn('[PeakFlow] Template tray icon not found in', base, '— using colour icon')
  }

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
  // macOS menus render CommandOrControl as the Cmd symbol themselves
  if (process.platform === 'darwin') return hotkey
  return hotkey.replace('CommandOrControl', 'Ctrl')
}

/**
 * Ordered list of tools for tray menu (display order): the four v2 tools.
 * MeetReady and SoundSplit are hidden for now (John, 19 Oct 2026).
 */
const TRAY_TOOL_ORDER: readonly ToolId[] = PANEL_TOOLS

/** ⌥⌘1–5 open the panel on a tool (shown next to each tool in this menu; none on Windows). */
function switchAcceleratorFor(id: ToolId): string | undefined {
  const i = PANEL_TOOLS.indexOf(id)
  return i < 0 ? undefined : switchAccel(i, process.platform) ?? undefined
}

/**
 * Build the tray context menu — only shows installed tools.
 */
export function buildContextMenu(): Electron.Menu {
  const toolItems: Electron.MenuItemConstructorOptions[] = []

  for (const id of TRAY_TOOL_ORDER) {
    if (!isToolInstalled(id)) continue
    if (!isToolSupportedOn(id, process.platform)) continue

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
            // Same access check as the panel and the shortcut: a locked FocusDim can't be turned on here
            click: (): void => { void svc.requestToggle() }
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
            label: 'Settings…',
            click: (): void => { showPanel('focusdim/settings') }
          }
        ]
      })
      continue
    }

    const hotkey = switchAcceleratorFor(id)
    toolItems.push({
      label: TOOL_DISPLAY_NAMES[id],
      accelerator: hotkey ? formatHotkeyLabel(hotkey) : undefined,
      registerAccelerator: false,
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

  // The launcher, and its settings: otherwise only reachable through the
  // launcher's own shortcut, which another app (Raycast, Alfred) may hold
  const launcherKey = launcherHotkey()
  template.push(
    {
      label: 'Open Launcher',
      accelerator: launcherKey ? formatHotkeyLabel(launcherKey) : undefined,
      registerAccelerator: false,
      click: (): void => openLauncher()
    },
    { label: 'Launcher Settings…', click: (): void => openLauncherSettings() },
    { type: 'separator' }
  )

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

  tray.setToolTip(process.platform === 'darwin' ? 'PeakFlow' : 'PeakFlow \u2014 Mac-level productivity for Windows')
  tray.setIgnoreDoubleClickEvents(true)
  setPanelAnchor(() => (tray && !tray.isDestroyed() ? tray.getBounds() : null))

  // Click: the one-app panel. Right-click: the native menu.
  tray.on('click', () => togglePanel())
  tray.on('right-click', () => {
    if (tray && !tray.isDestroyed()) tray.popUpContextMenu(buildContextMenu())
  })

  console.log('[PeakFlow] System tray created')
}

/**
 * Rebuild the tray context menu (e.g. after a tool is installed).
 */
export function rebuildTray(): void {
  // The menu is built fresh on every right-click, so there is nothing to cache.
  if (tray && !tray.isDestroyed()) console.log('[PeakFlow] Tray menu will rebuild on next open')
}

/** Text next to the menu-bar icon (macOS), e.g. the Liquid Focus countdown. */
export function setTrayTitle(text: string): void {
  if (!tray || tray.isDestroyed() || process.platform !== 'darwin') return
  tray.setTitle(text, { fontType: 'monospacedDigit' })
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
