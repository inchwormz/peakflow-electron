/**
 * macOS keyboard simulation: Cmd+V paste via the PeakFlowHelper Swift binary.
 *
 * The helper posts a CGEvent keystroke, which needs only the Accessibility
 * permission. (The old osascript + System Events route also needed the
 * Automation permission and an apple-events entitlement under hardened runtime.)
 * If PeakFlow is still frontmost, the helper first refocuses the app the user
 * was in, so the paste lands there.
 */

import { runMacHelper } from './mac-helper'
import { notifyAccessibilityNeeded } from '../services/permissions-darwin'

/**
 * Simulate Cmd+V keystroke to paste from clipboard on macOS.
 * Resolves true if the keystroke was sent. Runs the helper asynchronously so
 * the main thread (tray, hotkeys, IPC) never stalls for up to 2 s waiting on it.
 */
export async function simulateCmdV(): Promise<boolean> {
  const result = await runMacHelper(['paste'], 2000)
  if (!result) return false
  if (result.trusted === false) {
    console.warn('[Keyboard-Darwin] Paste skipped: Accessibility permission not granted')
    notifyAccessibilityNeeded('paste')
    return false
  }
  return result.ok === true
}
