/**
 * Check: the custom mac.sign hook (scripts/mac-sign.js).
 * - the helper alone gets the empty helper entitlements;
 * - a release with no identity FAILS (no silent ad-hoc); ad-hoc only with PEAKFLOW_MAC_ALLOW_ADHOC=1;
 * - PEAKFLOW_MAC_SIGN_IDENTITY set but empty is an error;
 * - PEAKFLOW_MAC_SIGN_IDENTITY selects a stable self-signed identity;
 * - a wrong Identifier after signing fails the build.
 * codesign and the signer are faked, so this runs anywhere.
 * Env vars are set per block and restored in finally blocks.
 * Run: node scripts/checks/mac-sign.check.mts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { macSign, withHelperEntitlements, resolveIdentity, identifierOf, HELPER_ENTITLEMENTS, APP_IDENTIFIER, HELPER_IDENTIFIER } = require('../mac-sign.js')

const SIGN_VARS = ['PEAKFLOW_MAC_SIGN_IDENTITY', 'PEAKFLOW_MAC_SIGN_KEYCHAIN', 'PEAKFLOW_MAC_ALLOW_ADHOC'] as const

/** Runs fn with the given env values (undefined = unset), then restores the previous values, even on failure. */
async function withEnv(vars: Partial<Record<(typeof SIGN_VARS)[number], string | undefined>>, fn: () => Promise<void> | void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of SIGN_VARS) saved[k] = process.env[k]
  try {
    for (const k of SIGN_VARS) {
      if (vars[k] === undefined) delete process.env[k]
      else process.env[k] = vars[k]
    }
    await fn()
  } finally {
    for (const k of SIGN_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

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

// Identity resolution (pure: env passed in, nothing read from process.env)
assert.deepEqual(resolveIdentity({ identity: 'DevID' }, {}), { identity: 'DevID', source: 'Developer ID (electron-builder)' })
assert.equal(resolveIdentity({}, { PEAKFLOW_MAC_SIGN_IDENTITY: 'PeakFlow Self' }).identity, 'PeakFlow Self')
assert.equal(resolveIdentity({}, { PEAKFLOW_MAC_ALLOW_ADHOC: '1' }).identity, '-')
assert.throws(() => resolveIdentity({}, {}), /No signing identity.*docs\/RELEASE-CHECKLIST\.md/)
assert.throws(() => resolveIdentity({}, { PEAKFLOW_MAC_SIGN_IDENTITY: '' }), /set but empty/)
assert.throws(() => resolveIdentity({}, { PEAKFLOW_MAC_SIGN_IDENTITY: '   ' }), /set but empty/)
assert.throws(() => resolveIdentity({ identity: 'DevID' }, { PEAKFLOW_MAC_SIGN_IDENTITY: '' }), /set but empty/, 'empty is an error even with a Developer ID')

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

// 0. Release with no identity: the build fails before any codesign call
await withEnv({}, async () => {
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /No signing identity/)
  assert.equal(calls.length, 0, 'nothing signed')
})

// 0b. Set but empty PEAKFLOW_MAC_SIGN_IDENTITY: the build fails, no ad-hoc fallthrough
await withEnv({ PEAKFLOW_MAC_SIGN_IDENTITY: '', PEAKFLOW_MAC_ALLOW_ADHOC: '1' }, async () => {
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /set but empty/)
  assert.equal(calls.length, 0)
})

// 1. Explicit local ad-hoc test build: ad-hoc, not skipped, pinned identifiers, deep seal first
await withEnv({ PEAKFLOW_MAC_ALLOW_ADHOC: '1' }, async () => {
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
})

