/**
 * Check (review S12): "Skip this version" hides that version from the
 * automatic check only; a manual check still offers it; progress percent.
 * Run: node scripts/checks/update-offer.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, srcUrl } from './fixtures/ts-hooks.mjs'
installTsHooks()
const { shouldOffer, isNewer, percentOf, macDmgArch } = await import(srcUrl('src/shared/update-offer.ts'))

assert.equal(macDmgArch('arm64', false), 'arm64', 'native Apple silicon gets the arm64 DMG')
assert.equal(macDmgArch('x64', true), 'arm64', 'Rosetta gets the arm64 DMG')
assert.equal(macDmgArch('x64', false), 'x64', 'Intel gets the x64 DMG')

assert.equal(isNewer('2.1.1', '2.1.0'), true)
assert.equal(isNewer('v2.1.0', '2.1.0'), false)
assert.equal(shouldOffer('2.1.1', '2.1.0', null, true), true, 'automatic check offers a new version')
assert.equal(shouldOffer('2.1.1', '2.1.0', '2.1.1', true), false, 'skipped: the 4-hourly check stays quiet')
assert.equal(shouldOffer('2.1.1', '2.1.0', '2.1.1', false), true, 'a manual check still offers it')
assert.equal(shouldOffer('2.1.2', '2.1.0', '2.1.1', true), true, 'the next version is offered again')
assert.equal(shouldOffer('2.1.0', '2.1.0', null, false), false, 'same version: nothing to offer')
assert.equal(shouldOffer(null, '2.1.0', null, false), false)

assert.equal(percentOf(50, 200), 25)
assert.equal(percentOf(200, 200), 100)
assert.equal(percentOf(10, 0), null, 'no Content-Length')
assert.equal(percentOf(300, 200), 100)

console.log('update-offer: ok')
