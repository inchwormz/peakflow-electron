/**
 * Excluded applications list.
 *
 * PeakFlow tools (especially ScreenSlap and QuickBoard) must never capture
 * content from password managers, banking apps, or security-sensitive windows.
 *
 * This module provides the exclusion list and a case-insensitive substring
 * matcher that mirrors the Python implementation exactly.
 */

/**
 * Window titles containing any of these substrings (case-insensitive) are
 * excluded from capture. Matches password managers, banking sites, and
 * OS security dialogs.
 */
export const EXCLUDED_APPS: string[] = [
  // Password managers
  '1password',
  'bitwarden',
  'lastpass',
  'keepass',
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

  // OS security
  'windows security',
  'credential manager',
  'user account control'
]

/**
 * Check if a window title belongs to an excluded application.
 *
 * Performs a case-insensitive substring match against every entry in
 * `EXCLUDED_APPS`. Returns `true` if any entry is found within the title.
 *
 * @param windowTitle - The window title to check (e.g. from `@electron/active-window`)
 * @returns `true` if the window should be excluded from capture
 */
export function isExcludedApp(windowTitle: string): boolean {
  try {
    if (!windowTitle) return false
    const lower = windowTitle.toLowerCase()
    return EXCLUDED_APPS.some((app) => lower.includes(app))
  } catch (error) {
    console.warn('[PeakFlow:ExcludedApps] isExcludedApp failed:', error)
    // Fail safe: exclude if we can't determine
    return true
  }
}
