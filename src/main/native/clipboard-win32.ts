/**
 * Windows clipboard: save every format, write PeakFlow's own marked text, and
 * put everything back. Electron's clipboard API can't do this: it only lists
 * a few generic formats, and each write replaces the whole clipboard, so a
 * password manager's "don't record this" formats and images were lost.
 *
 * Rules that keep a password manager's clip private and the person's
 * clipboard intact:
 *   - Save and replace happen in one OpenClipboard session, so nothing can
 *     change in between.
 *   - If any format can't be saved, nothing is replaced (the round trip is
 *     refused), so a restore can never come back without its privacy marker.
 *   - Every memory block is allocated before the clipboard is emptied; if
 *     putting any of them on the clipboard fails, the clipboard is emptied
 *     rather than left holding text without its marker.
 *   - Our write carries a one-off token; the restore checks, while holding
 *     the clipboard, that the token is still there, so a copy made meanwhile
 *     is never overwritten.
 *
 * Win32 through koffi, bound on first use so this file loads on macOS too.
 * NOT RUN ON WINDOWS YET (written 24 Oct 2026 without a Windows test run).
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- koffi is untyped */

import { randomBytes } from 'crypto'
import { OWN_WRITE_MARK_WIN } from '../services/clipboard-own-writes'

export interface SavedWinClipboard {
  /** Memory-block formats, copied byte for byte */
  formats: Array<{ id: number; data: Buffer }>
  /** Enhanced metafile (vector pictures from Office and others), as its file bytes */
  emf: Buffer | null
}

const CF_BITMAP = 2
const CF_METAFILEPICT = 3
const CF_PALETTE = 9
const CF_UNICODETEXT = 13
const CF_ENHMETAFILE = 14
const CF_DIB = 8
const CF_DIBV5 = 17

/**
 * How each format present on the clipboard is saved:
 *   'copy'   a memory block, copied byte for byte
 *   'emf'    an enhanced metafile, saved through its own API
 *   'skip'   Windows rebuilds it from a format we do save (bitmap and palette
 *            from a DIB, the old metafile picture from the enhanced metafile)
 *   'refuse' can't be saved; the round trip is refused so nothing is lost
 */
export function saveMethod(id: number, present: ReadonlySet<number>): 'copy' | 'emf' | 'skip' | 'refuse' {
  const hasDib = present.has(CF_DIB) || present.has(CF_DIBV5)
  if (id === CF_BITMAP || id === CF_PALETTE) return hasDib ? 'skip' : 'refuse'
  if (id === CF_METAFILEPICT) return present.has(CF_ENHMETAFILE) ? 'skip' : 'refuse'
  if (id === CF_ENHMETAFILE) return 'emf'
  if (id === 0x80 || id === 0x82 || id === 0x83 || id === 0x8e) return 'refuse' // owner-drawn display formats
  if (id >= 0x200 && id <= 0x3ff) return 'refuse' // private and GDI-object formats
  return id > 0 ? 'copy' : 'refuse'
}

let K: any = null
let api: any = null

function bind(): any {
  if (api) return api
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  K = require('koffi')
  const user32 = K.load('user32.dll')
  const kernel32 = K.load('kernel32.dll')
  const gdi32 = K.load('gdi32.dll')
  api = {
    OpenClipboard: user32.func('bool __stdcall OpenClipboard(uintptr_t hWnd)'),
    CloseClipboard: user32.func('bool __stdcall CloseClipboard()'),
    EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()'),
    EnumClipboardFormats: user32.func('uint32_t __stdcall EnumClipboardFormats(uint32_t format)'),
    CountClipboardFormats: user32.func('int __stdcall CountClipboardFormats()'),
    GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32_t format)'),
    SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32_t format, void *hMem)'),
    RegisterClipboardFormatW: user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)'),
    GetClipboardSequenceNumber: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
    GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *hMem)'),
    GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void *hMem)'),
    GlobalSize: kernel32.func('size_t __stdcall GlobalSize(void *hMem)'),
    GlobalFree: kernel32.func('void * __stdcall GlobalFree(void *hMem)'),
    GetEnhMetaFileBits: gdi32.func('uint32_t __stdcall GetEnhMetaFileBits(void *hEmf, uint32_t size, _Out_ uint8_t *data)'),
    SetEnhMetaFileBits: gdi32.func('void * __stdcall SetEnhMetaFileBits(uint32_t size, const uint8_t *data)'),
    DeleteEnhMetaFile: gdi32.func('bool __stdcall DeleteEnhMetaFile(void *hEmf)')
  }
  return api
}

