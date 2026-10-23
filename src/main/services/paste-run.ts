/**
 * "A paste run started or ended": a paste queue, workflow or form fill.
 * The services call pasteRunChanged(); hotkeys.ts listens and takes ⇧⌘N
 * and ⇧⌘Q only while a run is going (review S7).
 */

const listeners = new Set<() => void>()

export function onPasteRunChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function pasteRunChanged(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (err) {
      console.warn('[PeakFlow] paste-run listener failed:', err)
    }
  }
}
