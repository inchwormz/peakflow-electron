/** Shared types for SnapGrid's per-OS window movers. */

import type { AppIconQuery } from '@shared/ipc-types'

/** A rectangle in Electron screen coordinates (DIP, top-left origin). */
export interface SnapRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SnapWindow {
  /** Stable for the window's life (used for "put it back"). */
  id: string
  pid: number
  appName: string
  icon: AppIconQuery
  frame: SnapRect
  /** OS-specific handle; only the module that made it reads it. */
  handle: unknown
}

/** Window-drag events from the macOS drag watcher (cursor in global points). */
export type DragEvent =
  | { e: 'ready'; trusted: boolean }
  | { e: 'start'; pid: number; windowId: number }
  | { e: 'move'; x: number; y: number }
  | { e: 'end'; x: number; y: number; pid: number; windowId: number }
