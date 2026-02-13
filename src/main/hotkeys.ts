/**
 * Global keyboard shortcuts.
 *
 * Hotkeys toggle their associated tool window — pressing the same shortcut
 * again closes the window, matching the Python app behaviour.
 *
 * Registration failures are logged as warnings (not thrown) so the app
 * stays usable even when another process holds the shortcut.
 * (Mirrors Python lesson #13: never crash on hotkey registration failure.)
 */

import { globalShortcut } from 'electron'
import { ToolId, DEFAULT_HOTKEYS } from '@shared/tool-ids'
import { createToolWindow, getToolWindow, closeToolWindow } from './windows'

/**
 * Toggle a tool window: close it if open, create it if not.
 */
function toggleTool(toolId: ToolId): void {
  const existing = getToolWindow(toolId)
  if (existing) {
    closeToolWindow(toolId)
  } else {
    createToolWindow(toolId)
  }
}

/**
 * Register all global hotkeys defined in `DEFAULT_HOTKEYS`.
 * Must be called after `app.whenReady()`.
 */
export function registerHotkeys(): void {
  for (const [toolId, accelerator] of Object.entries(DEFAULT_HOTKEYS)) {
    if (!accelerator) continue

    const registered = globalShortcut.register(accelerator, () => {
      toggleTool(toolId as ToolId)
    })

    if (registered) {
      console.log(`[PeakFlow] Hotkey registered: ${accelerator} -> ${toolId}`)
    } else {
      console.warn(
        `[PeakFlow] Failed to register hotkey ${accelerator} for ${toolId}. ` +
          'Another application may be using this shortcut.'
      )
    }
  }
}

/**
 * Unregister all global shortcuts. Called during app shutdown.
 */
export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
  console.log('[PeakFlow] All hotkeys unregistered')
}
