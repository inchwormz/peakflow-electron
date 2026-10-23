/**
 * In-app updates.
 *
 * Windows (v2 onward) uses electron-updater's NSIS updater with the GitHub
 * provider from electron-builder.yml `publish` (inchwormz/peakflow-releases).
 * Each release carries latest.yml + the installer + its .blockmap, so this is
 * the standard electron-builder route: check at startup and every 4 hours,
 * download in the background, then ask once to restart. "Later" installs on
 * the next quit. The installer runs silently and starts PeakFlow again.
 *
 * macOS never uses the Windows path. A Developer ID–signed Mac build updates
 * through electron-updater, which reads only latest-mac.yml (and the matching
 * .zip) from the same GitHub release. Unsigned Mac builds cannot be updated
 * by Squirrel.Mac, so they check GitHub for the newest release that carries a
 * Mac .dmg for this chip, download it from the PeakFlow website into
 * Downloads, open it, and tell the user to drag PeakFlow into Applications.
 * Where the version is read and the file downloaded from stays as it is: the
 * 2.0.2 updater already on customers' Macs works the same way (review B2).
 *
 * Mac update dialog (review S12): download progress and errors show on the
 * panel's Updates page (which opens when the download starts), errors after
 * the customer clicked Download always show, and "Skip This Version" stops
 * the 4-hourly check offering that version again.
 */

import { app, BrowserWindow, dialog, net, shell } from 'electron'
import Store from 'electron-store'
import { createWriteStream } from 'fs'
import { dirname, join } from 'path'
import { readMacSignature } from './mac-signature'
import { isNewer, shouldOffer, percentOf, type UpdateProgress } from '@shared/update-offer'
import { IPC_SEND } from '@shared/ipc-types'
import { FORGOT_ACCESSIBILITY } from '@shared/mac-permissions'
import type { AppUpdater, UpdateInfo } from 'electron-updater'

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'inchwormz'
const GITHUB_REPO = 'peakflow-releases'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=15`
const isMac = process.platform === 'darwin'

/** Unsigned Mac builds download from the website, which redirects to the current .dmg. */
const MAC_DOWNLOAD_URL =
  process.arch === 'arm64'
    ? 'https://getpeakflow.pro/download/PeakFlow-Mac.dmg'
    : 'https://getpeakflow.pro/download/PeakFlow-Mac-Intel.dmg'
const MAC_DMG_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const MAC_HELP_URL = 'https://getpeakflow.pro/download#open-on-mac'

/** How often a running PeakFlow re-checks (it is a tray/menu bar app that runs for days). */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// ─── State ───────────────────────────────────────────────────────────────────

let checking = false
let downloading = false
/** The customer clicked Download in this run (so errors are shown even on an automatic check) */
let userStarted = false

// ─── Helpers ─────────────────────────────────────────────────────────────────

const prefs = isMac ? new Store<{ skippedVersion: string }>({ name: 'updater', defaults: { skippedVersion: '' } }) : null

let progress: UpdateProgress = { state: 'idle' }

/** Tell the panel's Updates page (every window gets it; only the panel listens). */
function setProgress(p: UpdateProgress): void {
  progress = p
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC_SEND.APP_UPDATE_PROGRESS, p)
  }
}

export function getUpdateProgress(): UpdateProgress {
  return progress
}

/** The panel on its Updates page, where the progress shows (loaded lazily: panel.ts imports a lot). */
function showUpdatesPage(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { showPanel } = require('../panel') as typeof import('../panel')
    showPanel('app/updates')
  } catch (err) {
    console.warn('[AutoUpdater] Could not open the Updates page:', err)
  }
}

/** Download / Skip This Version / Later. Returns 'download', 'skip' or 'later'. */
async function offerMacUpdate(latest: string, current: string, detail: string): Promise<'download' | 'skip' | 'later'> {
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: 'Update Available',
    message: `PeakFlow v${latest} is available (you have v${current}).`,
    detail,
    buttons: ['Download', 'Skip This Version', 'Later'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (choice.response === 1) {
    prefs?.set('skippedVersion', latest)
    console.log(`[AutoUpdater] Mac: skipping v${latest}`)
    return 'skip'
  }
  if (choice.response === 0) prefs?.set('skippedVersion', '')
  return choice.response === 0 ? 'download' : 'later'
}

/** What to do after installing an unsigned update: the Keychain prompt and lost permissions. */
const MAC_AFTER_UPDATE =
  'When the new version opens, macOS may ask for your password for “PeakFlow Safe Storage”. Click Always Allow. ' +
  `If a tool then says it needs Accessibility, ${FORGOT_ACCESSIBILITY.charAt(0).toLowerCase()}${FORGOT_ACCESSIBILITY.slice(1)}`

// ─── Windows ────────────────────────────────────────────────────────────────

let winUpdaterInstance: AppUpdater | null = null
/** Version whose "ready to restart" dialog was already shown this session. */
let winPromptedVersion: string | null = null
let winPromptOpen = false

/** Ask once per downloaded version: restart now, or install when PeakFlow quits. */
async function promptWinRestart(updater: AppUpdater, info: UpdateInfo, force: boolean): Promise<void> {
  if (winPromptOpen) return
  if (!force && winPromptedVersion === info.version) return
  winPromptedVersion = info.version
  winPromptOpen = true
  try {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `PeakFlow v${info.version} is ready. Restart to update.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    // Silent installer, then start PeakFlow again. "Later" leaves
    // autoInstallOnAppQuit to install it the next time PeakFlow quits.
    if (result.response === 0) updater.quitAndInstall(true, true)
  } finally {
    winPromptOpen = false
  }
}

