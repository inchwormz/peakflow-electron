/**
 * PeakFlow Core Shell — Electron main process entry point.
 *
 * PeakFlow is a tray-resident app. No visible window is created on startup.
 * Users interact through:
 *   - System tray icon + context menu
 *   - Global keyboard shortcuts
 *   - Individual tool windows spawned on demand
 */

import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createTray, destroyTray } from './tray'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { registerIpcHandlers } from './ipc-handlers'

// ─── Single Instance Lock ──────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  // Another instance is already running — hand off and exit
  console.log('[PeakFlow] Another instance is running. Quitting.')
  app.quit()
} else {
  // When a second instance tries to launch, focus an existing window (if any)
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0) {
      const win = windows[0]
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // ─── App Ready ───────────────────────────────────────────────────────────────

  app.whenReady().then(() => {
    // Set app user model id for Windows (used for taskbar grouping & notifications)
    electronApp.setAppUserModelId('com.peakflow.app')

    // Optimize window creation in dev — attach devtools on F12, etc.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize core systems
    createTray()
    registerHotkeys()
    registerIpcHandlers()

    console.log('[PeakFlow] Core started — running in system tray')
  })

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  // Tray app: do NOT quit when all windows are closed
  app.on('window-all-closed', () => {
    // Intentionally empty — PeakFlow stays alive in the tray
  })

  // Cleanup before quitting
  app.on('before-quit', () => {
    console.log('[PeakFlow] Shutting down...')
    unregisterHotkeys()
    destroyTray()
  })
}