/** Checks only: swap in a simulated Win32 clipboard (scripts/checks/clipboard-privacy.check.mts). */
export function _useFakeWin32ForChecks(fakeApi: unknown, fakeKoffi: unknown): void {
  api = fakeApi
  K = fakeKoffi
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Open the clipboard for `hwnd`, retrying while another app holds it. */
async function open(hwnd: bigint): Promise<boolean> {
  const w = bind()
  for (let i = 0; i < 10; i++) {
    if (w.OpenClipboard(hwnd)) return true
    await sleep(20)
  }
  return false
}

/** The clipboard's change counter. */
export function clipboardSequence(): number {
  return bind().GetClipboardSequenceNumber() as number
}

/** Copy everything off the (open) clipboard, or `null` if any of it can't be saved. */
function snapshot(): SavedWinClipboard | null {
  const w = bind()
  const ids: number[] = []
  for (let id = w.EnumClipboardFormats(0) as number; id !== 0; id = w.EnumClipboardFormats(id) as number) ids.push(id)
  // EnumClipboardFormats also returns 0 on failure: a short list could be missing a privacy marker
  if (ids.length !== (w.CountClipboardFormats() as number)) return null
  const present = new Set(ids)
  const saved: SavedWinClipboard = { formats: [], emf: null }
  for (const id of ids) {
    const how = saveMethod(id, present)
    if (how === 'skip') continue
    if (how === 'refuse') return null
    const h = w.GetClipboardData(id)
    if (!h) return null
    if (how === 'emf') {
      const size = w.GetEnhMetaFileBits(h, 0, null) as number
      if (!size) return null
      const buf = Buffer.alloc(size)
      if ((w.GetEnhMetaFileBits(h, size, buf) as number) !== size) return null
      saved.emf = buf
      continue
    }
    const size = Number(w.GlobalSize(h))
    if (!size) return null // unreadable or discarded: refuse rather than save it as empty
    const p = w.GlobalLock(h)
    if (!p) return null
    try {
      saved.formats.push({ id, data: Buffer.from(new Uint8Array(K.view(p, size))) })
    } finally {
      w.GlobalUnlock(h)
    }
  }
  return saved
}

type Block = { id: number; h: unknown; emf?: boolean }

function release(blocks: Block[]): void {
  const w = bind()
  for (const b of blocks) {
    if (b.emf) w.DeleteEnhMetaFile(b.h)
    else w.GlobalFree(b.h)
  }
}

/** Allocate every block first; `null` (with everything freed) if any allocation fails. */
function allocate(saved: SavedWinClipboard): Block[] | null {
  const w = bind()
  const blocks: Block[] = []
  const free = (): null => {
    release(blocks)
    return null
  }
  for (const { id, data } of saved.formats) {
    const n = Math.max(1, data.length)
    const h = w.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, n)
    if (!h) return free()
    const p = w.GlobalLock(h)
    if (!p) {
      w.GlobalFree(h)
      return free()
    }
    const view = new Uint8Array(K.view(p, n))
    view.fill(0)
    view.set(data)
    w.GlobalUnlock(h)
    blocks.push({ id, h })
  }
  if (saved.emf) {
    const h = w.SetEnhMetaFileBits(saved.emf.length, saved.emf)
    if (!h) return free()
    blocks.push({ id: CF_ENHMETAFILE, h, emf: true })
  }
  return blocks
}