/** Loaded on demand; configured once. */
function getWinUpdater(): AppUpdater {
  if (winUpdaterInstance) return winUpdaterInstance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  const winUpdater = autoUpdater
  winUpdaterInstance = winUpdater
  winUpdater.autoDownload = true
  winUpdater.autoInstallOnAppQuit = true
  winUpdater.logger = console

  // Test hook (end-to-end update testing only). When PEAKFLOW_UPDATE_FEED is
  // set, e.g. PEAKFLOW_UPDATE_FEED=http://127.0.0.1:8080/ , updates come from
  // that generic feed (a folder serving latest.yml, the installer .exe and its
  // .blockmap) instead of GitHub. Unset (every real user) = GitHub, unchanged.
  const testFeed = process.env.PEAKFLOW_UPDATE_FEED
  if (testFeed) {
    console.log(`[AutoUpdater] PEAKFLOW_UPDATE_FEED set — using generic feed ${testFeed}`)
    winUpdater.setFeedURL({ provider: 'generic', url: testFeed })
  }

  winUpdater.on('update-available', (info: UpdateInfo) => {
    downloading = true
    console.log(`[AutoUpdater] Update available: v${info.version} — downloading in background`)
  })

  winUpdater.on('update-downloaded', (info: UpdateInfo) => {
    downloading = false
    console.log(`[AutoUpdater] Downloaded v${info.version}`)
    void promptWinRestart(winUpdater, info, false)
  })

  winUpdater.on('error', (err) => {
    downloading = false
    console.error('[AutoUpdater] Windows update error:', err?.message ?? err)
  })
  return winUpdater
}

async function checkForWinUpdates(silent: boolean): Promise<void> {
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

  const currentVersion = app.getVersion()
  if (!app.isPackaged) {
    // electron-updater skips unpackaged (dev) runs
    console.log('[AutoUpdater] Skipping check: development build')
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Updates',
        message: `You have PeakFlow v${currentVersion}.`,
        detail: 'Development builds do not update themselves.'
      })
    }
    return
  }

  checking = true
  const winUpdater = getWinUpdater()
  console.log(`[AutoUpdater] Checking for updates... (current: v${currentVersion})`)

  try {
    const result = await winUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version
    if (result?.isUpdateAvailable && latest) {
      // Download runs in the background; 'update-downloaded' shows the restart dialog.
      const download = result.downloadPromise
      if (download) {
        download.catch((dlErr) => {
          // Already logged by the 'error' handler; only a manual check reports it.
          if (silent) return
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          dialog.showMessageBox({
            type: 'error',
            title: 'Download Failed',
            message: 'Could not download the update.',
            detail: dlMsg
          })
        })
      }
      if (!silent) {
        if (download) {
          // Manual check: a version already downloaded earlier resolves at once.
          void download.then(() => {
            if (winPromptedVersion === latest) void promptWinRestart(winUpdater, result.updateInfo, true)
          }).catch(() => undefined)
        }
        if (winPromptedVersion !== latest) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: `PeakFlow v${latest} is downloading.`,
            detail: 'You will be asked to restart when it is ready.'
          })
        }
      }
    } else {
      console.log('[AutoUpdater] No updates available — you are on the latest version')
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: `You are running the latest version of PeakFlow (v${currentVersion}).`
        })
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AutoUpdater] Check failed:', message)
    if (!silent) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: message
      })
    }
  } finally {
    checking = false
  }
}

