/**
 * Sequential paste queue for QuickBoard.
 * Allows multi-select + paste-one-at-a-time via hotkey.
 *
 * Unlike single-click paste (which goes through simulatePaste with a 500ms
 * window-close delay), queue paste writes directly to clipboard and fires
 * Ctrl+V with a short delay since the user is already in the target app.
 */

import type { ClipboardItem } from './clipboard'
import { getClipboardService } from './clipboard'
import { clipboard, type Tray } from 'electron'
import { simulateCtrlV } from '../native/keyboard'

interface PasteQueue {
  items: ClipboardItem[]
  currentIndex: number
}

let queue: PasteQueue | null = null
let trayRef: Tray | null = null

export function setTrayRef(tray: Tray): void {
  trayRef = tray
}

export function startQueue(itemIds: string[]): void {
  const svc = getClipboardService()
  const history = svc.getHistory()
  const items = itemIds
    .map((id) => history.find((h) => h.id === id))
    .filter((h): h is ClipboardItem => h !== undefined)
  if (items.length < 2) {
    console.warn(`[QuickBoard] Queue rejected: need 2+ items, got ${items.length}`)
    return
  }
  queue = { items, currentIndex: 0 }
  console.log(`[QuickBoard] Queue started with ${items.length} items`)
  updateTrayTooltip()
}

export function pasteNext(): boolean {
  if (!queue || queue.currentIndex >= queue.items.length) {
    cancelQueue()
    return false
  }
  const item = queue.items[queue.currentIndex]
  console.log(`[QuickBoard] Queue paste ${queue.currentIndex + 1}/${queue.items.length}: ${item.id}`)

  // Write directly to clipboard (bypass simulatePaste's 500ms window-close delay)
  const text = item.editedText ?? item.text ?? ''
  if (item.type === 'text' && text) {
    clipboard.writeText(text)
  } else if (item.type === 'image' && item.imagePath) {
    const svc = getClipboardService()
    svc.writeImage(item.imagePath)
  }

  // Update usage count
  const svc = getClipboardService()
  const liveItem = svc.getHistory().find((h) => h.id === item.id)
  if (liveItem) {
    liveItem.copyCount += 1
    liveItem.timestamp = new Date().toISOString()
  }

  // Short delay for clipboard to settle, then paste (user is already in target app)
  setTimeout(() => {
    const ok = simulateCtrlV()
    console.log(`[QuickBoard] Queue Ctrl+V ${ok ? 'sent' : 'FAILED'}`)
  }, 80)

  queue.currentIndex++
  updateTrayTooltip()

  if (queue.currentIndex >= queue.items.length) {
    setTimeout(() => cancelQueue(), 600)
  }
  return true
}

export function cancelQueue(): void {
  queue = null
  if (trayRef) trayRef.setToolTip('PeakFlow')
}

export function isQueueActive(): boolean {
  return queue !== null
}

export function getQueueStatus(): { active: boolean; current: number; total: number } {
  if (!queue) return { active: false, current: 0, total: 0 }
  return {
    active: true,
    current: queue.currentIndex + 1,
    total: queue.items.length
  }
}

function updateTrayTooltip(): void {
  if (!trayRef || !queue) return
  trayRef.setToolTip(`PeakFlow — Pasting ${queue.currentIndex + 1} of ${queue.items.length}`)
}
