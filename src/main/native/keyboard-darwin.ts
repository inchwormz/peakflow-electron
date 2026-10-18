/**
 * macOS keyboard simulation: Cmd+V paste via the PeakFlowHelper Swift binary.
 *
 * The helper posts a CGEvent keystroke, which needs only the Accessibility
 * permission. (The old osascript + System Events route also needed the
 * Automation permission and an apple-events entitlement under hardened runtime.)
 * If PeakFlow is still frontmost, the helper first refocuses the app the user
 * was in, so the paste lands there.
 */

import { runMacHelperSync } from './mac-helper'

/**
 * Simulate Cmd+V keystroke to paste from clipboard on macOS.
 * Returns true if the keystroke was sent successfully.
 */
export function simulateCmdV(): boolean {
  const result = runMacHelperSync(['paste'], 2000)
  if (!result) return false
  if (result.trusted === false) {
    console.warn('[Keyboard-Darwin] Paste skipped: Accessibility permission not granted')
    try {
      // Lazy require: avoids a load-time cycle with the permissions module
      const { notifyAccessibilityNeeded } = require('../services/permissions-darwin')
      notifyAccessibilityNeeded('paste')
    } catch { /* permissions module unavailable */ }
    return false
  }
  return result.ok === true
}
