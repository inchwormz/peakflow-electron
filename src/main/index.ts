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
import { initFocusDim, destroyFocusDim } from './services/focus-dim'
import { initClipboard, destroyClipboard } from './services/clipboard'
import { initCalendar, destroyCalendar } from './services/google-calendar'
import { initScreenSlap, destroyScreenSlap } from './services/screenslap'
import { initLiquidFocus, destroyLiquidFocus } from './services/liquidfocus'
import { initSoundSplit, destroySoundSplit } from './sidecar/soundsplit-bridge'
import { initTodoist, destroyTodoist } from './services/todoist'
import { initAutoUpdater } from './services/auto-updater'

// ─── Crash Prevention ───────────────────────────────────────────────────────

// Prevent EPIPE errors on console.log from crashing the app
// (happens when the parent shell/pipe that launched electron is closed)
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return // harmless
  // For real errors, log to stderr (less likely to EPIPE) and continue
  process.stderr.write(`[PeakFlow] Uncaught exception: ${err.message}\n${err.stack}\n`)
})

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
    initFocusDim()
    initClipboard()
    initCalendar()
    initScreenSlap()
    initLiquidFocus()
    initSoundSplit()
    initTodoist()
    initAutoUpdater()

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
    destroyTodoist()
    destroySoundSplit()
    destroyLiquidFocus()
    destroyScreenSlap()
    destroyCalendar()
    destroyClipboard()
    destroyFocusDim()
    unregisterHotkeys()
    destroyTray()
  })
}
