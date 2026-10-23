/**
 * SnapGrid layouts, shared by the main process (maths, shortcuts) and the
 * panel (tiles, labels). Rects are fractions of the screen's usable area.
 *
 * Keys follow Rectangle's defaults so Mac users' muscle memory works, with
 * one change: ⌃⌥↑/↓ already change FocusDim's intensity, so the top and
 * bottom halves (and moving between screens) add ⇧.
 *
 * Windows keeps only the Ctrl+Alt keys that type nothing (arrows, Enter,
 * Backspace). Ctrl+Alt+letter is AltGr+letter there (€, @, [ ]), so the
 * letter layouts ship without a shortcut and are used from the panel
 * (review B5; see shared/global-keys.ts).
 */

import { builtInAccel } from './global-keys'

export interface FracRect {
  x: number
  y: number
  w: number
  h: number
}

export type SnapLayoutKey =
  | 'left' | 'right' | 'top' | 'bottom'
  | 't1' | 't2' | 't3' | 'fill'
  | 'tt1' | 'tt2' | 'centre' | 'next'
  | 'tl' | 'tr' | 'bl' | 'br'

export interface SnapLayout {
  key: SnapLayoutKey
  name: string
  /** Electron accelerator */
  accel: string
  /** null for layouts that depend on the window (centre, next screen) */
  rect: FracRect | null
}

const T = 1 / 3

/** In panel order: four rows of four. */
export const SNAP_LAYOUTS: readonly SnapLayout[] = [
  { key: 'left', name: 'Left half', accel: 'Control+Alt+Left', rect: { x: 0, y: 0, w: 0.5, h: 1 } },
  { key: 'right', name: 'Right half', accel: 'Control+Alt+Right', rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  { key: 'top', name: 'Top half', accel: 'Control+Alt+Shift+Up', rect: { x: 0, y: 0, w: 1, h: 0.5 } },
  { key: 'bottom', name: 'Bottom half', accel: 'Control+Alt+Shift+Down', rect: { x: 0, y: 0.5, w: 1, h: 0.5 } },
  { key: 't1', name: 'Left third', accel: 'Control+Alt+D', rect: { x: 0, y: 0, w: T, h: 1 } },
  { key: 't2', name: 'Centre third', accel: 'Control+Alt+F', rect: { x: T, y: 0, w: T, h: 1 } },
  { key: 't3', name: 'Right third', accel: 'Control+Alt+G', rect: { x: 2 * T, y: 0, w: T, h: 1 } },
  { key: 'fill', name: 'Fill screen', accel: 'Control+Alt+Enter', rect: { x: 0, y: 0, w: 1, h: 1 } },
  { key: 'tt1', name: 'Left two-thirds', accel: 'Control+Alt+E', rect: { x: 0, y: 0, w: 2 * T, h: 1 } },
  { key: 'tt2', name: 'Right two-thirds', accel: 'Control+Alt+T', rect: { x: T, y: 0, w: 2 * T, h: 1 } },
  { key: 'centre', name: 'Centre', accel: 'Control+Alt+C', rect: null },
  { key: 'next', name: 'Next screen', accel: 'Control+Alt+Shift+Right', rect: null },
  { key: 'tl', name: 'Top left', accel: 'Control+Alt+U', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
  { key: 'tr', name: 'Top right', accel: 'Control+Alt+I', rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
  { key: 'bl', name: 'Bottom left', accel: 'Control+Alt+J', rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
  { key: 'br', name: 'Bottom right', accel: 'Control+Alt+K', rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }
]

export const SNAP_UNDO_ACCEL = 'Control+Alt+Backspace'

/** A layout's shortcut on this platform, or null when it has none (letters on Windows). */
export function snapAccel(layout: SnapLayout, platform: string): string | null {
  return builtInAccel(layout.accel, platform)
}

export const SNAP_LAYOUT_BY_KEY = Object.fromEntries(SNAP_LAYOUTS.map((l) => [l.key, l])) as Record<SnapLayoutKey, SnapLayout>

export type ArrangeKey = 'halves' | 'main2' | 'grid' | 'focus'

export interface ArrangeLayout {
  key: ArrangeKey
  name: string
  /** Rects for n windows (front window first); n is already capped at max. */
  rects: (n: number) => FracRect[]
  max: number
}

export const ARRANGE_LAYOUTS: readonly ArrangeLayout[] = [
  {
    key: 'halves',
    name: 'Halves',
    max: 2,
    rects: (n) => (n < 2 ? [{ x: 0, y: 0, w: 0.5, h: 1 }] : [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }])
  },
  {
    key: 'main2',
    name: 'Main + two',
    max: 3,
    rects: (n) => [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: n < 3 ? 1 : 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }].slice(0, n)
  },
  {
    key: 'grid',
    name: 'Grid',
    max: 4,
    rects: (n) => [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }].slice(0, n)
  },
  {
    key: 'focus',
    name: 'Focus',
    max: 5,
    rects: (n) => {
      if (n < 2) return [{ x: 0, y: 0, w: 2 * T, h: 1 }]
      const side = n - 1
      return [{ x: 0, y: 0, w: 2 * T, h: 1 }, ...Array.from({ length: side }, (_, i) => ({ x: 2 * T, y: i / side, w: T, h: 1 / side }))]
    }
  }
]

export const ARRANGE_BY_KEY = Object.fromEntries(ARRANGE_LAYOUTS.map((l) => [l.key, l])) as Record<ArrangeKey, ArrangeLayout>

export function isSnapLayoutKey(v: unknown): v is SnapLayoutKey {
  return typeof v === 'string' && v in SNAP_LAYOUT_BY_KEY
}

export function isArrangeKey(v: unknown): v is ArrangeKey {
  return typeof v === 'string' && v in ARRANGE_BY_KEY
}

/** Panel state pushed to the renderer. */
export interface SnapGridState {
  /** The window the layouts act on: the last app window you used. */
  target: { appName: string; icon: import('./ipc-types').AppIconQuery } | null
  /** Windows on the target's screen, front to back (target first). */
  windows: Array<{ appName: string; icon: import('./ipc-types').AppIconQuery }>
  /** Snap when dragging a window to an edge (setting). */
  dragSnap: boolean
  /** The OS already snaps on drag (macOS 15+ tiling, Windows Snap). */
  osDrag: boolean
  /** FocusDim is dimming. */
  dim: boolean
  canUndo: boolean
}
