/**
 * Post-sign notarization for macOS builds (electron-builder afterSign hook).
 *
 * Preferred credentials: an App Store Connect API key.
 *   APPLE_API_KEY      path to the AuthKey_XXXX.p8 file
 *   APPLE_API_KEY_ID   the key's ID
 *   APPLE_API_ISSUER   the issuer UUID
 * Fallback: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.
 *
 * Store these with the mac-secrets helper and inject them for the build, e.g.
 *   mac-secrets run peakflow --key APPLE_API_KEY --key APPLE_API_KEY_ID \
 *     --key APPLE_API_ISSUER --key APPLE_TEAM_ID -- npm run build:mac
 * Never commit them. Without credentials, or for an unsigned build, this
 * step is skipped and the build still succeeds.
 *
 * @electron/notarize staples the ticket to the .app when it succeeds.
 */

const { spawnSync } = require('child_process')

function isDeveloperIdSigned(appPath) {
  // codesign prints signing details on stderr, and exits non-zero if unsigned
  const r = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' })
  return r.status === 0 && /Authority=Developer ID Application/.test(`${r.stdout}${r.stderr}`)
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`
  const env = process.env

  const apiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER
  const appleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID
  if (!apiKey && !appleId) {
    console.log('[Notarize] Skipping: no APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER (or Apple ID) credentials set')
    return
  }
  if (!isDeveloperIdSigned(appPath)) {
    console.log('[Notarize] Skipping: app is not signed with a Developer ID Application certificate')
    return
  }

  const { notarize } = require('@electron/notarize')
  const options = apiKey
    ? { appPath, appleApiKey: env.APPLE_API_KEY, appleApiKeyId: env.APPLE_API_KEY_ID, appleApiIssuer: env.APPLE_API_ISSUER }
    : { appPath, appleId: env.APPLE_ID, appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD, teamId: env.APPLE_TEAM_ID }

  console.log(`[Notarize] Submitting ${appPath} to Apple (${apiKey ? 'API key' : 'Apple ID'})...`)
  await notarize(options)
  console.log('[Notarize] Done (ticket stapled)')
}
