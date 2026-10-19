/**
 * The platform's main shortcut modifier: ⌘ on macOS, Ctrl on Windows/Linux.
 * Pure so scripts/checks can test it; the panel passes isMac().
 */

interface ModKeys {
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** ⌘ alone on a Mac, Ctrl alone elsewhere (Alt never counts, so ⌥/AltGr combos pass through). */
export function isPrimaryMod(e: ModKeys, mac: boolean): boolean {
  if (e.altKey) return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** Label for '<mod><key>': '⌘1' on a Mac, 'Ctrl+1' elsewhere. */
export function modLabel(key: string, mac: boolean): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`
}
