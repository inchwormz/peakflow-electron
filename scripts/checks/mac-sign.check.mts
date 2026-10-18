/**
 * Check: the custom mac.sign hook gives only peakflow-helper the empty
 * helper entitlements, leaves every other file's options untouched, and
 * skips (like the default) when there is no identity.
 * Full ad-hoc signing of a copied .app was verified by hand (see PR #3).
 * Run: node scripts/checks/mac-sign.check.mts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { macSign, withHelperEntitlements, HELPER_ENTITLEMENTS } = require('../mac-sign.js')

const app = '/x/PeakFlow.app'
const inherit = '/r/entitlements.mac.inherit.plist'
const main = '/r/entitlements.mac.plist'
const optionsForFile = (f: string) => ({ entitlements: f === app ? main : inherit, hardenedRuntime: true, timestamp: 'none' })
const wrapped = withHelperEntitlements({ app, identity: 'ABC', optionsForFile })

assert.deepEqual(wrapped.optionsForFile(`${app}/Contents/Resources/peakflow-helper`), { entitlements: HELPER_ENTITLEMENTS, hardenedRuntime: true, timestamp: 'none' })
assert.equal(wrapped.optionsForFile(app).entitlements, main)
assert.equal(wrapped.optionsForFile(`${app}/Contents/Frameworks/PeakFlow Helper (Renderer).app`).entitlements, inherit)
assert.equal(wrapped.optionsForFile(`${app}/Contents/Resources/peakflow-helper.bak`).entitlements, inherit)

let called = 0
await macSign({ app, identity: undefined, optionsForFile }, async () => { called++ })
assert.equal(called, 0, 'no identity: skip like the default signer')
let seen: any = null
await macSign({ app, identity: 'ABC', optionsForFile }, async (o: any) => { seen = o })
assert.equal(seen.identity, 'ABC')
assert.equal(seen.optionsForFile(`${app}/Contents/Resources/peakflow-helper`).entitlements, HELPER_ENTITLEMENTS)

// The default signer we delegate to still exists in this electron-builder version.
assert.equal(typeof require('app-builder-lib/out/codeSign/macCodeSign').sign, 'function')
console.log('mac-sign check: OK')
