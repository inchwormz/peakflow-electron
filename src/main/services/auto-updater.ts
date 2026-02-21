/**
 * Update checker using GitHub Releases API.
 *
 * Compares app.getVersion() against the latest release tag
 * on github.com/inchwormz/peakflow-releases. If a newer version exists,
 * prompts the user to download it via their browser.
 *
 * This approach works with manually-uploaded releases (no latest.yml needed).
 */

import { app, dialog, shell, net } from 'electron'

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'inchwormz'
const GITHUB_REPO = 'peakflow-releases'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

// ─── State ───────────────────────────────────────────────────────────────────

let checking = false

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
        // Open installer download or release page — only allow HTTPS
        const url = release.installerUrl || release.htmlUrl
        if (url.startsWith('https://')) {
          shell.openExternal(url)
        } else {
          console.warn('[AutoUpdater] Blocked non-HTTPS URL:', url)
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
export function getUpdateStatus(): { checking: boolean } {
  return { checking }
}