// ─── macOS ──────────────────────────────────────────────────────────────────

let macSignedCache: boolean | null = null

/**
 * True only for a packaged app signed with a Developer ID Application
 * certificate. Squirrel.Mac refuses to install updates into unsigned or
 * ad-hoc signed apps, so those builds must not try.
 */
function isMacUpdateCapable(): boolean {
  if (!isMac || !app.isPackaged) return false
  if (macSignedCache !== null) return macSignedCache
  // process.execPath = <PeakFlow.app>/Contents/MacOS/PeakFlow
  const bundlePath = dirname(dirname(dirname(process.execPath)))
  const kind = readMacSignature(bundlePath)
  console.log(`[AutoUpdater] macOS code signature: ${kind}`)
  macSignedCache = kind === 'developer-id'
  return macSignedCache
}

let macUpdaterInstance: AppUpdater | null = null

/** Loaded on demand; configured once. */
function getMacUpdater(): AppUpdater {
  if (macUpdaterInstance) return macUpdaterInstance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  const macUpdater = autoUpdater
  macUpdaterInstance = macUpdater
  macUpdater.autoDownload = false
  macUpdater.autoInstallOnAppQuit = true
  macUpdater.logger = console

  macUpdater.on('download-progress', (p) => {
    setProgress({ state: 'downloading', version: progress.version, percent: Math.floor(p.percent) })
  })

  macUpdater.on('update-downloaded', async (info) => {
    downloading = false
    setProgress({ state: 'downloaded', version: info.version })
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `PeakFlow v${info.version} is ready to install.`,
      detail: 'PeakFlow will restart to finish updating.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (result.response === 0) macUpdater.quitAndInstall()
  })

  macUpdater.on('error', (err) => {
    const wasDownloading = downloading
    downloading = false
    console.error('[AutoUpdater] macOS update error:', err?.message ?? err)
    if (wasDownloading) setProgress({ state: 'error', version: progress.version, message: err?.message ?? String(err) })
  })
  return macUpdater
}

/** Newest release that has a .dmg for this Mac's chip (Windows-only releases are skipped). */
async function fetchLatestMacVersion(): Promise<string | null> {
  const res = await net.fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': `PeakFlow/${app.getVersion()}` }
  })
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
  const releases = (await res.json()) as Array<{ tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string }> }>
  for (const r of releases) {
    if (r.draft || r.prerelease) continue
    const version = r.tag_name.replace(/^v/, '')
    if (r.assets.some((a) => a.name === `PeakFlow-${version}-${MAC_DMG_ARCH}.dmg`)) return version
  }
  return null
}

/** Stream the website's Mac download into ~/Downloads. */
async function downloadMacDmg(version: string): Promise<string> {
  const res = await net.fetch(MAC_DOWNLOAD_URL, { headers: { 'User-Agent': `PeakFlow/${app.getVersion()}` } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
  const dest = join(app.getPath('downloads'), `PeakFlow-${version}.dmg`)
  const file = createWriteStream(dest)
  const reader = res.body.getReader()
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  let shown: number | null = -1
  setProgress({ state: 'downloading', version, percent: percentOf(0, total) })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      const pct = percentOf(received, total)
      if (pct !== shown) {
        shown = pct
        setProgress({ state: 'downloading', version, percent: pct })
      }
      if (!file.write(value)) await new Promise<void>((r) => file.once('drain', () => r()))
    }
  } finally {
    await new Promise<void>((r) => file.end(() => r()))
  }
  return dest
}

