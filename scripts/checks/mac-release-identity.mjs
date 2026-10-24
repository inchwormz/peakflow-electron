// Release gate for Mac builds: fails the build if a packaged PeakFlow.app has the wrong
// bundle identity or signature. Run after electron-builder (wired into build:mac).
//   node scripts/checks/mac-release-identity.mjs [path/to/PeakFlow.app ...]
// With no arguments it checks every packaged app under release/mac*/.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const APP_ID = 'pro.getpeakflow.core'
const NAME = 'PeakFlow'

function plistValue(app, key) {
  const r = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function codesign(args, app) {
  const r = spawnSync('/usr/bin/codesign', [...args, app], { encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function findApps() {
  if (!existsSync('release')) return []
  return readdirSync('release')
    .filter((d) => d.startsWith('mac'))
    .map((d) => join('release', d, `${NAME}.app`))
    .filter((app) => existsSync(app))
}

const apps = process.argv.length > 2 ? process.argv.slice(2) : findApps()
if (apps.length === 0) {
  console.error('mac-release-identity: no packaged PeakFlow.app found under release/')
  process.exit(1)
}

const problems = []
for (const app of apps) {
  const fail = (msg) => problems.push(`${app}: ${msg}`)
  const bundleId = plistValue(app, 'CFBundleIdentifier')
  if (bundleId !== APP_ID) fail(`CFBundleIdentifier is "${bundleId}", expected ${APP_ID}`)
  const bundleName = plistValue(app, 'CFBundleName')
  if (bundleName !== NAME) fail(`CFBundleName is "${bundleName}", expected ${NAME}`)
  const display = plistValue(app, 'CFBundleDisplayName')
  if (display !== null && display !== NAME) fail(`CFBundleDisplayName is "${display}", expected ${NAME}`)

  const info = codesign(['-dv', '--verbose=2'], app)
  const id = /^Identifier=(.+)$/m.exec(info.output)?.[1]?.trim()
  if (info.status !== 0) fail(`codesign -dv failed (exit ${info.status})`)
  else if (id !== APP_ID) fail(`signing Identifier is "${id}", expected ${APP_ID}`)

  const verify = codesign(['--verify', '--deep', '--strict'], app)
  if (verify.status !== 0) fail(`codesign --verify --deep --strict failed: ${verify.output.trim().slice(0, 300)}`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`mac-release-identity: OK (${apps.length} app${apps.length === 1 ? '' : 's'})`)
