/**
 * Check: excluded apps match whole names only (S9), link previews refuse
 * private and local addresses (S8), and PeakFlow's own clipboard writes and
 * round trips are recognised (B4).
 * Run: node scripts/checks/clipboard-privacy.check.mts
 */
import assert from 'node:assert/strict'
import { isExcludedApp } from '../../src/main/security/excluded-apps.ts'
import { isPublicAddress, previewableUrl, guardedLookup } from '../../src/main/services/link-preview-guard.ts'
import { isOwnWrite, isCapturePaused, withCapturePaused, MAX_PAUSE_MS, OWN_WRITE_MARK_MAC, OWN_WRITE_MARK_WIN } from '../../src/main/services/clipboard-own-writes.ts'

// ─── S9: whole names, not substrings ────────────────────────────────────────
for (const t of ['Purchase order.docx - Word', 'Goalkeeper training - YouTube', 'Bookkeeper notes', 'Danz studio', 'Basbase', 'Westpacific travel', 'kiwibanking-ideas.txt']) {
  assert.equal(isExcludedApp(t), false, `not excluded: ${t}`)
}
for (const t of ['Chase Online - Google Chrome', 'ANZ Internet Banking', 'ASB FastNet Classic', 'BNZ - Internet Banking', 'Westpac One', 'Kiwibank | Internet banking', '1Password', 'Bitwarden', 'KeePassXC', 'Bank of America | Online Banking', 'Windows Security']) {
  assert.equal(isExcludedApp(t), true, `excluded: ${t}`)
}
assert.equal(isExcludedApp('', 'com.1password.1password'), true, 'Mac bundle ID')
assert.equal(isExcludedApp('Vault', '1Password.exe'), true, 'Windows exe name')
assert.equal(isExcludedApp('Notes', 'com.apple.Notes'), false)
assert.equal(isExcludedApp('', null), false)

// ─── S8: link previews stay on the public internet ──────────────────────────
for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
  '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1', '64:ff9b::a00:1', '[::1]', 'nonsense']) {
  assert.equal(isPublicAddress(a), false, `private: ${a}`)
}
for (const a of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
  assert.equal(isPublicAddress(a), true, `public: ${a}`)
}
for (const u of ['http://localhost/', 'http://router/', 'http://192.168.1.1/admin', 'http://[::1]:80/', 'http://2130706433/', 'http://0x7f.1/', 'http://printer.local/', 'http://nas.lan/',
  'http://example.com:8080/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com/', 'not a url']) {
  assert.equal(previewableUrl(u), null, `refused: ${u}`)
}
assert.ok(previewableUrl('https://www.anz.co.nz/personal/'))
assert.ok(previewableUrl('http://1.1.1.1/'))

// The connect-time lookup refuses a name if any address is private
const fake = (addrs: Array<{ address: string; family: number }>) => (_h: string, cb: (e: NodeJS.ErrnoException | null, a: Array<{ address: string; family: number }>) => void) => cb(null, addrs)
const run = (addrs: Array<{ address: string; family: number }>, all: boolean) => new Promise<{ err: unknown; res: unknown }>((r) => guardedLookup(fake(addrs))('x.example', { all }, (err, res) => r({ err, res })))
assert.ok((await run([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }], false)).err, 'mixed answer refused')
assert.ok((await run([], true)).err, 'empty answer refused')
assert.equal((await run([{ address: '93.184.216.34', family: 4 }], false)).res, '93.184.216.34')
assert.deepEqual((await run([{ address: '93.184.216.34', family: 4 }], true)).res, [{ address: '93.184.216.34', family: 4 }])

// ─── B4: own writes and paused capture ──────────────────────────────────────
const on = (...f: string[]) => (x: string) => f.includes(x)
assert.equal(isOwnWrite(on('public.utf8-plain-text', OWN_WRITE_MARK_MAC)), true)
assert.equal(isOwnWrite(on(OWN_WRITE_MARK_WIN)), true)
assert.equal(isOwnWrite(on('public.utf8-plain-text', 'org.nspasteboard.ConcealedType')), false, 'a password manager clip is not ours')
assert.equal(isOwnWrite(() => { throw new Error('x') }), false)

assert.equal(isCapturePaused(), false)
let inside = false
await withCapturePaused(async () => {
  inside = isCapturePaused()
  await withCapturePaused(async () => assert.equal(isCapturePaused(), true, 'nested'))
  assert.equal(isCapturePaused(), true, 'outer hold still on')
})
assert.equal(inside, true)
assert.equal(isCapturePaused(), false, 'released')
await assert.rejects(withCapturePaused(async () => { throw new Error('boom') }))
assert.equal(isCapturePaused(), false, 'released after an error')
let stuck = false
void withCapturePaused(() => new Promise<void>(() => { stuck = true }))
assert.equal(stuck && isCapturePaused(), true)
assert.equal(isCapturePaused(Date.now() + MAX_PAUSE_MS + 1), false, 'a stuck pause lifts itself')

console.log('clipboard-privacy: ok')