async function checkForUnsignedMacUpdates(silent: boolean): Promise<void> {
  if (checking || downloading) return
  checking = true
  const currentVersion = app.getVersion()
  try {
    const latest = await fetchLatestMacVersion()
    if (!shouldOffer(latest, currentVersion, prefs?.get('skippedVersion') || null, silent)) {
      console.log(`[AutoUpdater] Mac: nothing to offer${latest && isNewer(latest, currentVersion) ? ` (v${latest} skipped)` : ''}`)
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: `You are running the latest version of PeakFlow (v${currentVersion}).`
        })
      }
      return
    }
    if (!latest) return
    const offer = await offerMacUpdate(latest, currentVersion, 'PeakFlow will download it from getpeakflow.pro into your Downloads folder. It’s about 100 MB.')
    if (offer !== 'download') return
    downloading = true
    userStarted = true
    showUpdatesPage()
    const dmg = await downloadMacDmg(latest)
    console.log(`[AutoUpdater] Mac: downloaded ${dmg}`)
    setProgress({ state: 'downloaded', version: latest })
    await shell.openPath(dmg)
    const next = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Downloaded',
      message: `PeakFlow v${latest} is ready to install.`,
      detail:
        'In the window that just opened, drag PeakFlow into Applications and choose Replace. Then open PeakFlow again. If macOS says it cannot verify PeakFlow, open System Settings > Privacy & Security and click Open Anyway.\n\n' +
        MAC_AFTER_UPDATE,
      buttons: ['Quit PeakFlow', 'Show Me How', 'Later'],
      defaultId: 0,
      cancelId: 2
    })
    if (next.response === 1) void shell.openExternal(MAC_HELP_URL)
    if (next.response === 0) app.quit()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AutoUpdater] Mac update failed:', message)
    if (userStarted) setProgress({ state: 'error', version: progress.version, message })
    // An automatic check stays quiet, unless the customer had clicked Download
    if (!silent || userStarted) {
      const r = await dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Could not download the update.',
        detail: `${message}\n\nYou can download the newest version from getpeakflow.pro.`,
        buttons: ['Open getpeakflow.pro', 'Close'],
        defaultId: 0,
        cancelId: 1
      })
      if (r.response === 0) void shell.openExternal('https://getpeakflow.pro/download')
    }
  } finally {
    checking = false
    downloading = false
    userStarted = false
  }
}

async function checkForMacUpdates(silent: boolean): Promise<void> {
  const currentVersion = app.getVersion()

  if (!isMacUpdateCapable()) return checkForUnsignedMacUpdates(silent)

  if (checking || downloading) return
  checking = true
  const macUpdater = getMacUpdater()
  console.log(`[AutoUpdater] Checking latest-mac.yml... (current: v${currentVersion})`)

  try {
    const result = await macUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version ?? null
    if (latest && isNewer(latest, currentVersion) && !shouldOffer(latest, currentVersion, prefs?.get('skippedVersion') || null, silent)) {
      console.log(`[AutoUpdater] v${latest} skipped`)
    } else if (latest && isNewer(latest, currentVersion)) {
      console.log(`[AutoUpdater] Update available: v${latest}`)
      if ((await offerMacUpdate(latest, currentVersion, 'Would you like to download the update?')) === 'download') {
        downloading = true
        setProgress({ state: 'downloading', version: latest, percent: 0 })
        showUpdatesPage()
        try {
          await macUpdater.downloadUpdate()
        } catch (dlErr) {
          // The customer asked for it: say what went wrong even on an automatic check
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          setProgress({ state: 'error', version: latest, message: dlMsg })
          downloading = false
          void dialog.showMessageBox({ type: 'error', title: 'Download Failed', message: 'Could not download the update.', detail: dlMsg })
        }
      }
    } else {
      console.log('[AutoUpdater] No updates available — you are on the latest version')
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: `You are running the latest version of PeakFlow (v${currentVersion}).`
        })
      }
    }
  } catch (err) {
    downloading = false
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AutoUpdater] Check failed:', message)
    if (!silent) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: message
      })
    }
  } finally {
    checking = false
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check for updates. If `silent` is true (automatic check), only shows a dialog
 * when an update is ready.
 */
export async function checkForUpdates(silent = false): Promise<void> {
  if (isMac) {
    return checkForMacUpdates(silent)
  }
  return checkForWinUpdates(silent)
}

/**
 * Initialize the update checker. Runs a silent check on startup
 * and every 4 hours while PeakFlow runs.
 */
export function initAutoUpdater(): void {
  setTimeout(() => {
    checkForUpdates(true)
  }, 5000)

  setInterval(() => {
    checkForUpdates(true)
  }, CHECK_INTERVAL_MS)

  console.log('[AutoUpdater] Initialized')
}

/**
 * Get the current update status for display purposes.
 */
export function getUpdateStatus(): { checking: boolean; downloading: boolean } {
  return { checking, downloading }
}
