/**
 * Selected text for the AI actions, and putting an answer back.
 *   macOS: the helper asks the app for its selection through Accessibility,
 *          else copies in that app and puts the clipboard back.
 *   Windows: the bar steps aside, Ctrl+C goes to the app underneath, the
 *          clipboard is read and then put back exactly as it was.
 */

import { clipboard } from 'electron'
import type { SelectionResult } from '@shared/launcher/types'
import { runMacHelper } from '../native/mac-helper'
import { simulateCtrlV } from '../native/keyboard'

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

interface SavedClipboard {
  formats: Array<{ format: string; data: Buffer }>
}

function saveClipboard(): SavedClipboard {
  const formats: SavedClipboard['formats'] = []
  for (const f of clipboard.availableFormats()) {
    try {
      formats.push({ format: f, data: clipboard.readBuffer(f) })
    } catch { /* format can't be read raw */ }
  }
  return { formats }
}

function restoreClipboard(saved: SavedClipboard, fallbackText: string): void {
  clipboard.clear()
  let wrote = false
  for (const { format, data } of saved.formats) {
    try {
      if (data.length) {
        clipboard.writeBuffer(format, data)
        wrote = true
      }
    } catch { /* skip */ }
  }
  if (!wrote && fallbackText) clipboard.writeText(fallbackText)
}

async function winSelection(stepAside: () => void, comeBack: () => void): Promise<SelectionResult> {
  const before = clipboard.readText()
  const saved = saveClipboard()
  stepAside()
  await sleep(150)
  clipboard.writeText('') // so we can tell whether the copy happened
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
    text = clipboard.readText()
  }
  restoreClipboard(saved, before)
  comeBack()
  return { text, trusted: true }
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
      const r = await runMacHelper(['selection'], 3000)
      return { text: typeof r?.text === 'string' ? r.text : '', trusted: r?.trusted !== false }
    } finally {
      holdOpen(false)
      comeBack()
    }
  }
  if (process.platform === 'win32') return winSelection(stepAside, comeBack)
  return { text: '', trusted: true }
}

/** Put text on the clipboard and paste it into the app underneath the bar. */
export async function pasteText(text: string, hideBar: () => void): Promise<boolean> {
  clipboard.writeText(text)
  hideBar()
  await sleep(120)
  return simulateCtrlV()
}
