/**
 * Selected text for the AI actions, and putting an answer back.
 *   macOS: the helper asks the app for its selection through Accessibility,
 *          else copies in that app and puts the clipboard back.
 *   Windows: the bar steps aside, Ctrl+C goes to the app underneath, the
 *          clipboard is read and then put back exactly as it was.
 * Also pasteAndRestore: the one way dictation, snippets and launcher answers
 * paste, so the clipboard (password-manager markers, images) always comes back.
 */

import { BrowserWindow, clipboard } from 'electron'
import type { HistoryContext } from '../dictation/history'
import type { SelectionResult } from '@shared/launcher/types'
import { runMacHelper } from '../native/mac-helper'
import { simulateCtrlV } from '../native/keyboard'
import { clipboardSequence, restoreWinClipboard, saveAndWriteOwnText } from '../native/clipboard-win32'
import { withCapturePaused } from '../services/clipboard-own-writes'
import { notifyAccessibilityNeeded } from '../services/permissions-darwin'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ─── Windows: Ctrl+C through SendInput (own anonymous structs; keyboard-win32 owns the named ones) ──

let winSend: ((vks: Array<[number, boolean]>) => boolean) | null = null

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- koffi is untyped */
function winKeys(): (vks: Array<[number, boolean]>) => boolean {
  if (winSend) return winSend
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const K = require('koffi')
  const user32 = K.load('user32.dll')
  const KI = K.struct({ wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' })
  const INPUT = K.struct({ type: 'uint32', _p1: 'uint32', ki: KI, _p2: K.array('uint8', 8) })
  const SendInput = user32.func('SendInput', 'uint32', ['uint32', K.pointer(INPUT), 'int'])
  winSend = (vks) => {
    const inputs = vks.map(([vk, up]) => ({ type: 1, _p1: 0, ki: { wVk: vk, wScan: 0, dwFlags: up ? 2 : 0, time: 0, dwExtraInfo: 0 }, _p2: [0, 0, 0, 0, 0, 0, 0, 0] }))
    return SendInput(inputs.length, inputs, K.sizeof(INPUT)) === inputs.length
  }
  return winSend
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

// ─── Clipboard round trips ──────────────────────────────────────────────────

/** A window handle for the Windows clipboard (it needs an owner window to write). */
function ownerHwnd(): bigint {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    try {
      const b = w.getNativeWindowHandle()
      return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))
    } catch { /* try the next window */ }
  }
  return 0n
}

/**
 * One clipboard round trip at a time. Two overlapping ones would lose the
 * person's clipboard: the second would save the first one's text and put
 * that back instead of the original.
 */
let roundTrip: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = roundTrip.then(() => withCapturePaused(fn))
  roundTrip = run.catch(() => {})
  return run
}

/**
 * Paste `text` into the app in front, then put the clipboard back exactly as
 * it was: every format, so a password manager's "don't record this" marker
 * and copied images survive. The text is marked as PeakFlow's own, so
 * QuickBoard (and clipboard managers that honour the standard markers) never
 * record it, and QuickBoard doesn't poll during the round trip. If someone
 * copies something meanwhile, that copy is kept.
 * Resolves false if nothing was pasted. On a Mac without the Accessibility
 * permission the (marked) text stays on the clipboard for a manual paste;
 * in every other failure the clipboard is left alone, never replaced with
 * unmarked text.
 */
export function pasteAndRestore(text: string, privacy?: { capture: (target: HistoryContext) => void }): Promise<boolean> {
  return oneAtATime(async () => {
    if (process.platform === 'darwin') {
      const r = await runMacHelper(privacy ? ['paste-text', 'dictation'] : ['paste-text'], 4000, text)
      if (r?.trusted === false) {
        notifyAccessibilityNeeded('paste')
        return false
      }
      if (privacy) {
        const p = r?.dictationPrivacy as Record<string, unknown> | undefined
        privacy.capture({ app: typeof p?.app === 'string' ? p.app : undefined, appId: typeof p?.bundleId === 'string' ? p.bundleId : undefined, title: typeof p?.title === 'string' ? p.title : undefined, secure: typeof p?.secure === 'boolean' ? p.secure : undefined })
      }
      return r?.ok === true
    }
    if (process.platform === 'win32') {
      const hwnd = ownerHwnd()
      const t = await saveAndWriteOwnText(hwnd, text).catch(() => null)
      if (!t) return false // couldn't save every format: leave the clipboard alone
      const ok = await simulateCtrlV()
      await sleep(400) // give the app time to read the clipboard
      await restoreWinClipboard(hwnd, t.saved, t.stamp).catch(() => false)
      return ok
    }
    return false
  })
}

async function winSelection(stepAside: () => void, comeBack: () => void): Promise<SelectionResult> {
  return oneAtATime(async () => {
    const hwnd = ownerHwnd()
    // Save everything and clear the text, so we can tell whether the copy happened
    const t = await saveAndWriteOwnText(hwnd, '').catch(() => null)
    if (!t) return { text: '', trusted: true } // couldn't save the clipboard: don't touch it
    stepAside()
    await sleep(150)
    const VK_CONTROL = 0x11
    const VK_C = 0x43
    try {
      winKeys()([[VK_CONTROL, false], [VK_C, false], [VK_C, true], [VK_CONTROL, true]])
    } catch (err) {
      console.warn('[Launcher] Ctrl+C failed:', err)
    }
    let text = ''
    for (let i = 0; i < 25 && !text; i++) {
      await sleep(20)
      if (clipboardSequence() !== t.stamp.sequence) text = clipboard.readText()
    }
    // The app's copy replaced our write, so restore without the stamp check
    await restoreWinClipboard(hwnd, t.saved).catch(() => false)
    comeBack()
    return { text, trusted: true }
  })
}

export async function getSelectedText(stepAside: () => void, comeBack: () => void, holdOpen: (on: boolean) => void): Promise<SelectionResult> {
  if (process.platform === 'darwin') {
    // 1. Ask the app through Accessibility: no clipboard, no focus change, the bar stays up
    const ax = await runMacHelper(['selection', 'ax'], 2000)
    if (ax?.trusted === false) return { text: '', trusted: false }
    if (typeof ax?.text === 'string' && ax.text) return { text: ax.text, trusted: true }
    // 2. Browsers and Electron apps don't answer that: step aside so ⌘C reaches the
    //    app underneath (not the bar), copy, put the clipboard back, come back
    holdOpen(true)
    stepAside()
    try {
      await sleep(80)
      // The helper copies and then puts the whole pasteboard back; QuickBoard waits
      const r = await oneAtATime(() => runMacHelper(['selection'], 3000))
      return { text: typeof r?.text === 'string' ? r.text : '', trusted: r?.trusted !== false }
    } finally {
      holdOpen(false)
      comeBack()
    }
  }
  if (process.platform === 'win32') return winSelection(stepAside, comeBack)
  return { text: '', trusted: true }
}

/** Paste text into the app underneath the bar, then put the clipboard back. */
export async function pasteText(text: string, hideBar: () => void): Promise<boolean> {
  hideBar()
  await sleep(120)
  return pasteAndRestore(text)
}
