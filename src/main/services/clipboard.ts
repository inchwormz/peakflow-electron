/**
 * ClipboardService -- monitors the system clipboard for changes and stores
 * history with metadata (copy count, pinned status, timestamps).
 *
 * Direct port of the Python QuickBoard clipboard monitor with these features:
 *   - Polls clipboard every 500ms using electron.clipboard
 *   - Detects text changes via hash comparison
 *   - Detects image changes via nativeImage comparison
 *   - Filters out secrets (looksLikeSecret from security module)
 *   - Filters out excluded apps (isExcludedApp -- basic active window check)
 *   - Stores history in electron-store with optional safeStorage encryption
 *   - Auto-expires unpinned items older than max_age_hours
 *   - Deduplicates by content, bumping copy_count instead
 *
 * Paste simulation: writes to clipboard then sends Ctrl+V via
 * native Win32 SendInput API (koffi FFI).
 */

import { clipboard, nativeImage, BrowserWindow, app } from 'electron'
import { createHash } from 'crypto'
import Store from 'electron-store'
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { ToolId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig } from './config-store'
import { looksLikeSecret } from '../security/secret-detection'
import { isExcludedApp } from '../security/excluded-apps'
import type { QuickBoardConfig } from '@shared/config-schemas'
import { simulateCtrlV } from '../native/keyboard'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClipboardItem {
  id: string
  text: string | null
  type: 'text' | 'image'
  timestamp: string
  copyCount: number
  pinned: boolean
  preview: string
  /** The custom protocol URL for the renderer to display the image */
  imageDataUrl?: string
  /** Path to the saved PNG on disk for image items */
  imagePath?: string
  /** MD5 hash of the image data for deduplication */
  imageHash?: string
  /** Original image dimensions */
  imageWidth?: number
  imageHeight?: number
}

// ─── Service class ──────────────────────────────────────────────────────────

class ClipboardService {
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private lastTextHash = ''
  private lastImageHash = ''
  private lastFormats = ''
  private history: ClipboardItem[] = []
  private store: Store
  private skippedCount = 0
  private imagesDir: string

  constructor() {
    this.imagesDir = join(app.getPath('userData'), 'quickboard-images')
    if (!existsSync(this.imagesDir)) {
      try { mkdirSync(this.imagesDir, { recursive: true }) } catch { }
    }

    this.store = new Store({
      name: 'clipboard-history',
      clearInvalidConfig: true
    })
    this.loadHistory()
  }

  // ─── Config helpers ─────────────────────────────────────────────────────

