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
import { getToolWindow, closeToolWindow, openToolWithAccessCheck } from './windows'
import { getFocusDimService } from './services/focus-dim'
import { toggleMicMute } from './services/mic-mute'
import { pasteNext, cancelQueue } from './services/clipboard-sequential'
import { isToolInstalled } from './security/trial'
import { getConfig } from './services/config-store'
import type { FocusDimConfig } from '@shared/config-schemas'

/** Registry of all active hotkeys: accelerator → label (for conflict detection) */
const hotkeyRegistry = new Map<string, string>()

/**
 * Toggle a tool window: close it if open, create it if not.
 */
function toggleTool(toolId: ToolId): void {
  const existing = getToolWindow(toolId)
  if (existing) {
    closeToolWindow(toolId)
  } else {
    openToolWithAccessCheck(toolId).catch((err) => {
      console.error(`[PeakFlow] Hotkey failed to open ${toolId}:`, err)
    })
  }
}

/**
 * Register all global hotkeys defined in `DEFAULT_HOTKEYS`.
 * Must be called after `app.whenReady()`.
 *
 * FocusDim has special handling: Ctrl+Shift+D toggles the dim overlay
 * (not the settings window). The settings window is opened from the tray.
 */
/** Convert config format (ctrl+shift+d) to Electron accelerator (CommandOrControl+Shift+D) */
function configToElectronAccelerator(hotkey: string): string {
  return hotkey
    .split('+')
    .map((part) => {
      const lower = part.trim().toLowerCase()
      if (lower === 'ctrl' || lower === 'control') return 'CommandOrControl'
      if (lower === 'cmd' || lower === 'command') return 'CommandOrControl'
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('+')
}

export function registerHotkeys(): void {
  for (const [toolId, accelerator] of Object.entries(DEFAULT_HOTKEYS)) {
    if (!accelerator) continue
    if (!isToolInstalled(toolId)) continue

    // For FocusDim, use the config hotkey instead of default
    if (toolId === ToolId.FocusDim) {
      const conf = getConfig(ToolId.FocusDim) as FocusDimConfig
      registerSingleHotkey(ToolId.FocusDim, configToElectronAccelerator(conf.hotkey))
      continue
    }

    registerSingleHotkey(toolId as ToolId, accelerator)
  }

  // FocusDim feature hotkeys (intensity + peek)
  if (isToolInstalled(ToolId.FocusDim)) {
    registerFocusDimFeatureHotkeys()
  }

  // QuickBoard sequential paste queue hotkeys
  registerQueueHotkeys()
}

/**
 * Register a single tool's hotkey. Called after install from Dashboard
 * so the hotkey works immediately without restarting the app.
 */
export function registerToolHotkey(toolId: ToolId): void {
  let accelerator: string | undefined
  if (toolId === ToolId.FocusDim) {
    const conf = getConfig(ToolId.FocusDim) as FocusDimConfig
    accelerator = configToElectronAccelerator(conf.hotkey)
  } else {
    accelerator = DEFAULT_HOTKEYS[toolId]
  }
  if (!accelerator) return

  // Don't double-register if already active
  if (globalShortcut.isRegistered(accelerator)) return

  registerSingleHotkey(toolId, accelerator)

  // Also register FocusDim feature hotkeys on install
  if (toolId === ToolId.FocusDim) {
    registerFocusDimFeatureHotkeys()
  }
}

/** Internal: register a single accelerator → tool binding. */
function registerSingleHotkey(toolId: string, accelerator: string, callback?: () => void): void {
  const handler = callback ?? (() => {
    if (toolId === ToolId.FocusDim) {
      getFocusDimService().toggle()
    } else if (toolId === ToolId.MeetReady) {
      toggleMicMute()
    } else {
      toggleTool(toolId as ToolId)
    }
  })

  const registered = globalShortcut.register(accelerator, handler)

  if (registered) {
    hotkeyRegistry.set(accelerator, toolId)
    console.log(`[PeakFlow] Hotkey registered: ${accelerator} -> ${toolId}`)
  } else {
    console.warn(
      `[PeakFlow] Failed to register hotkey ${accelerator} for ${toolId}. ` +
        'Another application may be using this shortcut.'
    )
  }
}

/**
 * Register FocusDim feature hotkeys: intensity up/down + peek.
 */
function registerFocusDimFeatureHotkeys(): void {
  const svc = getFocusDimService()

  const featureKeys: Array<{ accel: string; label: string; action: () => void }> = [
    {
      accel: 'Ctrl+Alt+Up',
      label: 'intensity up',
      action: () => {
        const st = svc.getState()
        svc.setOpacity(Math.round(Math.min(1, st.opacity + 0.1) * 100) / 100)
      }
    },
    {
      accel: 'Ctrl+Alt+Down',
      label: 'intensity down',
      action: () => {
        const st = svc.getState()
        svc.setOpacity(Math.round(Math.max(0, st.opacity - 0.1) * 100) / 100)
      }
    },
    {
      accel: 'Ctrl+Alt+`',
      label: 'peek',
      action: () => svc.peek()
    }
  ]

  for (const fk of featureKeys) {
    if (globalShortcut.isRegistered(fk.accel)) continue
    const ok = globalShortcut.register(fk.accel, fk.action)
    if (ok) {
      hotkeyRegistry.set(fk.accel, `focusdim:${fk.label}`)
      console.log(`[PeakFlow] Hotkey registered: ${fk.accel} -> FocusDim ${fk.label}`)
    } else {
      console.warn(`[PeakFlow] Failed to register ${fk.accel}`)
    }
  }
}

/**
 * Register QuickBoard sequential paste queue hotkeys.
 * Always active — pasteNext() is a no-op when queue is empty.
 */
function registerQueueHotkeys(): void {
  if (!isToolInstalled(ToolId.QuickBoard)) return

  const queueKeys: Array<{ accel: string; id: string; action: () => void }> = [
    {
      accel: 'CommandOrControl+Shift+N',
      id: 'quickboard:paste-next',
      action: () => {
        pasteNext()
      }
    },
    {
      accel: 'CommandOrControl+Shift+Q',
      id: 'quickboard:cancel-queue',
      action: () => {
        cancelQueue()
      }
    }
  ]

  for (const qk of queueKeys) {
    if (globalShortcut.isRegistered(qk.accel)) {
      console.warn(`[PeakFlow] Skipping ${qk.accel} — already registered`)
      continue
    }
    registerSingleHotkey(qk.id, qk.accel, qk.action)
  }
}

/**
 * Get all registered hotkeys for conflict detection.
 * Returns array of { accelerator, label } pairs.
 */
export function getRegisteredHotkeys(): Array<{ accelerator: string; label: string }> {
  return Array.from(hotkeyRegistry.entries()).map(([accelerator, label]) => ({
    accelerator,
    label
  }))
}

/**
 * Unregister all global shortcuts. Called during app shutdown.
 */
export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
  hotkeyRegistry.clear()
  console.log('[PeakFlow] All hotkeys unregistered')
}
