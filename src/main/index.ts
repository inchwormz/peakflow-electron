/**
 * PeakFlow Core Shell — Electron main process entry point.
 *
 * PeakFlow is a tray-resident app. No visible window is created on startup.
 * Users interact through:
 *   - System tray icon + context menu
 *   - Global keyboard shortcuts
 *   - Individual tool windows spawned on demand
 */

import { app, BrowserWindow, protocol, net, session } from 'electron'
import { join, sep, normalize } from 'path'
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
import { setAppQuitting } from './windows'

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
    electronApp.setAppUserModelId('pro.getpeakflow.core')

    // Handle hardware permissions securely (Webcam/Mic for MeetReady and LiquidFocus)
    // Prevents renderer crashes/hangs when waking from sleep or hot-swapping devices in prod
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const safePermissions = ['media', 'mediaKeySystem']
      if (safePermissions.includes(permission)) {
        console.log(`[PeakFlow] Auto-granted hardware permission: ${permission}`)
        callback(true)
      } else {
        console.warn(`[PeakFlow] Denied unhandled permission: ${permission}`)
        callback(false)
      }
    })

    // Optimize window creation in dev — attach devtools on F12, etc.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Custom protocol for serving QuickBoard images without IPC overhead
    protocol.handle('qboard', (request) => {
      const filename = decodeURIComponent(request.url.replace(/^qboard:\/\//, ''))
      const imagesDir = join(app.getPath('userData'), 'quickboard-images')
      const imagePath = normalize(join(imagesDir, filename))
      // Prevent path traversal — resolved path must stay inside imagesDir
      if (!imagePath.startsWith(imagesDir + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch('file://' + imagePath)
    })

    // Content Security Policy — restrict renderer capabilities
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: qboard: file:; media-src 'self' mediastream:; connect-src 'self' https:;"
          ]
        }
      })
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
    setAppQuitting(true)
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
