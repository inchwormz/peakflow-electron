/**
 * Auto-updater service using electron-updater.
 *
 * Checks GitHub Releases for new versions and downloads/installs
 * updates silently. The user is notified via system tray dialog
 * when an update is ready to install.
 *
 * Publish config comes from electron-builder.yml:
 *   provider: github, owner: inchwormz, repo: Peakflow
 */

import { autoUpdater } from 'electron-updater'
import { dialog, BrowserWindow } from 'electron'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Don't download automatically — let us control when */
autoUpdater.autoDownload = false

/** Auto-install on quit so the update applies next launch */
autoUpdater.autoInstallOnAppQuit = true

/** Suppress built-in Electron download progress dialog */
autoUpdater.autoRunAppAfterInstall = true

// ─── State ──────────────────────────────────────────────────────────────────

let updateAvailable = false
let updateDownloaded = false
let checking = false
/** Whether the current check was initiated silently (startup) vs user-triggered */
let silentCheck = false

// ─── Event handlers ─────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for updates...')
  checking = true
})

autoUpdater.on('update-available', (info) => {
  console.log(`[AutoUpdater] Update available: v${info.version}`)
  updateAvailable = true
  checking = false

  // Ask user if they want to download
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `PeakFlow v${info.version} is available.`,
      detail: 'Would you like to download and install it?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate()
      }
    })
})

autoUpdater.on('update-not-available', () => {
  console.log('[AutoUpdater] No updates available')
  const wasSilent = silentCheck
  checking = false
  // Show dialog only for user-initiated (non-silent) checks
  if (!wasSilent) {
    dialog.showMessageBox({
      type: 'info',
      title: 'No Updates',
      message: 'You are running the latest version of PeakFlow.'
    })
  }
})

autoUpdater.on('download-progress', (progress) => {
  const pct = Math.round(progress.percent)
  console.log(`[AutoUpdater] Download: ${pct}%`)

  // Update a visible window's taskbar progress indicator
  const focusedWin = BrowserWindow.getFocusedWindow()
  const targetWin = focusedWin || BrowserWindow.getAllWindows().find((w) => w.isVisible())
  if (targetWin) {
    targetWin.setProgressBar(progress.percent / 100)
  }
})

autoUpdater.on('update-downloaded', () => {
  console.log('[AutoUpdater] Update downloaded — ready to install')
  updateDownloaded = true

  // Clear progress bar on all windows
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.setProgressBar(-1)
    }
  }

  // Prompt user to restart
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'PeakFlow update has been downloaded.',
      detail: 'Restart now to apply the update?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
})

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Error:', err.message)
  checking = false
})

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Manually trigger an update check.
 * Called from the tray "Check for Updates" menu item.
 *
 * If already checking or an update is downloaded, shows appropriate dialog.
 */
export function checkForUpdates(silent = false): void {
  if (updateDownloaded) {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'An update is already downloaded.',
        detail: 'Restart now to apply the update?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
    return
  }

  if (checking) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Checking for Updates',
        message: 'Already checking for updates. Please wait.'
      })
    }
    return
  }

  silentCheck = silent
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      console.error('[AutoUpdater] Check failed:', err.message)
      if (!silent) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Update Check Failed',
          message: 'Could not check for updates.',
          detail: err.message
        })
      }
    })
}

/**
 * Initialize the auto-updater. Runs a silent check on startup.
 * Subsequent checks can be triggered manually from the tray.
 */
export function initAutoUpdater(): void {
  // Check for updates silently 5 seconds after startup
  setTimeout(() => {
    checkForUpdates(true)
  }, 5000)

  console.log('[AutoUpdater] Initialized')
}

/**
 * Get the current update status for display purposes.
 */
export function getUpdateStatus(): {
  updateAvailable: boolean
  updateDownloaded: boolean
  checking: boolean
} {
  return { updateAvailable, updateDownloaded, checking }
}
