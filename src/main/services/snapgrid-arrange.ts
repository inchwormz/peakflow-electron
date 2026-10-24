/**
 * Which windows "Arrange" uses, and how they fill the layout's slots.
 * Kept free of Electron so scripts/checks/snapgrid-arrange.check.mts can run
 * it against recorded window lists.
 */

import type { SnapRect, SnapWindow } from '../native/window-snap-types'

/**
 * Windows an arrange layout may use: normal windows only (no panels, dialogs,
 * minimised or invisible helper windows), on the target's screen, each once,
 * the target first and then the rest front to back.
 */
export function arrangeCandidates(
  target: SnapWindow | null,
  all: SnapWindow[],
  sameScreen: (a: SnapWindow, b: SnapWindow) => boolean
): SnapWindow[] {
  const normal = all.filter((w) => w.normal !== false)
  if (!target) {
    const first = normal[0]
    return first ? [first, ...normal.filter((w) => w !== first && sameScreen(w, first))] : []
  }
  // The target as it appears in the list. A target read with no window id
  // ("pid:0") is matched on its app and frame, so it isn't used twice.
  const listed = all.find((w) => w.id === target.id) ?? all.find((w) => w.pid === target.pid && sameFrame(w.frame, target.frame))
  // Not listed at all (Windows lists titled windows only): keep it, a failed
  // move just passes its slot on. Listed but not a normal window: leave it out.
  const self = listed ? (listed.normal !== false ? listed : null) : target
  // Always the target's screen, even when the target itself is left out
  const rest = normal.filter((w) => w !== listed && sameScreen(w, target))
  return self ? [self, ...rest] : rest
}

function sameFrame(a: SnapRect, b: SnapRect): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2
}

/**
 * Put a window in every slot, in slot order (slot 0 is the main one). A
 * window that won't move gives its slot to the next candidate instead of
 * leaving it empty. Returns the window placed in each slot.
 */
export async function fillSlots(
  rects: SnapRect[],
  candidates: SnapWindow[],
  move: (w: SnapWindow, r: SnapRect) => Promise<boolean>
): Promise<SnapWindow[]> {
  const placed: SnapWindow[] = []
  let next = 0
  for (const r of rects) {
    while (next < candidates.length) {
      const w = candidates[next++]
      if (await move(w, r)) {
        placed.push(w)
        break
      }
    }
  }
  return placed
}
