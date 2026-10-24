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

// ─── B4 Windows: which clipboard formats can be saved (pure logic; no Win32 here) ──
// clipboard-win32.ts imports without a file extension, as the app bundler expects
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(spec + '.ts', ctx)
      throw e
    }
  }
})
const { saveMethod } = await import('../../src/main/native/clipboard-win32.ts')
const set = (...ids: number[]) => new Set(ids)
assert.equal(saveMethod(13, set(13, 1, 7, 16)), 'copy', 'Unicode text')
assert.equal(saveMethod(49300, set(13, 49300)), 'copy', 'a registered format such as a password manager marker')
assert.equal(saveMethod(2, set(2, 8, 17)), 'skip', 'bitmap is rebuilt from the DIB')
assert.equal(saveMethod(2, set(2)), 'refuse', 'bitmap with no DIB')
assert.equal(saveMethod(3, set(3, 14)), 'skip', 'old metafile picture is rebuilt from the enhanced metafile')
assert.equal(saveMethod(14, set(3, 14)), 'emf')
assert.equal(saveMethod(0x80, set(0x80)), 'refuse', 'owner-drawn')
assert.equal(saveMethod(0x250, set(0x250)), 'refuse', 'private format')
console.log('clipboard-privacy (Windows formats): ok')

// ─── B4 Windows: round trips against a simulated Win32 clipboard ─────────────
const win = await import('../../src/main/native/clipboard-win32.ts')
function fakeWin32() {
  // Handles are objects holding a Uint8Array; the clipboard maps format id -> handle
  type H = { mem: Uint8Array; emf?: boolean }
  let board = new Map<number, H>()
  let pending: Map<number, H> | null = null
  let seq = 100
  let isOpen = false
  const names = new Map<string, number>()
  const fail = { setOnCall: -1, enumShort: false, allocOnCall: -1 }
  let setCalls = 0
  let allocCalls = 0
  const api = {
    OpenClipboard: () => (isOpen ? false : (isOpen = true)),
    CloseClipboard: () => { isOpen = false; if (pending) { board = pending; pending = null } return true },
    EmptyClipboard: () => { pending = new Map(); seq++; return true },
    CountClipboardFormats: () => (pending ?? board).size,
    EnumClipboardFormats: (prev: number) => {
      const ids = [...(pending ?? board).keys()]
      if (fail.enumShort && prev !== 0) return 0
      const i = prev === 0 ? 0 : ids.indexOf(prev) + 1
      return ids[i] ?? 0
    },
    GetClipboardData: (id: number) => (pending ?? board).get(id) ?? null,
    SetClipboardData: (id: number, h: H) => {
      if (setCalls++ === fail.setOnCall) return null
      ;(pending ??= new Map(board)).set(id, h)
      seq++
      return h
    },
    RegisterClipboardFormatW: (n: string) => { if (!names.has(n)) names.set(n, 0xc000 + names.size); return names.get(n)! },
    GetClipboardSequenceNumber: () => seq,
    GlobalAlloc: (_f: number, n: number) => (allocCalls++ === fail.allocOnCall ? null : { mem: new Uint8Array(n) }),
    GlobalLock: (h: H) => h,
    GlobalUnlock: () => true,
    GlobalSize: (h: H) => h.mem.length,
    GlobalFree: () => null,
    GetEnhMetaFileBits: (h: H, size: number, out: Buffer | null) => { if (out) out.set(h.mem.subarray(0, size)); return h.mem.length },
    SetEnhMetaFileBits: (n: number, data: Buffer) => ({ mem: Uint8Array.from(data.subarray(0, n)), emf: true }),
    DeleteEnhMetaFile: () => true
  }
  const koffi = { view: (h: H, n: number) => h.mem.buffer.slice(h.mem.byteOffset, h.mem.byteOffset + n) }
  // koffi.view must be writable for allocate(): return the live buffer instead
  koffi.view = (h: H, n: number) => { if (h.mem.length === n && h.mem.byteOffset === 0) return h.mem.buffer; return h.mem.slice(0, n).buffer }
  const put = (id: number, bytes: Uint8Array | string) => board.set(id, { mem: typeof bytes === 'string' ? new Uint8Array(Buffer.from(bytes + '\0', 'utf16le')) : bytes })
  const userCopy = (text: string) => { board = new Map(); seq += 2; put(13, text) }
  const text = () => { const h = board.get(13); return h ? Buffer.from(h.mem).toString('utf16le').replace(/\0+$/, '') : null }
  return { api, koffi, board: () => board, put, userCopy, text, fail, id: (n: string) => api.RegisterClipboardFormatW(n), resetCalls: () => { setCalls = 0 } }
}

