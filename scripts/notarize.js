/**
 * Post-sign notarization script for macOS builds.
 *
 * Called by electron-builder after code signing (configured via afterSign in
 * electron-builder.yml). Submits the signed .app to Apple for notarization,
 * which is required for Gatekeeper to allow the app to run.
 *
 * Requires environment variables:
 *   APPLE_ID — Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD — App-specific password (not account password)
 *   APPLE_TEAM_ID — 10-character team identifier
 */

const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') return

  // Skip if signing credentials aren't available (local dev builds)
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('[Notarize] Skipping — APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`[Notarize] Submitting ${appPath} to Apple...`)

  await notarize({
    appBundleId: 'pro.getpeakflow.core',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })

  console.log('[Notarize] Done')
}
