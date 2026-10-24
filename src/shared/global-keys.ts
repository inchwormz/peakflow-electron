/**
 * Which built-in system-wide shortcuts PeakFlow may take on each platform.
 * Pure, so the main process (registration), the panel and the tray (labels)
 * and scripts/checks all agree.
 *
 * Windows sends AltGr as Ctrl+Alt. A global Ctrl+Alt+<character key> would
 * catch AltGr+E (€ on a German keyboard), AltGr+2 (@ on a Spanish one), and
 * so on, before the character is typed. So on Windows PeakFlow's built-in
 * Ctrl+Alt shortcuts only use keys that type nothing: arrows, Enter,
 * Backspace and the like. Letter and digit layouts stay in the panel.
 */

const CTRL = new Set(['control', 'ctrl', 'commandorcontrol', 'cmdorctrl'])
const ALT = new Set(['alt', 'option', 'altgr'])
const WIN = new Set(['super', 'meta', 'command', 'cmd'])
/** Keys that never type a character, with or without AltGr */
const NON_CHAR = new Set([
  'up', 'down', 'left', 'right', 'enter', 'return', 'backspace', 'delete', 'tab', 'escape', 'esc',
  'home', 'end', 'pageup', 'pagedown', 'insert'
])

/** True when `accel` would swallow an AltGr character on this platform. */
export function clashesWithAltGr(accel: string, platform: string): boolean {
  if (platform !== 'win32' || !accel) return false
  const parts = accel.split('+').map((p) => p.trim().toLowerCase())
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (!mods.some((m) => CTRL.has(m)) || !mods.some((m) => ALT.has(m))) return false
  if (mods.some((m) => WIN.has(m))) return false // Win+… never reaches AltGr
  if (NON_CHAR.has(key) || /^f([1-9]|1\d|2[0-4])$/.test(key)) return false
  return true
}

/** The accelerator PeakFlow registers for a built-in shortcut, or null when it ships unbound here. */
export function builtInAccel(accel: string, platform: string): string | null {
  return clashesWithAltGr(accel, platform) ? null : accel
}

/**
 * ⌥⌘1–6 open the panel on a tool, in panel order; ⌥⌘6 is Dictation's page
 * (DICTATION_SWITCH_KEY). None on Windows: Alt+Ctrl+digit is AltGr+digit.
 */
export const SWITCH_ACCELS: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => `Alt+CommandOrControl+${n}`)

export function switchAccel(index: number, platform: string): string | null {
  const a = SWITCH_ACCELS[index]
  return a ? builtInAccel(a, platform) : null
}

/**
 * Launcher shortcut fallbacks, tried in order when the saved one is taken
 * (⌥Space by Raycast or Alfred, for example). Windows skips Ctrl+Alt+Space,
 * which is AltGr+Space.
 */
export function launcherFallbacks(platform: string): string[] {
  return platform === 'darwin'
    ? ['Control+Alt+Space', 'Control+Shift+Space', 'Alt+Shift+Space']
    : ['Control+Shift+Space', 'Alt+Shift+Space']
}

/**
 * Start-up choice of launcher shortcut: the saved one if it registers, else
 * the first fallback that does. `tryRegister` registers and reports success.
 */
export function chooseLauncherKey(
  saved: string,
  platform: string,
  tryRegister: (accel: string) => boolean
): { key: string | null; movedFrom?: string } {
  if (tryRegister(saved)) return { key: saved }
  for (const alt of launcherFallbacks(platform)) {
    if (alt !== saved && tryRegister(alt)) return { key: alt, movedFrom: saved }
  }
  return { key: null }
}
