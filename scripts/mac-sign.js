/**
 * electron-builder custom `mac.sign` hook.
 *
 * Signs exactly as electron-builder would (same identity, keychain, hardened
 * runtime, timestamp and retry), with one change: the PeakFlowHelper Swift
 * binary gets sidecar/darwin/entitlements.helper.plist (empty) instead of
 * entitlementsInherit. Electron's own helpers still inherit allow-jit /
 * allow-unsigned-executable-memory, which V8 needs; the Swift helper does not
 * need them and should not carry them.
 *
 * With no Developer ID identity, electron-builder still calls a custom sign
 * hook (with identity undefined). We skip in that case, which matches the
 * default behaviour: unsigned builds stay unsigned.
 */

const path = require('path')

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

async function macSign(opts, signFn) {
  if (!opts.identity) {
    console.log('[mac-sign] Skipping: no signing identity found (unsigned build)')
    return
  }
  const sign = signFn ?? require('app-builder-lib/out/codeSign/macCodeSign').sign
  console.log(`[mac-sign] Signing ${opts.app}; peakflow-helper gets ${path.basename(HELPER_ENTITLEMENTS)}`)
  await sign(withHelperEntitlements(opts))
}

exports.default = (opts) => macSign(opts)
exports.macSign = macSign
exports.withHelperEntitlements = withHelperEntitlements
exports.HELPER_ENTITLEMENTS = HELPER_ENTITLEMENTS
