/**
 * Update checker using GitHub Releases API.
 *
 * Compares app.getVersion() against the latest release tag
 * on github.com/inchwormz/peakflow-releases. If a newer version exists,
 * downloads the installer directly and launches it.
 *
 * This approach works with manually-uploaded releases (no latest.yml needed).
 */

import { app, dialog, net, BrowserWindow } from 'electron'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'inchwormz'
const GITHUB_REPO = 'peakflow-releases'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

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

/**
 * Find the installer asset (.exe) from release assets.
 * Matches patterns like "PeakFlow.Setup.1.0.0.exe" or "PeakFlowSetup-1.0.0.exe".
 */
function findInstallerUrl(assets: Array<{ name: string; browser_download_url: string }>): string | null {
  const installer = assets.find(
    (a) => a.name.toLowerCase().includes('peakflow') && a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe')
  )
  return installer?.browser_download_url ?? null
}

/**
 * Fetch the latest release info from GitHub.
 */
function fetchLatestRelease(): Promise<{
  tag: string
  name: string
  htmlUrl: string
  installerUrl: string | null
}> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: RELEASES_API,
      method: 'GET'
    })

    request.setHeader('Accept', 'application/vnd.github.v3+json')
    request.setHeader('User-Agent', `PeakFlow/${app.getVersion()}`)

    let body = ''

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${response.statusCode}`))
        return
      }

      response.on('data', (chunk) => {
        body += chunk.toString()
      })

      response.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (!data.tag_name) throw new Error('No tag_name in GitHub response')
          resolve({
            tag: data.tag_name,
            name: data.name || data.tag_name,
            htmlUrl: data.html_url,
            installerUrl: findInstallerUrl(data.assets || [])
          })
        } catch (err) {
          reject(new Error('Failed to parse GitHub response'))
        }
      })
    })

    request.on('error', (err) => {
      reject(err)
    })

    request.end()
  })
}

/**
 * Download installer exe to temp dir, showing progress on all windows' taskbar icons.
 * Returns the local file path on success.
 */
function downloadInstaller(url: string, fileName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dest = join(app.getPath('temp'), fileName)
    const file = createWriteStream(dest)
    const request = net.request({ url, method: 'GET' })
    request.setHeader('User-Agent', `PeakFlow/${app.getVersion()}`)

    request.on('response', (response) => {
      // Follow redirects (GitHub asset URLs redirect to S3)
      if (response.statusCode === 302 || response.statusCode === 301) {
        const location = response.headers['location']
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (redirectUrl && redirectUrl.startsWith('https://')) {
          file.close()
          resolve(downloadInstaller(redirectUrl, fileName))
          return
        }
        file.close()
        reject(new Error('Redirect to non-HTTPS URL'))
        return
      }

      if (response.statusCode !== 200) {
        file.close()
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      const contentLength = response.headers['content-length']
      const total = contentLength
        ? parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10)
        : 0
      let received = 0

      response.on('data', (chunk) => {
        received += chunk.length
        file.write(chunk)
        if (total > 0) {
          const progress = received / total
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.setProgressBar(progress)
          }
        }
      })

      response.on('end', () => {
        file.end(() => {
          // Clear taskbar progress
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.setProgressBar(-1)
          }
          resolve(dest)
        })
      })
    })

    request.on('error', (err) => {
      file.close()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.setProgressBar(-1)
      }
      reject(err)
    })

    request.end()
  })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check for updates. If `silent` is true (startup check), only shows a dialog
 * when an update IS available.
 */
export async function checkForUpdates(silent = false): Promise<void> {
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

  checking = true
  const currentVersion = app.getVersion()
  console.log(`[AutoUpdater] Checking for updates... (current: v${currentVersion})`)

  try {
    const release = await fetchLatestRelease()
    console.log(`[AutoUpdater] Latest release: ${release.tag}`)

    if (isNewer(release.tag, currentVersion)) {
      // Update available
      console.log(`[AutoUpdater] Update available: ${release.tag}`)
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `PeakFlow ${release.tag} is available (you have v${currentVersion}).`,
        detail: 'Would you like to download the update?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      })

      if (result.response === 0) {
        if (!release.installerUrl) {
          console.error('[AutoUpdater] No installer asset found in release')
          dialog.showMessageBox({
            type: 'error',
            title: 'Update Error',
            message: 'No installer found for this release.'
          })
          return
        }

        downloading = true
        console.log(`[AutoUpdater] Downloading: ${release.installerUrl}`)

        try {
          const fileName = `PeakFlow-Setup-${release.tag}.exe`
          const installerPath = await downloadInstaller(release.installerUrl, fileName)
          console.log(`[AutoUpdater] Downloaded to: ${installerPath}`)

          const installResult = await dialog.showMessageBox({
            type: 'info',
            title: 'Download Complete',
            message: `PeakFlow ${release.tag} is ready to install.`,
            detail: 'The app will close and the installer will open.',
            buttons: ['Install Now', 'Later'],
            defaultId: 0,
            cancelId: 1
          })

          if (installResult.response === 0) {
            spawn(installerPath, { detached: true, stdio: 'ignore' }).unref()
            app.quit()
          }
        } catch (dlErr) {
          const dlMsg = dlErr instanceof Error ? dlErr.message : String(dlErr)
          console.error('[AutoUpdater] Download failed:', dlMsg)
          dialog.showMessageBox({
            type: 'error',
            title: 'Download Failed',
            message: 'Could not download the update.',
            detail: dlMsg
          })
        } finally {
          downloading = false
        }
      }
    } else {
      // Up to date
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

/**
 * Initialize the update checker. Runs a silent check on startup.
 */
export function initAutoUpdater(): void {
  setTimeout(() => {
    checkForUpdates(true)
  }, 5000)

  console.log('[AutoUpdater] Initialized')
}

/**
 * Get the current update status for display purposes.
 */
export function getUpdateStatus(): { checking: boolean; downloading: boolean } {
  return { checking, downloading }
}
