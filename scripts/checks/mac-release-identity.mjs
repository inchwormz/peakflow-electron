// Release gate for Mac builds: fails the build if a packaged PeakFlow.app has the wrong
// bundle identity or signature. Run after electron-builder (wired into build:mac).
//   node scripts/checks/mac-release-identity.mjs [path/to/PeakFlow.app ...]
// With no arguments it checks the packaged apps under release/mac*/ that came from this
// build (newer than out/main/index.js), so a stale release/ app is never validated.
// Ad-hoc signatures fail unless PEAKFLOW_MAC_ALLOW_ADHOC=1 (then a loud warning).
// Developer ID signatures must also use the hardened runtime (flags include "runtime").
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const APP_ID = 'pro.getpeakflow.core'
const NAME = 'PeakFlow'
const ALLOW_ADHOC = process.env.PEAKFLOW_MAC_ALLOW_ADHOC === '1'

function plistValue(app, key) {
  const r = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

function codesign(args, app) {
  const r = spawnSync('/usr/bin/codesign', [...args, app], { encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function mtimeMs(path) {
  try { return statSync(path).mtimeMs } catch { return null }
}

/** The build's own output: an app older than this was not packaged by the build that just ran. */
const buildStamp = mtimeMs(join('out', 'main', 'index.js'))

function findApps() {
  if (!existsSync('release')) return { current: [], stale: [] }
  const found = readdirSync('release')
    .filter((d) => d.startsWith('mac'))
    .map((d) => join('release', d, `${NAME}.app`))
    .filter((app) => existsSync(app))
  const current = []
  const stale = []
  for (const app of found) {
    const exe = join(app, 'Contents', 'MacOS', NAME)
    const stamp = mtimeMs(existsSync(exe) ? exe : app) ?? 0
    if (buildStamp === null || stamp >= buildStamp) current.push(app)
    else stale.push(app)
  }
  return { current, stale }
}

const explicit = process.argv.slice(2)
const { current, stale } = explicit.length ? { current: explicit, stale: [] } : findApps()
for (const app of stale) console.warn(`mac-release-identity: skipping ${app} (older than this build)`)
const apps = current
if (apps.length === 0) {
  console.error('mac-release-identity: no PeakFlow.app from this build found under release/ (run build:mac first, or pass the app path)')
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
  const authority = /^Authority=(.+)$/m.exec(info.output)?.[1]?.trim() ?? null
  const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(info.output)?.[1]?.split(',') ?? []
  if (info.status !== 0) fail(`codesign -dv failed (exit ${info.status})`)
  else {
    if (id !== APP_ID) fail(`signing Identifier is "${id}", expected ${APP_ID}`)
    if (/^Signature=adhoc$/m.test(info.output)) {
      if (ALLOW_ADHOC) console.warn(`mac-release-identity: WARNING ${app} is ad-hoc signed (PEAKFLOW_MAC_ALLOW_ADHOC=1). Every Mac user will have to re-add PeakFlow to Accessibility after each update.`)
      else fail('signed ad-hoc (Signature=adhoc): every Mac user would have to re-add PeakFlow after each update. Set PEAKFLOW_MAC_SIGN_IDENTITY, or PEAKFLOW_MAC_ALLOW_ADHOC=1 for a local test build')
    }
    if (authority) console.log(`mac-release-identity: ${app} Authority=${authority}`)
    if (authority?.startsWith('Developer ID Application') && !flags.includes('runtime')) {
      fail(`Developer ID build has no hardened runtime (flags "${flags.join(',')}", expected "runtime")`)
    }
  }

  const verify = codesign(['--verify', '--deep', '--strict'], app)
  if (verify.status !== 0) fail(`codesign --verify --deep --strict failed: ${verify.output.trim().slice(0, 300)}`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`mac-release-identity: OK (${apps.length} app${apps.length === 1 ? '' : 's'})`)
