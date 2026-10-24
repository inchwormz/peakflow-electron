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

import { ART_LABELS_EN, type ArtLabels } from './permission-art'

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
  /** It was missing and works again now (shown as "All set" for a few minutes) */
  fixed: boolean
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

// ─── The step-by-step guide (John, 24 Oct 2026: "make it easy and visual") ──

/** The same steps and pictures on the website, in English, German and Spanish. */
export const PERMISSION_GUIDE_URL = 'https://getpeakflow.pro/mac-permissions'

/** What a permission screen shows: nothing, the steps, or "All set" after a fix. */
export type GuideView = 'none' | 'steps' | 'all-set'

/**
 * The guide shows whenever the permission is off (and macOS has already
 * asked), and "All set" once a permission that was off works again.
 */
export function guideView(s: PermissionStatus | null | undefined): GuideView {
  if (!s) return 'none'
  if (s.granted) return s.fixed ? 'all-set' : 'none'
  return s.undecided ? 'none' : 'steps'
}

/** Re-check every 2 seconds while the steps or "All set" are on screen (so All set expires, and a new loss shows). */
export function guideNeedsRecheck(view: GuideView): boolean {
  return view !== 'none'
}

/** The words drawn in a step's picture: the list is named after the permission. */
export function guideArtLabels(kind: MacPermission): ArtLabels {
  return { ...ART_LABELS_EN, list: PERMISSION_LABEL[kind] }
}

export interface GuideStep {
  /** Which drawing (shared/permission-art.ts) */
  art: 'remove' | 'add' | 'choose' | 'switch' | 'toggle'
  text: string
}

export interface GuideCopy {
  title: string
  intro: string
  steps: GuideStep[]
}

/** The guide's words. `lost`: it worked before this update. */
export function guideCopy(kind: MacPermission, lost: boolean): GuideCopy {
  const label = PERMISSION_LABEL[kind]
  if (kind === 'accessibility') {
    return {
      title: lost ? 'macOS forgot PeakFlow after the update' : 'Turn on Accessibility for PeakFlow',
      intro: lost
        ? 'Your Accessibility switch may still show ON, but macOS no longer applies it to this version. In Accessibility, select PeakFlow, click −, then click + and add PeakFlow from Applications again. Dictation and shortcuts start working straight away.'
        : 'PeakFlow needs Accessibility to paste, move windows and see which window is in front.',
      steps: [
        {
          art: 'remove',
          text: lost
            ? 'In the Accessibility list, select PeakFlow and click −. If PeakFlow is there more than once, remove each one.'
            : 'If PeakFlow is already in the Accessibility list, select it and click −.'
        },
        { art: 'add', text: 'Click + under the list.' },
        { art: 'choose', text: 'Open Applications, choose PeakFlow and click Open.' },
        { art: 'switch', text: 'Switch PeakFlow on.' }
      ]
    }
  }
  return {
    title: lost ? `macOS forgot PeakFlow’s ${label} access` : `Turn on ${label} for PeakFlow`,
    intro: lost ? 'The switch can still look on, but it no longer works for this version. You do this once.' : `PeakFlow needs the ${label.toLowerCase()} for this.`,
    steps: [
      { art: 'toggle', text: lost ? `In the ${label} list, switch PeakFlow off, then on again.` : `In the ${label} list, switch PeakFlow on.` }
    ]
  }
}

export const GUIDE_WATCHING = 'PeakFlow checks by itself and shows All set when it works again.'
export const GUIDE_ALL_SET = (kind: MacPermission): string => `All set. PeakFlow has ${PERMISSION_LABEL[kind]} access again.`
export const GUIDE_RESTART_HINT = 'If a tool still doesn’t respond, restart PeakFlow.'
export const AFTER_UPDATE_TITLE = 'After updating, you may need to do this once'
