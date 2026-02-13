/**
 * IPC handler registration — all renderer -> main invoke channels.
 *
 * Phase 1: stub implementations that return placeholder data.
 * Each handler will be replaced with real logic as individual tools
 * are ported from Python to Electron.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { AccessStatus, LicenseActivationResult, WindowInfo } from '@shared/ipc-types'
import type { ConfigGetPayload, ConfigSetPayload } from '@shared/ipc-types'
import { DEFAULT_CONFIGS } from '@shared/config-schemas'
import type { ToolConfig } from '@shared/config-schemas'
import { ToolId } from '@shared/tool-ids'

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
  // ─── Security / Licensing (stubs) ───────────────────────────────────────────

  ipcMain.handle(IPC_INVOKE.SECURITY_CHECK_ACCESS, (): AccessStatus => {
    return {
      allowed: true,
      message: '14 days left in trial',
      daysRemaining: 14,
      isLicensed: false
    }
  })

  ipcMain.handle(
    IPC_INVOKE.SECURITY_ACTIVATE_LICENSE,
    (_event, _key: string): LicenseActivationResult => {
      console.log('[PeakFlow] License activation attempted (not implemented)')
      return {
        success: false,
        message: 'Not implemented yet'
      }
    }
  )

  // ─── Config ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CONFIG_GET,
    (_event, payload: ConfigGetPayload): ToolConfig | null => {
      const toolId = payload.tool as ToolId
      const defaults = DEFAULT_CONFIGS[toolId]
      if (!defaults) {
        console.warn(`[PeakFlow] config:get — unknown tool: ${toolId}`)
        return null
      }
      // Phase 1: return defaults. Phase 2 will read from electron-store.
      return { ...defaults }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CONFIG_SET,
    (_event, payload: ConfigSetPayload): boolean => {
      console.log(`[PeakFlow] config:set — ${payload.tool}.${payload.key} = ${JSON.stringify(payload.value)}`)
      // Phase 1: log only. Phase 2 will persist via electron-store.
      return true
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

  console.log('[PeakFlow] IPC handlers registered')
}