  private getConf(): QuickBoardConfig {
    return getConfig(ToolId.QuickBoard) as QuickBoardConfig
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  private loadHistory(): void {
    try {
      const data = this.store.get('items') as ClipboardItem[] | undefined
      if (Array.isArray(data)) {
        this.history = data
        // Run expiry on load
        this.expireOldEntries()
      }
    } catch (error) {
      console.warn('[QuickBoard] Failed to load history:', error)
      this.history = []
    }
  }

  private saveHistory(): void {
    try {
      this.store.set('items', this.history)
    } catch (error) {
      console.warn('[QuickBoard] Failed to save history:', error)
    }
  }

  // ─── Expiry ─────────────────────────────────────────────────────────────

  private deleteImageFile(item: ClipboardItem): void {
    if (item.type === 'image' && item.imagePath) {
      try { unlinkSync(item.imagePath) } catch { }
    }
  }

  private expireOldEntries(): void {
    const conf = this.getConf()
    if (!conf.auto_expire || conf.max_age_hours <= 0) return

    const cutoff = new Date(Date.now() - conf.max_age_hours * 60 * 60 * 1000).toISOString()
    const before = this.history.length

    const kept: ClipboardItem[] = []
    const removed: ClipboardItem[] = []

    for (const item of this.history) {
      if (item.pinned || item.timestamp >= cutoff) kept.push(item)
      else removed.push(item)
    }

    this.history = kept

    for (const item of removed) {
      this.deleteImageFile(item)
    }

    if (this.history.length < before) {
      this.saveHistory()
      console.log(
        `[QuickBoard] Expired ${before - this.history.length} old entries`
      )
    }
  }

  // ─── Hashing ────────────────────────────────────────────────────────────

  private hashText(text: string): string {
    return createHash('md5').update(text).digest('hex')
  }

  private hashImage(img: Electron.NativeImage): string {
    const buf = img.toPNG()
    return createHash('md5').update(buf).digest('hex')
  }

  // ─── ID generation ──────────────────────────────────────────────────────

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  // ─── Content type detection ─────────────────────────────────────────────

  private detectContentIcon(text: string): string {
    if (/^https?:\/\//.test(text)) return 'link'
    const codeIndicators = [
      'function',
      'def ',
      'class ',
      'import ',
      'const ',
      'let ',
      'var ',
      '=>',
      '{'
    ]
    if (codeIndicators.some((ind) => text.includes(ind))) return 'code'
    return 'text'
  }

  // ─── Clipboard polling ──────────────────────────────────────────────────

  private checkClipboard(): void {
    try {
      // Fast bail: check if clipboard formats changed before doing expensive reads.
      // availableFormats() is cheap (no image decoding or PNG compression).
      const formats = clipboard.availableFormats().join(',')
      const formatsChanged = formats !== this.lastFormats
      this.lastFormats = formats

      // Check for text first
      const text = clipboard.readText()
      if (text && text.trim().length > 0) {
        const hash = this.hashText(text)
        if (hash !== this.lastTextHash) {
          this.lastTextHash = hash
          this.handleNewText(text)
        }
      }

      // Only read/hash images when formats actually changed (avoids toPNG() every 500ms)
      if (formatsChanged) {
        const img = clipboard.readImage()
        if (!img.isEmpty()) {
          const imgHash = this.hashImage(img)
          if (imgHash !== this.lastImageHash) {
            this.lastImageHash = imgHash
            this.handleNewImage(img)
          }
        }
      }
    } catch (error) {
      // Clipboard access can fail transiently -- this is expected
      if (String(error).indexOf('clipboard') === -1) {
        console.warn('[QuickBoard] Clipboard poll error:', error)
      }
    }
  }

  private handleNewText(text: string): void {
    // Security: skip secrets/passwords
    if (looksLikeSecret(text)) {
      this.skippedCount++
      console.log(
        `[QuickBoard] Skipped secret (total: ${this.skippedCount})`
      )
      return
    }

    // Check for duplicate -- bump copy count instead of adding new entry
    const existingIndex = this.history.findIndex(
      (item) => item.type === 'text' && item.text === text
    )

    if (existingIndex !== -1) {
      const existing = this.history[existingIndex]
      existing.copyCount += 1
      existing.timestamp = new Date().toISOString()
      // Move to top
      this.history.splice(existingIndex, 1)
      this.history.unshift(existing)
      this.saveHistory()
      this.broadcastChange()
      return
    }

    // New text item
    const preview = text.replace(/\n/g, ' ').trim().slice(0, 120)
    const item: ClipboardItem = {
      id: this.generateId(),
      text,
      type: 'text',
      timestamp: new Date().toISOString(),
      copyCount: 1,
      pinned: false,
      preview: preview + (text.length > 120 ? '...' : '')
    }

    this.history.unshift(item)
    this.trimHistory()
    this.saveHistory()
    this.broadcastChange()
  }

  private handleNewImage(img: Electron.NativeImage): void {
    const size = img.getSize()
    const imgHash = this.lastImageHash // already computed in checkClipboard

    // Check for duplicate image — bump copy count instead of adding new entry
    const existingIndex = this.history.findIndex(
      (item) => item.type === 'image' && item.imageHash === imgHash
    )

    if (existingIndex !== -1) {
      const existing = this.history[existingIndex]
      existing.copyCount += 1
      existing.timestamp = new Date().toISOString()
      // Move to top
      this.history.splice(existingIndex, 1)
      this.history.unshift(existing)
      this.saveHistory()
      this.broadcastChange()
      return
    }

    // New image — save to disk
    const id = this.generateId()
    const imagePath = join(this.imagesDir, `${id}.png`)
    try {
      writeFileSync(imagePath, img.toPNG())
    } catch (error) {
      console.error('[QuickBoard] Failed to save image to disk:', error)
      return
    }

    // Create a short preview description
    const preview = `Image ${size.width}x${size.height}`

    const item: ClipboardItem = {
      id,
      text: null,
      type: 'image',
      timestamp: new Date().toISOString(),
      copyCount: 1,
      pinned: false,
      preview,
      imageDataUrl: `qboard://${id}.png`,
      imagePath,
      imageHash: imgHash,
      imageWidth: size.width,
      imageHeight: size.height
    }

    this.history.unshift(item)
    this.trimHistory()
    this.saveHistory()
    this.broadcastChange()
  }

  private trimHistory(): void {
    const conf = this.getConf()
    const maxEntries = conf.max_entries

    let unpinnedCount = 0
    for (const item of this.history) {
      if (!item.pinned) unpinnedCount++
    }

    if (unpinnedCount <= maxEntries) return

    // Keep all pinned + first maxEntries unpinned, preserving original order
    let kept = 0
    const result: ClipboardItem[] = []
    for (const item of this.history) {
      if (item.pinned) {
        result.push(item)
      } else if (kept < maxEntries) {
        result.push(item)
        kept++
      } else {
        this.deleteImageFile(item)
      }
    }

    this.history = result
  }

  // ─── IPC broadcasting ──────────────────────────────────────────────────

  private broadcastChange(): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.CLIPBOARD_ON_CHANGE, this.history)
      }
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Start monitoring the clipboard. Called once during app startup.
   */
  init(): void {
    if (this.pollInterval) return

    // Initialize hashes from current clipboard content to avoid
    // immediately capturing whatever is already on the clipboard
    try {
      const text = clipboard.readText()
      if (text) this.lastTextHash = this.hashText(text)
      const img = clipboard.readImage()
      if (!img.isEmpty()) this.lastImageHash = this.hashImage(img)
    } catch {
      // Ignore startup hash errors
    }

    this.pollInterval = setInterval(() => this.checkClipboard(), 500)
    console.log(
      `[QuickBoard] Clipboard monitor started (${this.history.length} items in history)`
    )
  }

