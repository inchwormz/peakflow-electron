/**
 * Which Accessibility message a Mac should get (review S1). Pure, so the
 * decision is tested without Electron (scripts/checks/accessibility-prompt.check.mts).
 *
 * - none: Accessibility is trusted, or no feature that needs it is on.
 * - first-run: never granted on this Mac (the normal first-time set-up), or
 *   switched off in the same app version it was last trusted (a deliberate
 *   revoke, not an update).
 * - forgot-after-update: trusted under an earlier app version and missing now.
 *   An unsigned update gets a new signature, so macOS stops applying the old
 *   grant while the switch still reads ON. The fix is to remove PeakFlow from
 *   the list and add it again.
 */

export type AccessibilityPrompt = 'none' | 'first-run' | 'forgot-after-update'

export interface AccessibilityFacts {
  /** AXIsProcessTrusted() right now */
  trusted: boolean
  /** Accessibility was trusted at least once on this Mac (config: everGranted.accessibility) */
  everGranted: boolean
  /**
   * The app version at the last time Accessibility was seen trusted
   * (config: lastTrustedVersion.accessibility). Missing for a record written
   * before versions were stored; treated as an update.
   */
  lastTrustedVersion?: string | null
  /** The version running now */
  currentVersion: string
  /** Dictation, snippets or another Accessibility feature is on */
  featuresOn: boolean
}

export function accessibilityPrompt({ trusted, everGranted, lastTrustedVersion, currentVersion, featuresOn }: AccessibilityFacts): AccessibilityPrompt {
  if (trusted || !featuresOn) return 'none'
  if (!everGranted) return 'first-run'
  // Trusted under this same version and off now: switched off by hand, so the normal wording
  if (lastTrustedVersion && lastTrustedVersion === currentVersion) return 'first-run'
  return 'forgot-after-update'
}
