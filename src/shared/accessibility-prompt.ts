/**
 * Which Accessibility message a Mac should get (review S1). Pure, so the
 * decision is tested without Electron (scripts/checks/accessibility-prompt.check.mts).
 *
 * - none: Accessibility is trusted, or no feature that needs it is on.
 * - first-run: never granted on this Mac (the normal first-time set-up).
 * - forgot-after-update: granted before, missing now. An unsigned update gets a
 *   new signature, so macOS stops applying the old grant while the switch still
 *   reads ON. The fix is to remove PeakFlow from the list and add it again.
 */

export type AccessibilityPrompt = 'none' | 'first-run' | 'forgot-after-update'

export interface AccessibilityFacts {
  /** AXIsProcessTrusted() right now */
  trusted: boolean
  /** Accessibility was trusted at least once on this Mac (config: everGranted.accessibility) */
  everGranted: boolean
  /** Dictation, snippets or another Accessibility feature is on */
  featuresOn: boolean
}

export function accessibilityPrompt({ trusted, everGranted, featuresOn }: AccessibilityFacts): AccessibilityPrompt {
  if (trusted || !featuresOn) return 'none'
  return everGranted ? 'forgot-after-update' : 'first-run'
}
