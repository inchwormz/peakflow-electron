/**
 * macOS keyboard simulation — Cmd+V paste via osascript.
 *
 * Uses AppleScript's System Events to simulate keystrokes.
 * Requires Accessibility permission (same as FocusDim).
 * ~50ms latency per call, which is fine for one-shot paste.
 */

import { execSync } from 'child_process'

/**
 * Simulate Cmd+V keystroke to paste from clipboard on macOS.
 * Returns true if the keystroke was sent successfully.
 */
export function simulateCmdV(): boolean {
  try {
    execSync(
      'osascript -e \'tell application "System Events" to keystroke "v" using command down\'',
      { timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return true
  } catch (error) {
    console.error('[Keyboard-Darwin] osascript error:', error)
    return false
  }
}
