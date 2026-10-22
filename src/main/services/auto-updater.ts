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
 */

import { app, dialog, net, shell } from 'electron'
import { createWriteStream } from 'fs'
import { dirname, join } from 'path'
import { readMacSignature } from './mac-signature'
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a semver tag like "v1.2.3" or "1.2.3" into [major, minor, patch].
 */
function parseSemver(tag: string): [number, number, number] | null {
  const match = tag.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

/**
 * Returns true if `remote` is newer than `local`.
 */
function isNewer(remote: string, local: string): boolean {
  const r = parseSemver(remote)
  const l = parseSemver(local)
  if (!r || !l) return false
  if (r[0] !== l[0]) return r[0] > l[0]
  if (r[1] !== l[1]) return r[1] > l[1]
  return r[2] > l[2]
}

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

  macUpdater.on('update-downloaded', async (info) => {
    downloading = false
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
    downloading = false
    console.error('[AutoUpdater] macOS update error:', err?.message ?? err)
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
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
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
    if (!latest || !isNewer(latest, currentVersion)) {
      console.log('[AutoUpdater] Mac: no newer version')
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: `You are running the latest version of PeakFlow (v${currentVersion}).`
        })
      }
      return
    }
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `PeakFlow v${latest} is available (you have v${currentVersion}).`,
      detail: 'PeakFlow will download it from getpeakflow.pro into your Downloads folder.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (choice.response !== 0) return
    downloading = true
    const dmg = await downloadMacDmg(latest)
    console.log(`[AutoUpdater] Mac: downloaded ${dmg}`)
    await shell.openPath(dmg)
    const next = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Downloaded',
      message: `PeakFlow v${latest} is ready to install.`,
      detail:
        'In the window that just opened, drag PeakFlow into Applications and choose Replace. Then open PeakFlow again. If macOS says it cannot verify PeakFlow, open System Settings > Privacy & Security and click Open Anyway.',
      buttons: ['Quit PeakFlow', 'Show Me How', 'Later'],
      defaultId: 0,
      cancelId: 2
    })
    if (next.response === 1) void shell.openExternal(MAC_HELP_URL)
    if (next.response === 0) app.quit()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AutoUpdater] Mac update failed:', message)
    if (!silent) {
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
    const latest = result?.updateInfo?.version
    if (latest && isNewer(latest, currentVersion)) {
      console.log(`[AutoUpdater] Update available: v${latest}`)
      const choice = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `PeakFlow v${latest} is available (you have v${currentVersion}).`,
        detail: 'Would you like to download the update?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      if (choice.response === 0) {
        downloading = true
        await macUpdater.downloadUpdate()
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