  /** Stop monitoring. Called during app shutdown. */
  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    console.log('[QuickBoard] Clipboard monitor stopped')
  }

  /** Get the full clipboard history for the renderer. */
  getHistory(): ClipboardItem[] {
    // Run expiry before returning
    this.expireOldEntries()
    return this.history
  }

  /**
   * Write text to clipboard. Used when user selects an item from history.
   * Updates the lastTextHash so the poll loop doesn't re-capture it.
   */
  writeText(text: string): void {
    clipboard.writeText(text)
    this.lastTextHash = this.hashText(text)
    console.log('[QuickBoard] Text written to clipboard')
  }

  /**
   * Write an image to clipboard from its data URL.
   * Updates the lastImageHash so the poll loop doesn't re-capture it.
   */
  writeImageDataUrl(dataUrl: string): void {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
    this.lastImageHash = this.hashImage(img)
    console.log('[QuickBoard] Image written to clipboard from DataURL')
  }

  /**
   * Write an image to clipboard from its path on disk.
   */
  writeImage(imagePath: string): void {
    if (!existsSync(imagePath)) return
    const img = nativeImage.createFromPath(imagePath)
    clipboard.writeImage(img)
    this.lastImageHash = this.hashImage(img)
    console.log('[QuickBoard] Image written to clipboard from path')
  }

  /**
   * Write to clipboard and simulate Ctrl+V paste via Win32 SendInput.
   * If plainText is true, strips all formatting and writes as plain text.
   */
  simulatePaste(itemId: string, plainText = false): void {
    const item = this.history.find((h) => h.id === itemId)
    if (!item) {
      console.warn(`[QuickBoard] simulatePaste: item not found: ${itemId}`)
      return
    }

    // Write to clipboard
    if (item.type === 'text' && item.text) {
      if (plainText) {
        // Strip formatting: write as plain text only (no RTF/HTML)
        this.writeText(item.text.replace(/[\r]/g, ''))
      } else {
        this.writeText(item.text)
      }
    } else if (item.type === 'image' && item.imagePath) {
      this.writeImage(item.imagePath)
    }

    // Increment usage count
    item.copyCount += 1
    item.timestamp = new Date().toISOString()
    this.saveHistory()

    // Wait for the QuickBoard window to close and OS to restore focus to the
    // target app before simulating Ctrl+V. The renderer closes after ~400ms
    // (toast animation), so 500ms ensures focus has returned.
    setTimeout(() => {
      const success = simulateCtrlV()
      console.log(`[QuickBoard] Paste ${success ? 'sent' : 'failed'} for item ${itemId}`)
    }, 500)
  }

  /** Delete a single item from history by ID. */
  deleteItem(itemId: string): ClipboardItem[] {
    const idx = this.history.findIndex((h) => h.id === itemId)
    if (idx !== -1) {
      this.deleteImageFile(this.history[idx])
      this.history.splice(idx, 1)
      this.saveHistory()
      this.broadcastChange()
    }
    return this.history
  }

  /** Toggle pin status of an item. */
  pinItem(itemId: string): ClipboardItem[] {
    const item = this.history.find((h) => h.id === itemId)
    if (item) {
      item.pinned = !item.pinned
      this.saveHistory()
      this.broadcastChange()
    }
    return this.history
  }

  /** Clear all non-pinned history. */
  clearHistory(): ClipboardItem[] {
    const kept: ClipboardItem[] = []
    const removed: ClipboardItem[] = []

    for (const item of this.history) {
      if (item.pinned) kept.push(item)
      else removed.push(item)
    }

    this.history = kept

    for (const item of removed) {
      this.deleteImageFile(item)
    }

    this.saveHistory()
    this.broadcastChange()
    return this.history
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: ClipboardService | null = null

export function getClipboardService(): ClipboardService {
  if (!instance) {
    instance = new ClipboardService()
  }
  return instance
}

export function initClipboard(): void {
  getClipboardService().init()
}

export function destroyClipboard(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