{ // A password with its marker, plus an image, comes back whole; our text is marked meanwhile
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'hunter2-password')
  f.put(f.id('ExcludeClipboardContentFromMonitorProcessing'), new Uint8Array(4))
  f.put(8, new Uint8Array([1, 2, 3, 4, 5]))
  f.put(14, new Uint8Array([9, 9, 9]))
  const before = [...f.board().entries()].map(([k, v]) => [k, Buffer.from(v.mem).toString('hex')])
  const t = await win.saveAndWriteOwnText(0n, 'dictated words')
  assert.ok(t, 'round trip allowed')
  assert.equal(f.text(), 'dictated words')
  assert.ok(f.board().has(f.id('PeakFlowOwnWrite')) && f.board().has(f.id('ExcludeClipboardContentFromMonitorProcessing')), 'our write is marked')
  assert.equal(await win.restoreWinClipboard(0n, t!.saved, t!.stamp), true)
  const after = [...f.board().entries()].map(([k, v]) => [k, Buffer.from(v.mem).toString('hex')])
  assert.deepEqual(after, before, 'every format back, byte for byte, marker included')
}
{ // Someone copies during the paste: their copy is kept
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'original')
  const t = await win.saveAndWriteOwnText(0n, 'dictated')
  f.userCopy('copied meanwhile')
  assert.equal(await win.restoreWinClipboard(0n, t!.saved, t!.stamp), false)
  assert.equal(f.text(), 'copied meanwhile')
}
{ // A short format list (enumeration failed) refuses the round trip and leaves the clipboard alone
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'secret')
  f.put(f.id('ExcludeClipboardContentFromMonitorProcessing'), new Uint8Array(4))
  f.fail.enumShort = true
  assert.equal(await win.saveAndWriteOwnText(0n, 'x'), null)
  assert.equal(f.text(), 'secret')
}
{ // An owner-drawn format can't be saved: refused, clipboard untouched
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(0x80, new Uint8Array(1))
  f.put(13, 'keep me')
  assert.equal(await win.saveAndWriteOwnText(0n, 'x'), null)
  assert.equal(f.text(), 'keep me')
}
{ // Writing our text fails part-way: the original goes back
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'original')
  f.fail.setOnCall = 2
  assert.equal(await win.saveAndWriteOwnText(0n, 'dictated'), null)
  assert.equal(f.text(), 'original')
}
{ // A block that reports zero size (unreadable or discarded) refuses the round trip
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'secret')
  f.put(f.id('ExcludeClipboardContentFromMonitorProcessing'), new Uint8Array(0))
  assert.equal(await win.saveAndWriteOwnText(0n, 'x'), null)
  assert.equal(f.text(), 'secret')
}
{ // Not enough memory to prepare the way back: nothing is touched
  const f = fakeWin32()
  win._useFakeWin32ForChecks(f.api, f.koffi)
  f.put(13, 'original')
  f.fail.allocOnCall = 5 // our write takes 5 blocks; the 6th is the copy of the original
  assert.equal(await win.saveAndWriteOwnText(0n, 'dictated'), null)
  assert.equal(f.text(), 'original')
}
console.log('clipboard-privacy (Windows round trips, simulated): ok')
