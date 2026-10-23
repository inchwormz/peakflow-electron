/**
 * Windows clipboard: save every format, write PeakFlow's own marked text, and
 * put everything back. Electron's clipboard API can't do this: it only lists
 * a few generic formats, and each write replaces the whole clipboard, so a
 * password manager's "don't record this" formats and images were lost.
 *
 * Win32 through koffi, bound on first use so this file loads on macOS too.
 * NOT RUN ON WINDOWS YET (written 24 Oct 2026 without a Windows test run).
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- koffi is untyped */

import { OWN_WRITE_MARK_WIN } from '../services/clipboard-own-writes'

export interface SavedWinClipboard {
  formats: Array<{ id: number; data: Buffer }>
}

const CF_UNICODETEXT = 13

/**
 * Formats whose data is a plain memory block we can copy byte for byte.
 * Bitmaps, palettes, metafiles, owner-drawn and private formats are handles
 * that would be meaningless once copied; Windows rebuilds the common ones
 * (CF_BITMAP from CF_DIB, for example) from what we do restore.
 */
export function restorableFormat(id: number): boolean {
  if (id === 2 || id === 3 || id === 9 || id === 14) return false // BITMAP, METAFILEPICT, PALETTE, ENHMETAFILE
  if (id === 0x80 || id === 0x82 || id === 0x83 || id === 0x8e) return false // OWNERDISPLAY, DSP*
  if (id >= 0x200 && id <= 0x3ff) return false // PRIVATEFIRST..LAST, GDIOBJFIRST..LAST
  return id > 0
}

let K: any = null
let api: any = null

function bind(): any {
  if (api) return api
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  K = require('koffi')
  const user32 = K.load('user32.dll')
  const kernel32 = K.load('kernel32.dll')
  api = {
    OpenClipboard: user32.func('bool __stdcall OpenClipboard(uintptr_t hWnd)'),
    CloseClipboard: user32.func('bool __stdcall CloseClipboard()'),
    EmptyClipboard: user32.func('bool __stdcall EmptyClipboard()'),
    EnumClipboardFormats: user32.func('uint32_t __stdcall EnumClipboardFormats(uint32_t format)'),
    GetClipboardData: user32.func('void * __stdcall GetClipboardData(uint32_t format)'),
    SetClipboardData: user32.func('void * __stdcall SetClipboardData(uint32_t format, void *hMem)'),
    RegisterClipboardFormatW: user32.func('uint32_t __stdcall RegisterClipboardFormatW(str16 name)'),
    GetClipboardSequenceNumber: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    GlobalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t bytes)'),
    GlobalLock: kernel32.func('void * __stdcall GlobalLock(void *hMem)'),
    GlobalUnlock: kernel32.func('bool __stdcall GlobalUnlock(void *hMem)'),
    GlobalSize: kernel32.func('size_t __stdcall GlobalSize(void *hMem)'),
    GlobalFree: kernel32.func('void * __stdcall GlobalFree(void *hMem)')
  }
  return api
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

/** Copy every restorable format off the clipboard. `null` if the clipboard couldn't be opened. */
export async function saveWinClipboard(hwnd: bigint): Promise<SavedWinClipboard | null> {
  if (!(await open(hwnd))) return null
  const w = bind()
  const formats: SavedWinClipboard['formats'] = []
  try {
    for (let id = w.EnumClipboardFormats(0) as number; id !== 0; id = w.EnumClipboardFormats(id) as number) {
      if (!restorableFormat(id)) continue
      const h = w.GetClipboardData(id)
      if (!h) continue
      const size = Number(w.GlobalSize(h))
      if (!size) {
        formats.push({ id, data: Buffer.alloc(0) })
        continue
      }
      const p = w.GlobalLock(h)
      if (!p) continue
      try {
        formats.push({ id, data: Buffer.from(new Uint8Array(K.view(p, size))) })
      } finally {
        w.GlobalUnlock(h)
      }
    }
  } finally {
    w.CloseClipboard()
  }
  return { formats }
}

/** Put one block of memory on the (open) clipboard. */
function put(id: number, data: Buffer): boolean {
  const w = bind()
  const h = w.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, Math.max(1, data.length))
  if (!h) return false
  const p = w.GlobalLock(h)
  if (!p) {
    w.GlobalFree(h)
    return false
  }
  const view = new Uint8Array(K.view(p, Math.max(1, data.length)))
  view.fill(0)
  view.set(data)
  w.GlobalUnlock(h)
  if (!w.SetClipboardData(id, h)) {
    w.GlobalFree(h) // the clipboard didn't take ownership
    return false
  }
  return true
}

async function replace(hwnd: bigint, entries: Array<{ id: number; data: Buffer }>): Promise<boolean> {
  if (!(await open(hwnd))) return false
  const w = bind()
  try {
    if (!w.EmptyClipboard()) return false
    let ok = true
    for (const e of entries) ok = put(e.id, e.data) && ok
    return ok
  } finally {
    w.CloseClipboard()
  }
}

/**
 * Write `text` marked as PeakFlow's own (and as "keep out of clipboard
 * history" for Windows and other clipboard tools). Returns the clipboard
 * change counter after the write, or `null` if it failed.
 */
export async function writeOwnWinText(hwnd: bigint, text: string): Promise<number | null> {
  const w = bind()
  const zero = Buffer.alloc(4)
  const ok = await replace(hwnd, [
    { id: CF_UNICODETEXT, data: Buffer.from(text + '\0', 'utf16le') },
    { id: w.RegisterClipboardFormatW(OWN_WRITE_MARK_WIN), data: zero },
    { id: w.RegisterClipboardFormatW('ExcludeClipboardContentFromMonitorProcessing'), data: zero },
    { id: w.RegisterClipboardFormatW('CanIncludeInClipboardHistory'), data: zero }, // DWORD 0 = leave out of Win+V history
    { id: w.RegisterClipboardFormatW('CanUploadToCloudClipboard'), data: zero }
  ])
  return ok ? clipboardSequence() : null
}

/** Put back everything `saveWinClipboard` copied. */
export function restoreWinClipboard(hwnd: bigint, saved: SavedWinClipboard): Promise<boolean> {
  return replace(hwnd, saved.formats)
}