/**
 * Empty the (open) clipboard and put `blocks` on it. If any block is refused,
 * empty it again: better an empty clipboard than text without its marker.
 */
function install(blocks: Block[]): boolean {
  const w = bind()
  if (!w.EmptyClipboard()) {
    release(blocks)
    return false
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (!w.SetClipboardData(b.id, b.h)) {
      // The clipboard owns the blocks already set; free the rest and clear it
      release(blocks.slice(i))
      w.EmptyClipboard()
      return false
    }
  }
  return true
}

/** Identifies one of our writes: the random token in its marker, and the change counter just after it. */
export interface OwnWriteStamp {
  token: Buffer
  sequence: number
}

/** `true` if the (open) clipboard still holds the write with this token. */
function holdsToken(token: Buffer): boolean {
  const w = bind()
  const h = w.GetClipboardData(w.RegisterClipboardFormatW(OWN_WRITE_MARK_WIN) as number)
  if (!h || Number(w.GlobalSize(h)) < token.length) return false
  const p = w.GlobalLock(h)
  if (!p) return false
  try {
    return Buffer.from(new Uint8Array(K.view(p, token.length))).equals(token)
  } finally {
    w.GlobalUnlock(h)
  }
}

/**
 * In one clipboard session: save everything, then replace it with `text`
 * marked as PeakFlow's own (and as "keep out of clipboard history" for
 * Windows and other clipboard tools). `null` if anything couldn't be saved
 * or written; the clipboard is then left as it was (or, if a write failed
 * part-way, empty).
 */
export async function saveAndWriteOwnText(hwnd: bigint, text: string): Promise<{ saved: SavedWinClipboard; stamp: OwnWriteStamp } | null> {
  if (!(await open(hwnd))) return null
  const w = bind()
  const token = randomBytes(16)
  let result: { saved: SavedWinClipboard } | null = null
  try {
    const saved = snapshot()
    if (!saved) return null
    const zero = Buffer.alloc(4)
    const blocks = allocate({
      emf: null,
      formats: [
        // Markers first, text last
        { id: w.RegisterClipboardFormatW(OWN_WRITE_MARK_WIN) as number, data: token },
        { id: w.RegisterClipboardFormatW('ExcludeClipboardContentFromMonitorProcessing') as number, data: zero },
        { id: w.RegisterClipboardFormatW('CanIncludeInClipboardHistory') as number, data: zero }, // DWORD 0 = leave out of Win+V history
        { id: w.RegisterClipboardFormatW('CanUploadToCloudClipboard') as number, data: zero },
        { id: CF_UNICODETEXT, data: Buffer.from(text + '\0', 'utf16le') }
      ]
    })
    if (!blocks) return null
    // Prepare the way back before touching the clipboard
    const back = allocate(saved)
    if (!back) {
      release(blocks)
      return null
    }
    if (!install(blocks)) {
      // Put the original back; if even that fails, install() has left it empty
      install(back)
      return null
    }
    release(back)
    result = { saved }
  } finally {
    w.CloseClipboard()
  }
  if (!result) return null
  return { saved: result.saved, stamp: { token, sequence: clipboardSequence() } }
}

/**
 * Put back everything `saveAndWriteOwnText` saved. With `stamp`, only if the
 * clipboard still holds our write, checked while holding the clipboard so a
 * copy made meanwhile is never overwritten.
 */
export async function restoreWinClipboard(hwnd: bigint, saved: SavedWinClipboard, stamp?: OwnWriteStamp): Promise<boolean> {
  if (!(await open(hwnd))) return false
  const w = bind()
  try {
    if (stamp && !holdsToken(stamp.token)) return false
    const blocks = allocate(saved)
    return !!blocks && install(blocks)
  } finally {
    w.CloseClipboard()
  }
}