// 2. Self-signed identity: plain codesign like the 2.1.1 build (no runtime, no timestamp, no app entitlements);
//    the Developer ID signer is not used
await withEnv({ PEAKFLOW_MAC_SIGN_IDENTITY: 'PeakFlow Code Signing' }, async () => {
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  let signerCalled = 0
  await macSign({ app, identity: undefined, optionsForFile }, { run, sign: async () => { signerCalled++ } })
  assert.equal(signerCalled, 0, 'self-signed uses codesign directly')
  assert.deepEqual(calls[0], ['--force', '--deep', '--sign', 'PeakFlow Code Signing', app])
  const helperSign = calls.find((c) => c.includes('--identifier') && c.includes(HELPER_IDENTIFIER))!
  assert.equal(helperSign[helperSign.indexOf('--entitlements') + 1], HELPER_ENTITLEMENTS)
  assert.equal(helperSign[helperSign.indexOf('--sign') + 1], 'PeakFlow Code Signing')
  assert.ok(!helperSign.includes('--options') && !helperSign.includes('--timestamp'), 'self-signed: no hardened runtime, no timestamp')
  const appSign = calls.find((c) => c.includes(APP_IDENTIFIER) && c[c.length - 1] === app && c[0] === '--force' && !c.includes('--deep'))!
  assert.equal(appSign[appSign.indexOf('--sign') + 1], 'PeakFlow Code Signing')
  assert.ok(!appSign.includes('--options') && !appSign.includes('--timestamp'), 'self-signed app: no hardened runtime, no timestamp')
  assert.ok(!appSign.includes('--entitlements'), 'self-signed app: no app entitlements, like 2.1.1')
  assert.ok(calls.every((c) => !c.includes('--keychain')), 'no keychain flag when PEAKFLOW_MAC_SIGN_KEYCHAIN is unset')
})

// 2b. Self-signed with a keychain: --keychain goes on every codesign call
await withEnv({ PEAKFLOW_MAC_SIGN_IDENTITY: 'PeakFlow Code Signing', PEAKFLOW_MAC_SIGN_KEYCHAIN: '/k/login.keychain-db' }, async () => {
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  await macSign({ app, identity: undefined, optionsForFile }, { run, sign: async () => { throw new Error('not used') } })
  assert.deepEqual(calls[0], ['--force', '--deep', '--sign', 'PeakFlow Code Signing', '--keychain', '/k/login.keychain-db', app])
  assert.ok(calls.filter((c) => c[0] === '--force' && c.includes('--sign')).every((c) => c.includes('--keychain')))
})

// 2c. Developer ID (electron-builder identity): the Developer ID signer runs with runtime, timestamp and entitlements
await withEnv({}, async () => {
  const { run, calls } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER })
  let seen: any = null
  await macSign({ app, identity: 'Developer ID Application: Test (TEAM)', optionsForFile }, { run, sign: async (o: any) => { seen = o } })
  assert.equal(seen.identity, 'Developer ID Application: Test (TEAM)')
  assert.equal(seen.optionsForFile(helper).entitlements, HELPER_ENTITLEMENTS)
  const appSign = calls.find((c) => c[0] === '--force' && c.includes(APP_IDENTIFIER))!
  assert.ok(appSign.includes('--options') && appSign.includes('runtime'), 'hardened runtime kept')
  assert.ok(appSign.includes('--timestamp'), 'timestamp kept')
  assert.equal(appSign[appSign.indexOf('--entitlements') + 1], main)
})

// 3. Wrong identifier after signing: the build fails
await withEnv({ PEAKFLOW_MAC_ALLOW_ADHOC: '1' }, async () => {
  const { run } = fakeRun({ app: 'Electron', helper: HELPER_IDENTIFIER })
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /expected pro\.getpeakflow\.core/)
})

// 4. Verification failure fails the build
await withEnv({ PEAKFLOW_MAC_ALLOW_ADHOC: '1' }, async () => {
  const { run } = fakeRun({ app: APP_IDENTIFIER, helper: HELPER_IDENTIFIER }, true)
  await assert.rejects(macSign({ app, identity: undefined, optionsForFile }, { run }), /--verify --deep --strict failed/)
})

assert.equal(identifierOf('Executable=x\nIdentifier=pro.getpeakflow.core\n'), 'pro.getpeakflow.core')
console.log('mac-sign check: OK')
