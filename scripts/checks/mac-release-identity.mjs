// Release gate for Mac builds: fails the build if a packaged PeakFlow.app has the wrong
// bundle identity or signature. Run after electron-builder (wired into build:mac).
//   node scripts/checks/mac-release-identity.mjs [path/to/PeakFlow.app ...]
// With no arguments it checks the packaged apps under release/mac*/ that came from this
// build (newer than out/main/index.js), so a stale release/ app is never validated.
// Ad-hoc signatures fail unless PEAKFLOW_MAC_ALLOW_ADHOC=1 (then a loud warning).
// Developer ID signatures must also use the hardened runtime (flags include "runtime").
// Every app that is not Developer ID-signed must be signed by the stable self-signed
// certificate: Authority is PEAKFLOW_MAC_SIGN_IDENTITY (default "PeakFlow Code Signing"), and
// its designated requirement must pin the certificate leaf (PEAKFLOW_MAC_SIGN_LEAF_SHA1,
// default EXPECTED_LEAF_SHA1), so the grant survives updates. The designated requirement is
// printed so the release owner can see it.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_ID = 'pro.getpeakflow.core'
const NAME = 'PeakFlow'
const ALLOW_ADHOC = process.env.PEAKFLOW_MAC_ALLOW_ADHOC === '1'

/** The stable self-signed certificate ("docs/RELEASE-CHECKLIST.md", item 3). */
export const DEFAULT_STABLE_IDENTITY = 'PeakFlow Code Signing'
/** Its leaf SHA-1 (lowercase in designated requirements). Pinned so a look-alike cert cannot pass. */
export const EXPECTED_LEAF_SHA1 = '2C6DF1B6EA8E330D6D4727B05F7A1CE533C55755'

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

/**
 * Checks the self-signed (stable certificate) identity of one app from canned codesign output.
 * `info` is `codesign -dv` output, `dr` is `codesign -d -r-` output and `drStatus` its exit code.
 * Developer ID apps are skipped here (their runtime check stays in the caller).
 * Returns the list of problems (empty when it passes) and the designated requirement line.
 */
export function stableIdentityProblems({ info, dr, drStatus, env = process.env }) {
  const authority = /^Authority=(.+)$/m.exec(info)?.[1]?.trim() ?? null
  if (authority?.startsWith('Developer ID Application')) return { problems: [], designated: null }

  const problems = []
  const expectedName = env.PEAKFLOW_MAC_SIGN_IDENTITY?.trim() || DEFAULT_STABLE_IDENTITY
  const expectedLeaf = (env.PEAKFLOW_MAC_SIGN_LEAF_SHA1?.trim() || EXPECTED_LEAF_SHA1).toLowerCase()

  const lines = info.split('\n').map((l) => l.trim())
  if (!lines.includes(`Authority=${expectedName}`)) {
    problems.push(`codesign shows no "Authority=${expectedName}" (the stable certificate); Authority is "${authority ?? 'none'}"`)
  }
  const designated = dr.split('\n').find((l) => l.includes('designated =>'))?.replace(/^#\s*/, '').trim() ?? dr.trim()
  if (drStatus !== 0) {
    problems.push(`codesign -d -r- failed (exit ${drStatus})`)
  } else if (!dr.toLowerCase().includes(`certificate leaf = h"${expectedLeaf}"`)) {
    problems.push(`designated requirement does not pin the stable certificate leaf ${expectedLeaf} (no 'certificate leaf = H"${expectedLeaf}"'), so Accessibility would be forgotten after updates: ${designated}`)
  }
  return { problems, designated }
}

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

/** The build's own output: an app older than this was not packaged by the build that just ran. */
const buildStamp = mtimeMs(join('out', 'main', 'index.js'))

function main() {
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

    const info = codesign(['-dv', '--verbose=4'], app)
    const id = /^Identifier=(.+)$/m.exec(info.output)?.[1]?.trim()
    const authority = /^Authority=(.+)$/m.exec(info.output)?.[1]?.trim() ?? null
    const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/.exec(info.output)?.[1]?.split(',') ?? []
    if (info.status !== 0) fail(`codesign -dv failed (exit ${info.status})`)
    else {
      if (id !== APP_ID) fail(`signing Identifier is "${id}", expected ${APP_ID}`)
      const adhoc = /^Signature=adhoc$/m.test(info.output)
      if (adhoc) {
        if (ALLOW_ADHOC) console.warn(`mac-release-identity: WARNING ${app} is ad-hoc signed (PEAKFLOW_MAC_ALLOW_ADHOC=1). Every Mac user will have to re-add PeakFlow to Accessibility after each update.`)
        else fail('signed ad-hoc (Signature=adhoc): every Mac user would have to re-add PeakFlow after each update. Set PEAKFLOW_MAC_SIGN_IDENTITY, or PEAKFLOW_MAC_ALLOW_ADHOC=1 for a local test build')
      }
      if (authority) console.log(`mac-release-identity: ${app} Authority=${authority}`)
      if (authority?.startsWith('Developer ID Application') && !flags.includes('runtime')) {
        fail(`Developer ID build has no hardened runtime (flags "${flags.join(',')}", expected "runtime")`)
      }
      if (!adhoc) {
        const dr = codesign(['-d', '-r-'], app)
        const stable = stableIdentityProblems({ info: info.output, dr: dr.output, drStatus: dr.status })
        for (const p of stable.problems) fail(p)
        if (stable.designated) console.log(`mac-release-identity: ${app} designated requirement: ${stable.designated}`)
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
