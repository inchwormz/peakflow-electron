/**
 * macOS permission checks for Accessibility, Camera, and Microphone.
 *
 * FocusDim and QuickBoard (paste) need Accessibility access.
 * MeetReady and LiquidFocus need Camera and Microphone access.
 */

import { systemPreferences, dialog } from 'electron'

/**
 * Check if Accessibility permission is granted.
 * Does NOT show the system prompt (pass false to isTrustedAccessibilityClient).
 */
export function checkAccessibility(): boolean {
  return systemPreferences.isTrustedAccessibilityClient(false)
}

/**
 * Request Accessibility permission.
 * Shows the macOS system prompt that guides the user to
 * System Preferences > Privacy & Security > Accessibility.
 * Returns true if already granted, false if the user needs to grant it.
 */
export function requestAccessibility(): boolean {
  return systemPreferences.isTrustedAccessibilityClient(true)
}

/**
 * Show a dialog explaining why Accessibility permission is needed,
 * then trigger the system prompt.
 */
export async function promptAccessibility(reason: string): Promise<boolean> {
  if (checkAccessibility()) return true

  await dialog.showMessageBox({
    type: 'info',
    title: 'Accessibility Permission Required',
    message: 'PeakFlow needs Accessibility access.',
    detail: `${reason}\n\nAfter granting access in System Preferences, you may need to restart PeakFlow.`,
    buttons: ['Open Settings'],
    defaultId: 0
  })

  requestAccessibility()
  return false
}

/**
 * Check camera permission status.
 * Returns 'granted', 'denied', 'restricted', or 'not-determined'.
 */
export function checkCameraPermission(): string {
  return systemPreferences.getMediaAccessStatus('camera')
}

/**
 * Request camera access. Returns true if granted.
 */
export async function requestCameraPermission(): Promise<boolean> {
  return systemPreferences.askForMediaAccess('camera')
}

/**
 * Check microphone permission status.
 */
export function checkMicrophonePermission(): string {
  return systemPreferences.getMediaAccessStatus('microphone')
}

/**
 * Request microphone access. Returns true if granted.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  return systemPreferences.askForMediaAccess('microphone')
}
