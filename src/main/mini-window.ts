/**
 * The v2 Liquid Focus mini timer window: size, position and dragging.
 *
 * - Size is a scale of the 220x64 pill (or 272x148 break card), stored as
 *   liquidfocus.mini_size. The window keeps its aspect ratio when resized by an
 *   edge or corner, and the renderer zooms its content to fit.
 * - Position (top-left) is stored as liquidfocus.mini_position and reused when
 *   it is still on a screen; otherwise the mini sits in the bottom-right corner.
 * - The renderer drags the window itself (LIQUIDFOCUS_MINI_MOVE) so a plain
 *   click can still open the panel.
 */

import { BrowserWindow, screen, type Rectangle } from 'electron'
import { ToolId } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'
import { getConfig, setConfig } from './services/config-store'

const BASE = { pill: [220, 64], card: [272, 148] } as const
export const MINI_MIN_SCALE = 0.9
export const MINI_MAX_SCALE = 2.4
const MARGIN = 16

const cards = new WeakMap<BrowserWindow, boolean>()
/** Pending position save per window (moves arrive many times a second while dragging) */
const saveTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>()
const SAVE_DELAY = 300
const wired = new WeakSet<BrowserWindow>()

function conf(): LiquidFocusConfig {
  return getConfig(ToolId.LiquidFocus) as LiquidFocusConfig
}

export function clampScale(s: unknown): number {
  const n = typeof s === 'number' && Number.isFinite(s) ? s : 1.4
  return Math.min(MINI_MAX_SCALE, Math.max(MINI_MIN_SCALE, n))
}

function workAreaFor(b: Rectangle): Rectangle {
  return screen.getDisplayMatching(b).workArea
}

/** Keep a rectangle fully inside the work area of the display it is mostly on. */
function clampToScreen(b: Rectangle): Rectangle {
  const wa = workAreaFor(b)
  return {
    ...b,
    x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width),
    y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height)
  }
}

function savedPositionOnScreen(w: number, h: number): { x: number; y: number } | null {
  const p = conf().mini_position
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  const visible = screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return p.x + w / 2 >= wa.x && p.x + w / 2 <= wa.x + wa.width && p.y + h / 2 >= wa.y && p.y + h / 2 <= wa.y + wa.height
  })
  return visible ? p : null
}

function wire(win: BrowserWindow): void {
  if (wired.has(win)) return
  wired.add(win)
  let timer: ReturnType<typeof setTimeout> | null = null
  // Remember a size the user dragged to (debounced; 'resize' fires throughout)
  win.on('resize', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      const base = cards.get(win) ? BASE.card : BASE.pill
      const scale = Math.round(clampScale(win.getBounds().width / base[0]) * 100) / 100
      if (Math.abs(scale - clampScale(conf().mini_size)) >= 0.02) setConfig(ToolId.LiquidFocus, 'mini_size', scale, { quiet: true })
    }, SAVE_DELAY)
  })
  // macOS sends 'moved' for every step of a drag: save once things settle
  win.on('moved', () => savePositionSoon(win))
  win.on('closed', () => {
    const t = saveTimers.get(win)
    if (t) clearTimeout(t)
  })
}

function savePositionSoon(win: BrowserWindow): void {
  const t = saveTimers.get(win)
  if (t) clearTimeout(t)
  saveTimers.set(win, setTimeout(() => savePosition(win), SAVE_DELAY))
}

function savePosition(win: BrowserWindow): void {
  const t = saveTimers.get(win)
  if (t) clearTimeout(t)
  saveTimers.delete(win)
  if (win.isDestroyed()) return
  const b = win.getBounds()
  const p = conf().mini_position
  if (p && p.x === b.x && p.y === b.y) return
  setConfig(ToolId.LiquidFocus, 'mini_position', { x: b.x, y: b.y }, { quiet: true })
}

/**
 * Size and place the mini for the pill or the break card. A mini already on
 * screen grows or shrinks around its bottom-right corner, so it stays put.
 */
export function layoutMini(win: BrowserWindow, card: boolean): void {
  const apply = (): void => {
    if (win.isDestroyed()) return
    wire(win)
    const scale = clampScale(conf().mini_size)
    const base = card ? BASE.card : BASE.pill
    const w = Math.round(base[0] * scale)
    const h = Math.round(base[1] * scale)
    let x: number
    let y: number
    // Already laid out once: grow/shrink in place. New window: saved spot or the corner.
    if (cards.has(win)) {
      const b = win.getBounds()
      x = b.x + b.width - w
      y = b.y + b.height - h
    } else {
      const saved = savedPositionOnScreen(w, h)
      if (saved) {
        x = saved.x
        y = saved.y
      } else {
        const wa = screen.getPrimaryDisplay().workArea
        x = wa.x + wa.width - w - MARGIN
        y = wa.y + wa.height - h - MARGIN
      }
    }
    cards.set(win, card)
    applyMiniTheme(win)
    win.setResizable(true)
    win.setAspectRatio(base[0] / base[1])
    win.setMinimumSize(Math.round(base[0] * MINI_MIN_SCALE), Math.round(base[1] * MINI_MIN_SCALE))
    win.setMaximumSize(Math.round(base[0] * MINI_MAX_SCALE), Math.round(base[1] * MINI_MAX_SCALE))
    win.setBounds(clampToScreen({ x, y, width: w, height: h }))
    if (!win.isVisible()) win.showInactive()
  }
  if (win.webContents.isLoading()) win.once('ready-to-show', apply)
  else apply()
}

/** The window's own background follows the timer colour, so no dark edge shows behind a light timer. */
export function applyMiniTheme(win: BrowserWindow | undefined | null, theme?: unknown): void {
  if (!win || win.isDestroyed()) return
  const t = theme ?? conf().mini_theme
  win.setBackgroundColor(t === 'light' ? '#ffffff' : '#0a0a0a')
}

/** Settings changed the size: apply it to an open mini. */
export function refreshMiniSize(win: BrowserWindow | undefined | null): void {
  if (!win || win.isDestroyed() || !cards.has(win)) return
  layoutMini(win, !!cards.get(win))
}

/** The renderer drags the mini: move it, and save the spot when the drag ends. */
export function moveMini(win: BrowserWindow, x: number, y: number, done: boolean): void {
  if (win.isDestroyed()) return
  const b = win.getBounds()
  const next = done ? clampToScreen({ ...b, x, y }) : { ...b, x, y }
  win.setPosition(next.x, next.y)
  if (done) savePosition(win)
}
