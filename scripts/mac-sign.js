/**
 * electron-builder custom `mac.sign` hook. Every Mac build is signed here.
 *
 * Identity, in order:
 *   1. a Developer ID Application identity from electron-builder (opts.identity);
 *   2. PEAKFLOW_MAC_SIGN_IDENTITY: a stable self-signed code-signing certificate
 *      (scripts/mac/make-selfsigned-identity.sh), in the keychain named by
 *      PEAKFLOW_MAC_SIGN_KEYCHAIN if set;
 *   3. otherwise ad-hoc ("-"), with a loud warning.
 *
 * Why a stable identity matters: macOS ties an Accessibility grant to the app's
 * designated requirement. Ad-hoc builds get a requirement that changes with every
 * build, so each update forgets the grant. A stable certificate gives a
 * requirement of "identifier pro.getpeakflow.core and this certificate", which
 * survives updates. Developer ID is still the real cure (notarized, no warning).
 *
 * Every path ends the same way: the app is signed with the identifier
 * pro.getpeakflow.core and the Swift helper with pro.getpeakflow.core.helper,
 * the bundle is sealed, and `codesign --verify --deep --strict` plus the
 * identifier check run. Any failure throws, so the build fails.
 *
 * Hardened runtime and entitlements apply only to signed builds with a real
 * identity. The ad-hoc build matches the 2.1.1 build that worked (no runtime flag).
 */

const path = require('path')
const { spawnSync } = require('child_process')

const APP_IDENTIFIER = 'pro.getpeakflow.core'
const HELPER_IDENTIFIER = 'pro.getpeakflow.core.helper'
const AD_HOC = '-'
const CODESIGN = '/usr/bin/codesign'

const HELPER_ENTITLEMENTS = path.join(__dirname, '..', 'sidecar', 'darwin', 'entitlements.helper.plist')
const HELPER_SUFFIX = `${path.sep}Contents${path.sep}Resources${path.sep}peakflow-helper`

function withHelperEntitlements(opts) {
  const original = opts.optionsForFile
  return {
    ...opts,
    optionsForFile: (filePath) => {
      const base = original ? original(filePath) : {}
      if (filePath.endsWith(HELPER_SUFFIX)) {
        return { ...base, entitlements: HELPER_ENTITLEMENTS }
      }
      return base
    }
  }
}

/** The identity to sign with: Developer ID from electron-builder, else PEAKFLOW_MAC_SIGN_IDENTITY, else ad-hoc. */
function resolveIdentity(opts, env = process.env) {
  if (opts.identity) return { identity: opts.identity, source: 'Developer ID (electron-builder)' }
  if (env.PEAKFLOW_MAC_SIGN_IDENTITY) return { identity: env.PEAKFLOW_MAC_SIGN_IDENTITY, source: 'PEAKFLOW_MAC_SIGN_IDENTITY (self-signed)' }
  return { identity: AD_HOC, source: 'ad-hoc' }
}

/** codesign -dv prints `Identifier=...` on stderr. Returns the identifier line's value, or null. */
function identifierOf(codesignOutput) {
  const m = /^Identifier=(.+)$/m.exec(codesignOutput)
  return m ? m[1].trim() : null
}

function runCodesign(args) {
  const r = spawnSync(CODESIGN, args, { encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function mustRun(run, args, what) {
  const r = run(args)
  if (r.status !== 0) throw new Error(`[mac-sign] ${what} failed (exit ${r.status}): ${r.output.trim().slice(0, 500)}`)
  return r
}

async function macSign(opts, deps = {}) {
  const run = deps.run ?? runCodesign
  const { identity, source } = resolveIdentity(opts)
  const adHoc = identity === AD_HOC
  const keychain = process.env.PEAKFLOW_MAC_SIGN_KEYCHAIN
  const keychainArgs = keychain && !adHoc ? ['--keychain', keychain] : []
  const helperPath = path.join(opts.app, 'Contents', 'Resources', 'peakflow-helper')

  if (adHoc) {
    console.warn('[mac-sign] WARNING: no signing identity. Building ad-hoc. macOS will forget the Accessibility grant after every update until a stable identity or Developer ID is used (see scripts/mac/make-selfsigned-identity.sh).')
  }
  console.log(`[mac-sign] Signing ${opts.app} with ${source}`)

  if (adHoc) {
    // Same as the 2.1.1 build that kept its grant: deep ad-hoc seal, no runtime flag
    mustRun(run, ['--force', '--deep', '--sign', AD_HOC, opts.app], 'ad-hoc deep sign')
  } else {
    const sign = deps.sign ?? require('app-builder-lib/out/codeSign/macCodeSign').sign
    await sign({ ...withHelperEntitlements(opts), identity, keychain: keychain || undefined })
  }

  const runtimeArgs = adHoc ? [] : ['--options', 'runtime', '--timestamp']
  // Pin the helper's identifier, then the app's; the app seal is written last, over the helper
  mustRun(run, ['--force', '--sign', identity, '--identifier', HELPER_IDENTIFIER, ...runtimeArgs, ...keychainArgs, '--entitlements', HELPER_ENTITLEMENTS, helperPath], 'helper sign')
  const mainEntitlements = (opts.optionsForFile && opts.optionsForFile(opts.app)?.entitlements) || path.join(__dirname, '..', 'resources', 'entitlements.mac.plist')
  const appEntitlements = adHoc ? [] : ['--entitlements', mainEntitlements]
  mustRun(run, ['--force', '--sign', identity, '--identifier', APP_IDENTIFIER, ...runtimeArgs, ...keychainArgs, ...appEntitlements, opts.app], 'app sign')

  mustRun(run, ['--verify', '--deep', '--strict', opts.app], 'codesign --verify --deep --strict')
  const appInfo = mustRun(run, ['-dv', '--verbose=2', opts.app], 'codesign -dv app').output
  const helperInfo = mustRun(run, ['-dv', '--verbose=2', helperPath], 'codesign -dv helper').output
  if (identifierOf(appInfo) !== APP_IDENTIFIER) throw new Error(`[mac-sign] app signing Identifier is "${identifierOf(appInfo)}", expected ${APP_IDENTIFIER}`)
  if (identifierOf(helperInfo) !== HELPER_IDENTIFIER) throw new Error(`[mac-sign] helper signing Identifier is "${identifierOf(helperInfo)}", expected ${HELPER_IDENTIFIER}`)
  console.log(`[mac-sign] OK: Identifier=${APP_IDENTIFIER}, helper ${HELPER_IDENTIFIER}, ${adHoc ? 'ad-hoc' : identity}`)
}

exports.default = (opts) => macSign(opts)
exports.macSign = macSign
exports.withHelperEntitlements = withHelperEntitlements
exports.resolveIdentity = resolveIdentity
exports.identifierOf = identifierOf
exports.APP_IDENTIFIER = APP_IDENTIFIER
exports.HELPER_IDENTIFIER = HELPER_IDENTIFIER
exports.HELPER_ENTITLEMENTS = HELPER_ENTITLEMENTS
