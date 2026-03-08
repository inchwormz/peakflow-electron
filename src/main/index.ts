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
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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
import { initExtensionServer, destroyExtensionServer } from './services/extension-server'
import { initAutoUpdater } from './services/auto-updater'
import { initLogger, flushLogger, crashWrite } from './services/logger'
import { initWatchdog, destroyWatchdog, getCrashMarkerPath } from './services/watchdog'
import { migrateExistingInstalls, isToolInstalled, installTool } from './security/trial'
import { setAppQuitting, createToolWindow } from './windows'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import { existsSync, readFileSync, unlinkSync } from 'fs'

// ─── Crash Prevention ───────────────────────────────────────────────────────

// Prevent EPIPE errors on console.log from crashing the app
// (happens when the parent shell/pipe that launched electron is closed)
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return // harmless
  // Sync write to log file — guaranteed on disk even if process dies next
  crashWrite('FATAL', `Uncaught exception: ${err.message}\n${err.stack}`)
  process.stderr.write(`[PeakFlow] Uncaught exception: ${err.message}\n${err.stack}\n`)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason)
  crashWrite('FATAL', `Unhandled rejection: ${msg}`)
  process.stderr.write(`[PeakFlow] Unhandled rejection: ${msg}\n`)
})

// ─── Crash Recovery ─────────────────────────────────────────────────────────

/**
 * If the previous session wrote a crash marker (watchdog kill or renderer freeze),
 * show a recovery dialog offering to send a crash report.
 */
function checkCrashMarker(): void {
  const markerPath = getCrashMarkerPath()
  if (!existsSync(markerPath)) return

  let marker: { timestamp?: string; reason?: string; elapsed?: number } = {}
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
    unlinkSync(markerPath) // consume the marker so it doesn't trigger again
  } catch {
    // Corrupt marker — just delete it
    try { unlinkSync(markerPath) } catch { /* ignore */ }
    return
  }

  const frozenFor = marker.elapsed ? `${Math.round(marker.elapsed / 1000)}s` : 'unknown'
  const when = marker.timestamp ?? 'unknown time'

  // Delay so the app finishes initializing before showing a modal
  setTimeout(async () => {
    const { dialog: d } = require('electron')
    const result = await d.showMessageBox({
      type: 'error',
      title: 'PeakFlow Crashed',
      message: 'PeakFlow stopped responding and had to restart.',
      detail: `Frozen for ${frozenFor} at ${when}.\n\nSending a crash report helps us fix this.`,
      buttons: ['Send Crash Report', 'Dismiss'],
      defaultId: 0,
      noLink: true
    })

    if (result.response === 0) {
      const { sendViaEmail } = require('./services/bug-report')
      sendViaEmail()
    }
  }, 2000)
}

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

  app.whenReady().then(async () => {
    // Initialize persistent logger FIRST so all subsequent console.* calls are captured
    await initLogger()

    // Start watchdog heartbeat monitor (detects main process freezes)
    initWatchdog()

    // If the previous session crashed, show a recovery dialog after a short delay
    checkCrashMarker()

    // Set app user model id for Windows (used for taskbar grouping & notifications)
    electronApp.setAppUserModelId('pro.getpeakflow.core')

    // Log auto-start state (packaged builds only)
    if (!is.dev) {
      const loginSettings = app.getLoginItemSettings()
      console.log(`[PeakFlow] Launch at login: ${loginSettings.openAtLogin ? 'enabled' : 'disabled'}`)
    }

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
    // Also log renderer crashes so they survive in the log file
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
      window.webContents.on('render-process-gone', (_event, details) => {
        crashWrite('FATAL', `Renderer crashed: ${window.getTitle()} — reason=${details.reason}, exitCode=${details.exitCode}`)
      })
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
    // Dev mode needs 'unsafe-inline' + 'unsafe-eval' for Vite HMR + React preamble
    const scriptSrc = is.dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'"
    const styleSrc = "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    const fontSrc = "font-src 'self' https://fonts.gstatic.com"
    const csp = `default-src 'self'; ${scriptSrc}; ${styleSrc}; ${fontSrc}; img-src 'self' data: qboard: file:; media-src 'self' mediastream:; connect-src 'self' https: ws:;`

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })

    // Migrate existing users: auto-install all tools for users upgrading from pre-storefront
    migrateExistingInstalls()

    // Ensure PeakFlow suite trial is stamped for fresh installs (and v1.3.0 users
    // who ran the broken migration that skipped the PeakFlow key)
    if (!isToolInstalled('PeakFlow')) {
      installTool('PeakFlow')
    }

    // Initialize core systems
    createTray()
    registerHotkeys()
    registerIpcHandlers()

    // Only start services for tools the user has installed via the Dashboard
    if (isToolInstalled(ToolId.FocusDim))    initFocusDim()
    if (isToolInstalled(ToolId.QuickBoard))  initClipboard()
    if (isToolInstalled(ToolId.ScreenSlap) || isToolInstalled(ToolId.MeetReady)) initCalendar()
    if (isToolInstalled(ToolId.ScreenSlap))  initScreenSlap()
    if (isToolInstalled(ToolId.LiquidFocus)) initLiquidFocus()
    if (isToolInstalled(ToolId.SoundSplit))  initSoundSplit()

    // Lightweight / system-level — always safe to init
    initTodoist()
    initExtensionServer()
    initAutoUpdater()

    // Open Dashboard on startup so new users aren't left hunting the tray icon
    createToolWindow(SystemWindowId.Dashboard)

    console.log('[PeakFlow] Core started — running in system tray')
  })

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  // Tray app: do NOT quit when all windows are closed
  app.on('window-all-closed', () => {
    // Intentionally empty — PeakFlow stays alive in the tray
  })

  // Cleanup before quitting
  app.on('before-quit', () => {
    destroyWatchdog() // FIRST — stop watchdog before teardown to prevent false positives
    setAppQuitting(true)
    console.log('[PeakFlow] Shutting down...')
    destroyExtensionServer()
    destroyTodoist()
    destroySoundSplit()
    destroyLiquidFocus()
    destroyScreenSlap()
    destroyCalendar()
    destroyClipboard()
    destroyFocusDim()
    unregisterHotkeys()
    destroyTray()
    flushLogger()
  })
}
