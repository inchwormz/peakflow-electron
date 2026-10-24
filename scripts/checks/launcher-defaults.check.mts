/**
 * Check (review B6): snippet expansion, and so the Windows keyboard hook,
 * starts off on Windows and on elsewhere. Loads the real launcher store with
 * a fake electron-store.
 * Run: node scripts/checks/launcher-defaults.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'
installTsHooks({
  'electron-store': fake(`export default class {
    constructor(o) { this.m = new Map(Object.entries(o.defaults)) }
    get(k) { return this.m.get(k) } set(k, v) { this.m.set(k, v) } }`)
})
const { defaultExpansion, launcherStore } = await import(srcUrl('src/main/launcher/store.ts'))

assert.equal(defaultExpansion('win32'), false, 'Windows: off until the customer turns it on')
assert.equal(defaultExpansion('darwin'), true, 'Mac: on (the helper’s key watcher has run)')
assert.equal(launcherStore.expansion, defaultExpansion(process.platform), 'the store uses it as its default')
assert.equal(launcherStore.snippets().length, 2, 'the two example snippets are still seeded')

console.log('launcher-defaults: ok')
