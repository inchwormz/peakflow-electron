/**
 * PeakFlow Core Shell — Electron main process entry point.
 *
 * PeakFlow is a tray-resident app. No visible window is created on startup.
 * Users interact through:
 *   - System tray icon + context menu
 *   - Global keyboard shortcuts
 *   - Individual tool windows spawned on demand
 */

import './dev-profile'
import { app, BrowserWindow, protocol, net, session } from 'electron'
import { join, sep, normalize } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createTray, destroyTray } from './tray'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { registerIpcHandlers } from './ipc-handlers'
import { initFocusDim, destroyFocusDim } from './services/focus-dim'
import { initSnapGrid, destroySnapGrid } from './services/snapgrid'
import { initClipboard, destroyClipboard } from './services/clipboard'
import { initCalendar, destroyCalendar } from './services/google-calendar'
import { initScreenSlap, destroyScreenSlap } from './services/screenslap'
import { initLiquidFocus, destroyLiquidFocus } from './services/liquidfocus'
import { destroySoundSplit } from './sidecar/soundsplit-bridge'
import { initTodoist, destroyTodoist } from './services/todoist'
import { initExtensionServer, destroyExtensionServer } from './services/extension-server'
import { initAutoUpdater } from './services/auto-updater'
import { initLogger, flushLogger, crashWrite } from './services/logger'
import { sendViaEmail } from './services/bug-report' // static: a relative require() is unresolved in the bundle
import { initWatchdog, destroyWatchdog, getCrashMarkerPath } from './services/watchdog'
import { migrateExistingInstalls, isToolInstalled, installTool, autoInstallTools, ensureTrialExpiry } from './security/trial'
import { syncLicensedToolInstalls, refreshProductMap } from './security/license'
import { setAppQuitting } from './windows'
import { initPanel, showPanel, setPanelQuitting } from './panel'
import { runDevShots } from './dev-shots'
import { initLauncher, destroyLauncher } from './launcher'
import { setTrayTitle } from './tray'
import { getLiquidFocusService } from './services/liquidfocus'
import { macStartupRoute } from './services/permissions-darwin'
import { destroyActiveWindowHelper } from './native/active-window'
import { ToolId, PANEL_TOOLS, TODOIST_ENABLED, EXTENSION_ENABLED } from '@shared/tool-ids'
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
      void sendViaEmail()
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
  // Launching PeakFlow again opens the panel (the first window in the list could
  // be a dim overlay or the mini timer, which can't take focus usefully)
  app.on('second-instance', () => {
    if (app.isReady()) showPanel()
    else app.whenReady().then(() => showPanel())
  })

  // ─── App Ready ───────────────────────────────────────────────────────────────

  app.whenReady().then(async () => {
    // Initialize persistent logger FIRST so all subsequent console.* calls are captured
    await initLogger()

    // macOS: menu-bar app, no Dock icon (packaged builds also set LSUIElement)
    if (process.platform === 'darwin') {
      app.dock?.hide()
    }

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
        // During quit the window can already be destroyed; getTitle() would throw
        const title = window.isDestroyed() ? '(closed window)' : window.getTitle()
        crashWrite('FATAL', `Renderer crashed: ${title} — reason=${details.reason}, exitCode=${details.exitCode}`)
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
    // Licensed users should not stay on the trial storefront UI
    syncLicensedToolInstalls()
    // Pull the latest product→tool map from the releases repo so new products
    // unlock correctly without an app update (non-blocking; re-syncs on change)
    void refreshProductMap()

    // Ensure PeakFlow suite trial is stamped for fresh installs (and v1.3.0 users
    // who ran the broken migration that skipped the PeakFlow key)
    if (!isToolInstalled('PeakFlow')) {
      installTool('PeakFlow')
    }
    // v2: the 30-day trial starts by itself and covers every tool, so every
    // tool is on from first launch (no "Turn on" / "Start trial" step)
    // (the trial end is fixed first, from the tools' existing records)
    ensureTrialExpiry()
    autoInstallTools(PANEL_TOOLS)

    // Initialize core systems
    createTray()
    registerHotkeys()
    registerIpcHandlers()

    // Only start services for tools the user has installed via the Dashboard
    if (isToolInstalled(ToolId.FocusDim))    initFocusDim()
    if (isToolInstalled(ToolId.SnapGrid))    initSnapGrid()
    if (isToolInstalled(ToolId.QuickBoard))  initClipboard()
    if (isToolInstalled(ToolId.ScreenSlap))  initCalendar()
    if (isToolInstalled(ToolId.ScreenSlap))  initScreenSlap()
    if (isToolInstalled(ToolId.LiquidFocus)) {
      initLiquidFocus()
      // Menu-bar countdown while a focus session runs (macOS)
      getLiquidFocusService().onStateChange((t) => {
        if (t.status === 'idle') return setTrayTitle('')
        const mm = String(Math.floor(t.remaining / 60)).padStart(2, '0')
        const ss = String(t.remaining % 60).padStart(2, '0')
        setTrayTitle(` ${mm}:${ss}`)
      })
    }
    // v2: MeetReady and SoundSplit are hidden for now (John, 19 Oct 2026), so their
    // services (calendar auto-popup, audio sidecar) don't start. Code is kept.

    // Lightweight / system-level — always safe to init
    if (TODOIST_ENABLED) initTodoist()
    if (EXTENSION_ENABLED) initExtensionServer()
    initAutoUpdater()

    // v2: open the one-app panel on startup so new users aren't left hunting
    // the menu-bar icon (replaces the old Dashboard hub window)
    // macOS: the first launch, a permission an update reset, or running from
    // Downloads / the disk image opens the panel on its set-up page instead
    // (inside the panel, so nothing steals focus and closes it; review S13)
    initPanel()
    const startRoute = macStartupRoute() ?? undefined
    setTimeout(() => showPanel(startRoute), 600)
    // Free ⌥Space / Alt+Space launcher (hidden window kept ready)
    initLauncher()
    void runDevShots() // development screenshots only (env-gated, never in packaged builds)

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
    setPanelQuitting(true)
    destroyLauncher()
    console.log('[PeakFlow] Shutting down...')
    if (EXTENSION_ENABLED) destroyExtensionServer()
    if (TODOIST_ENABLED) destroyTodoist()
    destroySoundSplit()
    destroyLiquidFocus()
    destroyScreenSlap()
    destroyCalendar()
    destroyClipboard()
    destroyFocusDim()
    destroySnapGrid()
    destroyActiveWindowHelper() // after FocusDim, so its polling can't restart the helper
    unregisterHotkeys()
    destroyTray()
    flushLogger()
  })
}
