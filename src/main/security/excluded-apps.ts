/**
 * Excluded applications list.
 *
 * PeakFlow tools (especially ScreenSlap and QuickBoard) must never capture
 * content from password managers, banking apps, or security-sensitive windows.
 *
 * Each name must appear as a whole word (or whole phrase) in the window title
 * or the app's identifier (Windows exe name, Mac bundle ID). Substrings don't
 * count, so "Purchase order" is not "chase" and "Goalkeeper" is not "keeper".
 */

/**
 * Names matched as whole words, case-insensitively, against the window title
 * and the app identifier. Password managers, banks (US and New Zealand) and
 * OS security dialogs.
 */
export const EXCLUDED_APPS: string[] = [
  // Password managers
  '1password',
  'bitwarden',
  'lastpass',
  'keepass',
  'keepassxc',
  'dashlane',
  'roboform',
  'keeper',
  'nordpass',
  'enpass',

  // Banking / finance
  'chase',
  'bank of america',
  'wells fargo',
  'paypal',
  'anz',
  'asb',
  'bnz',
  'westpac',
  'kiwibank',

  // OS security
  'windows security',
  'credential manager',
  'user account control'
]

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One pattern: any listed name, not touching another letter or digit on either side. */
const EXCLUDED_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${EXCLUDED_APPS.map(escape).join('|')})(?![\\p{L}\\p{N}])`,
  'iu'
)

/**
 * Check if a window belongs to an excluded application.
 *
 * @param windowTitle - The window title (e.g. "ANZ Internet Banking - Chrome")
 * @param appId - Optional app identifier: exe name ("1Password.exe") or bundle ID ("com.1password.1password")
 * @returns `true` if the window should be excluded from capture
 */
export function isExcludedApp(windowTitle: string, appId?: string | null): boolean {
  try {
    return [windowTitle, appId].some((s) => !!s && EXCLUDED_PATTERN.test(s))
  } catch (error) {
    console.warn('[PeakFlow:ExcludedApps] isExcludedApp failed:', error)
    // Fail safe: exclude if we can't determine
    return true
  }
}
