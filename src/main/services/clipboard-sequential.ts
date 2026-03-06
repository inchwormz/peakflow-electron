/**
 * Sequential paste queue for QuickBoard.
 * Allows multi-select + paste-one-at-a-time via hotkey.
 */

import type { ClipboardItem } from './clipboard'
import { getClipboardService } from './clipboard'
import type { Tray } from 'electron'

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
  if (items.length < 2) return
  queue = { items, currentIndex: 0 }
  updateTrayTooltip()
}

export function pasteNext(): boolean {
  if (!queue || queue.currentIndex >= queue.items.length) {
    cancelQueue()
    return false
  }
  const item = queue.items[queue.currentIndex]
  const svc = getClipboardService()
  svc.simulatePaste(item.id, false)
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
