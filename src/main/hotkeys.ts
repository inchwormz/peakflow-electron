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
import { ToolId, DEFAULT_HOTKEYS, PANEL_TOOLS, HIDDEN_TOOLS, isPanelTool } from '@shared/tool-ids'
import { hidePanel, visiblePanelTool } from './panel'
import { getToolWindow, closeToolWindow, openToolWithAccessCheck } from './windows'
import { getFocusDimService } from './services/focus-dim'
import { toggleMicMute } from './services/mic-mute'
import { isToolInstalled } from './security/trial'
import { getConfig } from './services/config-store'
import type { FocusDimConfig } from '@shared/config-schemas'
import { SNAP_LAYOUTS, SNAP_UNDO_ACCEL, snapAccel } from '@shared/snapgrid-layouts'
import { builtInAccel, switchAccel } from '@shared/global-keys'
import { getSnapGridService } from './services/snapgrid'
import { HeldKeys } from './held-keys'
import { onPasteRunChanged } from './services/paste-run'
// Static imports: electron-vite bundles main into one file and leaves a relative
// require() unresolved, so it would throw in the built app (Sol review P1)
import { guardedPasteNextAny } from './quickboard-paste'
import { isQueueActive, cancelQueue } from './services/clipboard-sequential'
import { getWorkflowStatus, cancelWorkflow } from './services/clipboard-workflows'
import { getFormFillStatus, cancelFormFill } from './services/clipboard-forms'

/** Registry of all active hotkeys: accelerator → label (for conflict detection) */
const hotkeyRegistry = new Map<string, string>()

/**
 * Toggle a tool window: close it if open, create it if not.
 */
function toggleTool(toolId: ToolId): void {
  // v2: panel tools use the one-app panel. Its shortcut hides the panel only
  // when the panel is already showing that tool; otherwise it switches to it.
  if (isPanelTool(toolId) && visiblePanelTool() === toolId) {
    hidePanel()
    return
  }
  const existing = isPanelTool(toolId) ? undefined : getToolWindow(toolId)
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
    if ((HIDDEN_TOOLS as readonly string[]).includes(toolId)) continue

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

  // QuickBoard paste-next / cancel: held only while a paste run is going
  registerQueueHotkeys()

  // SnapGrid window layouts (⌃⌥ + arrows / letters; arrows only on Windows)
  registerSnapGridHotkeys()

  // v2 switcher: ⌥⌘1–5 open the panel on FocusDim, Liquid Focus, ScreenSlap, QuickBoard, SnapGrid
  // (Mac only: on Windows Alt+Ctrl+digit is AltGr+digit, which types @ # [ ] on many keyboards)
  registerSwitcherHotkeys()
}

function registerSwitcherHotkeys(): void {
  PANEL_TOOLS.forEach((toolId, i) => {
    const accel = switchAccel(i, process.platform)
    if (!accel || globalShortcut.isRegistered(accel)) return
    // Same rule as the tool shortcuts: hide if this tool is already showing, else switch to it
    registerSingleHotkey(`switch:${toolId}`, accel, () => toggleTool(toolId))
  })
}

/**
 * Register a single tool's hotkey. Called after install from Dashboard
 * so the hotkey works immediately without restarting the app.
 */
export function registerToolHotkey(toolId: ToolId): void {
  if ((HIDDEN_TOOLS as readonly string[]).includes(toolId)) return
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

/**
 * SnapGrid layout keys. Registered after FocusDim's, so if a key is already
 * taken (FocusDim, or another app) SnapGrid skips it rather than stealing it.
 */
function registerSnapGridHotkeys(): void {
  if (!isToolInstalled(ToolId.SnapGrid)) return
  const svc = getSnapGridService()
  for (const layout of SNAP_LAYOUTS) {
    const accel = snapAccel(layout, process.platform)
    if (!accel || globalShortcut.isRegistered(accel)) continue
    registerSingleHotkey(`snapgrid:${layout.key}`, accel, () => void svc.applyLayout(layout.key))
  }
  if (!globalShortcut.isRegistered(SNAP_UNDO_ACCEL)) {
    registerSingleHotkey('snapgrid:undo', SNAP_UNDO_ACCEL, () => void svc.undo())
  }
}

/** Internal: register a single accelerator → tool binding. */
function registerSingleHotkey(toolId: string, accelerator: string, callback?: () => void): void {
  const handler = callback ?? (() => {
    if (toolId === ToolId.FocusDim) {
      void getFocusDimService().requestToggle()
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
    // Peek (Ctrl+Alt+`) is AltGr+` on Windows: no shortcut there
    if (!builtInAccel(fk.accel, process.platform)) continue
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
 * QuickBoard paste queue keys: ⇧⌘N pastes the next item, ⇧⌘Q cancels.
 * They're common Mac and Windows shortcuts (Chrome's incognito window,
 * Finder's new folder, Log Out), so PeakFlow takes them only while a paste
 * queue, workflow or form fill is running (review S7).
 */
export const QUEUE_KEYS = { next: 'CommandOrControl+Shift+N', cancel: 'CommandOrControl+Shift+Q' } as const

let queueKeys: HeldKeys | null = null
let offPasteRun: (() => void) | null = null

function pasteRunActive(): boolean {
  return isQueueActive() || getWorkflowStatus().active || getFormFillStatus().active
}

function syncQueueHotkeys(): void {
  if (!queueKeys) return
  const want = isToolInstalled(ToolId.QuickBoard) && pasteRunActive()
  const before = queueKeys.isHeld(QUEUE_KEYS.next) || queueKeys.isHeld(QUEUE_KEYS.cancel)
  const held = queueKeys.sync(want)
  for (const a of [QUEUE_KEYS.next, QUEUE_KEYS.cancel]) {
    if (held.includes(a)) hotkeyRegistry.set(a, a === QUEUE_KEYS.next ? 'quickboard:paste-next' : 'quickboard:cancel-queue')
    else if (hotkeyRegistry.get(a)?.startsWith('quickboard:')) hotkeyRegistry.delete(a)
  }
  if (want !== before) console.log(`[PeakFlow] Paste queue keys ${want ? `held (${held.join(', ') || 'none free'})` : 'released'}`)
}

function registerQueueHotkeys(): void {
  if (queueKeys) return
  queueKeys = new HeldKeys(
    {
      register: (a, fn) => globalShortcut.register(a, fn),
      unregister: (a) => globalShortcut.unregister(a),
      isRegistered: (a) => globalShortcut.isRegistered(a)
    },
    [
      {
        accel: QUEUE_KEYS.next,
        action: () => {
          // Same access check as the panel's paste buttons
          void guardedPasteNextAny()
        }
      },
      {
        accel: QUEUE_KEYS.cancel,
        action: () => {
          if (getWorkflowStatus().active) {
            cancelWorkflow()
            return
          }
          if (getFormFillStatus().active) {
            cancelFormFill()
            return
          }
          cancelQueue()
        }
      }
    ]
  )
  // A run can end inside the key's own handler: release on the next tick
  offPasteRun = onPasteRunChanged(() => setImmediate(syncQueueHotkeys))
  syncQueueHotkeys()
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
  offPasteRun?.()
  offPasteRun = null
  queueKeys = null
  globalShortcut.unregisterAll()
  hotkeyRegistry.clear()
  console.log('[PeakFlow] All hotkeys unregistered')
}
