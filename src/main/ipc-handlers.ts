/**
 * IPC handler registration — all renderer -> main invoke channels.
 *
 * Phase 2: security/licensing handlers wired to real security module.
 * Config handlers use persistent electron-store.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { AccessStatus, LicenseActivationResult, WindowInfo } from '@shared/ipc-types'
import type { ConfigGetPayload, ConfigSetPayload } from '@shared/ipc-types'
import type { ToolConfig } from '@shared/config-schemas'
import { ToolId } from '@shared/tool-ids'
import { checkAccess } from './security/access-check'
import { activateLicense } from './security/license'
import { getTrialDaysRemaining, TRIAL_DAYS } from './security/trial'
import { getConfig, setConfig } from './services/config-store'
import { getFocusDimService } from './services/focus-dim'
import type { FocusDimState } from './services/focus-dim'
import { getClipboardService } from './services/clipboard'
import type { ClipboardItem } from './services/clipboard'

/**
 * Extract the toolId query parameter from a BrowserWindow's loaded URL.
 * Returns an empty string if parsing fails.
 */
function getToolIdFromSender(event: Electron.IpcMainInvokeEvent): string {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return ''
    const url = win.webContents.getURL()
    const parsed = new URL(url)
    return parsed.searchParams.get('toolId') ?? ''
  } catch {
    return ''
  }
}

/**
 * Register all IPC invoke handlers.
 * Must be called once during app startup, before any windows are created.
 */
export function registerIpcHandlers(): void {
  // ─── Security / Licensing ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.SECURITY_CHECK_ACCESS,
    async (): Promise<AccessStatus> => {
      return checkAccess()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_ACTIVATE_LICENSE,
    async (_event, key: string): Promise<LicenseActivationResult> => {
      return activateLicense(key)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_GET_TRIAL_STATUS,
    (): { daysRemaining: number; trialDays: number } => {
      return {
        daysRemaining: getTrialDaysRemaining(),
        trialDays: TRIAL_DAYS
      }
    }
  )

  // ─── Config ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CONFIG_GET,
    (_event, payload: ConfigGetPayload): ToolConfig | null => {
      try {
        return getConfig(payload.tool as ToolId)
      } catch (error) {
        console.warn('[PeakFlow] config:get failed:', error)
        return null
      }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CONFIG_SET,
    (_event, payload: ConfigSetPayload): boolean => {
      try {
        setConfig(payload.tool as ToolId, payload.key, payload.value)
        return true
      } catch (error) {
        console.warn('[PeakFlow] config:set failed:', error)
        return false
      }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CONFIG_GET_ALL,
    (_event, payload: ConfigGetPayload): ToolConfig | null => {
      try {
        return getConfig(payload.tool as ToolId)
      } catch (error) {
        console.warn('[PeakFlow] config:get-all failed:', error)
        return null
      }
    }
  )

  // ─── Window Management ──────────────────────────────────────────────────────

  ipcMain.handle(IPC_INVOKE.WINDOW_MINIMIZE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_CLOSE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_TOGGLE_MAXIMIZE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_GET_INFO, (event): WindowInfo => {
    const toolId = getToolIdFromSender(event)
    return { toolId }
  })

  // ─── FocusDim ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_TOGGLE,
    (): FocusDimState => {
      return getFocusDimService().toggle()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_OPACITY,
    (_event, opacity: number): void => {
      getFocusDimService().setOpacity(opacity)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_COLOR,
    (_event, colorKey: string): void => {
      getFocusDimService().setColor(colorKey)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_BORDER,
    (_event, show: boolean): void => {
      getFocusDimService().setBorder(show)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_GET_STATE,
    (): FocusDimState => {
      return getFocusDimService().getState()
    }
  )

  // ─── QuickBoard / Clipboard ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().getHistory()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_WRITE_TEXT,
    (_event, text: string): void => {
      getClipboardService().writeText(text)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE,
    (_event, itemId: string): void => {
      getClipboardService().simulatePaste(itemId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_DELETE_ITEM,
    (_event, itemId: string): ClipboardItem[] => {
      return getClipboardService().deleteItem(itemId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_PIN_ITEM,
    (_event, itemId: string): ClipboardItem[] => {
      return getClipboardService().pinItem(itemId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_CLEAR_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().clearHistory()
    }
  )

  console.log('[PeakFlow] IPC handlers registered')
}
