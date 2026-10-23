/**
 * One wording for every macOS permission message (review S1), shared by the
 * main process (dialogs, the update dialog) and every screen that shows a
 * permission row: SnapGrid, FocusDim, the launcher's snippets and dictation.
 *
 * An unsigned PeakFlow update has a new code signature, so macOS stops
 * trusting it while System Settings still shows PeakFlow switched on.
 * Switching it on again does nothing; removing PeakFlow and adding it back does.
 * The cure is a Developer ID signature; until then this text says what works.
 */

export type MacPermission = 'accessibility' | 'microphone' | 'camera'

export const PERMISSION_LABEL: Record<MacPermission, string> = {
  accessibility: 'Accessibility',
  microphone: 'Microphone',
  camera: 'Camera'
}

/** What the main process reports for one permission. */
export interface PermissionStatus {
  kind: MacPermission
  granted: boolean
  /** It was granted before on this Mac and is missing now (an update) */
  lost: boolean
  /** Camera / Microphone: macOS hasn't asked yet (it asks the first time a tool uses it) */
  undecided: boolean
  /** The plain-English fix, the same everywhere */
  advice: string
}

/** John's words, 24 Oct 2026, for the list that has − and + buttons. */
export const FORGOT_ACCESSIBILITY =
  'macOS forgot PeakFlow after the update: select PeakFlow, click −, then + and add it again.'

export function permissionAdvice(kind: MacPermission, lost: boolean): string {
  const where = `System Settings > Privacy & Security > ${PERMISSION_LABEL[kind]}`
  if (kind === 'accessibility') {
    return lost
      ? `${FORGOT_ACCESSIBILITY} It’s in ${where}.`
      : `Switch PeakFlow on in ${where}. If it’s already on, select PeakFlow, click −, then + and add it again.`
  }
  // Camera and Microphone have no − and + buttons: the switch is the only control
  return lost
    ? `macOS forgot PeakFlow after the update: in ${where}, switch PeakFlow off, then on again.`
    : `Switch PeakFlow on in ${where}.`
}
