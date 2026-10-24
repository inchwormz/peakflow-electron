/**
 * Check: the custom mac.sign hook (scripts/mac-sign.js).
 * - the helper alone gets the empty helper entitlements;
 * - with no identity it does NOT skip: it ad-hoc signs with the pinned identifiers;
 * - PEAKFLOW_MAC_SIGN_IDENTITY selects a stable self-signed identity;
 * - a wrong Identifier after signing fails the build.
 * codesign and the signer are faked, so this runs anywhere.
 * Run: node scripts/checks/mac-sign.check.mts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { macSign, withHelperEntitlements, resolveIdentity, identifierOf, HELPER_ENTITLEMENTS, APP_IDENTIFIER, HELPER_IDENTIFIER } = require('../mac-sign.js')

const app = '/x/PeakFlow.app'
const helper = `${app}/Contents/Resources/peakflow-helper`
const inherit = '/r/entitlements.mac.inherit.plist'
const main = '/r/entitlements.mac.plist'
const optionsForFile = (f: string) => ({ entitlements: f === app ? main : inherit, hardenedRuntime: true, timestamp: 'none' })

// Wrapper: helper gets the empty helper entitlements, other files untouched
const wrapped = withHelperEntitlements({ app, identity: 'ABC', optionsForFile })
assert.deepEqual(wrapped.optionsForFile(helper), { entitlements: HELPER_ENTITLEMENTS, hardenedRuntime: true, timestamp: 'none' })
assert.equal(wrapped.optionsForFile(app).entitlements, main)
assert.equal(wrapped.optionsForFile(`${app}/Contents/Frameworks/PeakFlow Helper (Renderer).app`).entitlements, inherit)
assert.equal(wrapped.optionsForFile(`${app}/Contents/Resources/peakflow-helper.bak`).entitlements, inherit)

// Identity resolution
const env = {} as Record<string, string>
assert.deepEqual(resolveIdentity({ identity: 'DevID' }, env), { identity: 'DevID', source: 'Developer ID (electron-builder)' })
assert.equal(resolveIdentity({}, { PEAKFLOW_MAC_SIGN_IDENTITY: 'PeakFlow Self' }).identity, 'PeakFlow Self')
assert.equal(resolveIdentity({}, {}).identity, '-')

// Fake codesign: records calls, reports the identifiers we ask for
type Call = string[]
function fakeRun(identifiers: { app: string; helper: string }, failVerify = false) {
  const calls: Call[] = []
  const run = (args: string[]) => {
    calls.push(args)
    if (args[0] === '--verify') return { status: failVerify ? 1 : 0, output: '' }
    if (args[0] === '-dv') {
      const target = args[args.length - 1]
      return { status: 0, output: `Executable=${target}\nIdentifier=${target === app ? identifiers.app : identifiers.helper}\n` }
    }
    return { status: 0, output: '' }
  }
  return { run, calls }
}

// 1. No identity: ad-hoc, not skipped, pinned identifiers, deep seal first
{
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  let signerCalled = 0
  await macSign({ app, identity: undefined, optionsForFile }, { run, sign: async () => { signerCalled++ } })
  assert.equal(signerCalled, 0, 'ad-hoc uses codesign directly, not the Developer ID signer')
  assert.deepEqual(calls[0], ['--force', '--deep', '--sign', '-', app])
  const helperSign = calls.find((c) => c.includes('--identifier') && c.includes(HELPER_IDENTIFIER))!
  assert.ok(helperSign && helperSign.includes(helper))
  assert.ok(!helperSign.includes('--options'), 'ad-hoc: no hardened runtime, like the 2.1.1 build')
  const appSign = calls.find((c) => c.includes(APP_IDENTIFIER) && c[c.length - 1] === app && c[0] === '--force' && !c.includes('--deep'))!
  assert.ok(appSign, 'app re-sealed with its identifier')
  assert.ok(!appSign.includes('--entitlements'))
  assert.ok(calls.some((c) => c[0] === '--verify' && c.includes('--strict')))
}

// 2. Self-signed identity: the Developer ID signer runs with the identity, runtime and entitlements
{
  process.env.PEAKFLOW_MAC_SIGN_IDENTITY = 'PeakFlow Self'
  process.env.PEAKFLOW_MAC_SIGN_KEYCHAIN = '/k/peakflow-codesign.keychain-db'
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  let seen: any = null
  await macSign({ app, identity: undefined, optionsForFile }, { run, sign: async (o: any) => { seen = o } })
  assert.equal(seen.identity, 'PeakFlow Self')
  assert.equal(seen.keychain, '/k/peakflow-codesign.keychain-db')
  assert.equal(seen.optionsForFile(helper).entitlements, HELPER_ENTITLEMENTS)
  const appSign = calls.find((c) => c[0] === '--force' && c.includes(APP_IDENTIFIER))!
  assert.ok(appSign.includes('--options') && appSign.includes('runtime'), 'hardened runtime kept')
  assert.equal(appSign[appSign.indexOf('--entitlements') + 1], main)
  delete process.env.PEAKFLOW_MAC_SIGN_IDENTITY
  delete process.env.PEAKFLOW_MAC_SIGN_KEYCHAIN
}

// 3. Wrong identifier after signing: the build fails
{
  const { run } = fakeRun({ app: 'Electron', helper: HELPER_IDENTIFIER })
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /expected pro\.getpeakflow\.core/)
}

// 4. Verification failure fails the build
{
  const { run } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER }, true)
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /--verify --deep --strict failed/)
}

assert.equal(identifierOf('Executable=x\nIdentifier=pro.getpeakflow.core\n'), 'pro.getpeakflow.core')
console.log('mac-sign check: OK')
