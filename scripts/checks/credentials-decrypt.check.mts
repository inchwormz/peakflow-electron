/**
 * Check (review S2): when the Keychain says no (the customer clicked Deny on
 * the "PeakFlow Safe Storage" prompt after an unsigned update), a saved secret
 * comes back as nothing, never as its scrambled text. Plain text saved by a
 * build without encryption still reads back. Real credentials.ts, fake storage.
 * Run: node scripts/checks/credentials-decrypt.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

const g = globalThis as unknown as { __pf: { m: Map<string, unknown>; deny: boolean } }
g.__pf = { m: new Map(), deny: false }
installTsHooks({
  'electron-store': fake(`export default class {
    get(k) { return globalThis.__pf.m.get(k) } set(k, v) { globalThis.__pf.m.set(k, v) }
    has(k) { return globalThis.__pf.m.has(k) } delete(k) { globalThis.__pf.m.delete(k) } }`),
  // Shaped like the real thing: base64 of "v10" + ciphertext; Deny makes decrypt fail
  './safe-storage': fake(`export const isAvailable = () => true
    export const encryptString = (s) => Buffer.from('v10' + s).toString('base64')
    export const decryptString = (b) => {
      if (globalThis.__pf.deny) return null
      const t = Buffer.from(b, 'base64').toString()
      return t.startsWith('v10') ? t.slice(3) : null
    }`)
})
console.warn = () => {}
const { storeCredential, getCredential, looksEncrypted } = await import(srcUrl('src/main/security/credentials.ts'))

assert.equal(storeCredential('license', 'key', 'ABCD-1234'), true)
assert.equal(getCredential('license', 'key'), 'ABCD-1234', 'reads back normally')

g.__pf.deny = true
assert.equal(getCredential('license', 'key'), null, 'Deny: nothing, not the scrambled text')

// A dictation key saved in plain text by a dev build is still returned
g.__pf.m.set('PeakFlow_Dictation_openai_key', 'plain-key-123')
assert.equal(getCredential('Dictation', 'openai_key'), 'plain-key-123')

// Windows DPAPI blobs and the v10/v11 prefixes count as encrypted
assert.equal(looksEncrypted(Buffer.from('v10xyz').toString('base64')), true)
assert.equal(looksEncrypted(Buffer.from('v11xyz').toString('base64')), true)
assert.equal(looksEncrypted(Buffer.from([1, 0, 0, 0, 0xd0, 0x8c, 0x9d, 0xdf, 1, 21]).toString('base64')), true)
assert.equal(looksEncrypted('ABCD-1234'), false)
assert.equal(looksEncrypted('{"access_token":"x"}'), false)

console.log('credentials-decrypt: ok')
