/**
 * macOS permissions: first-run explainer plus just-in-time prompts.
 *
 * - Accessibility: FocusDim (which window is in front) and QuickBoard paste.
 * - Camera / Microphone: MeetReady (pre-call check) and LiquidFocus (camera
 *   focus detection). macOS shows its own prompt the first time; we only step
 *   in to explain and open System Settings when access was previously denied.
 *
 * Every export is a no-op on other platforms, so callers need no guards.
 */

import { systemPreferences, dialog, shell } from 'electron'
import Store from 'electron-store'

const isMac = process.platform === 'darwin'

const SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
} as const

const onboardingStore = isMac
  ? new Store<{ firstRunShown: boolean }>({ name: 'mac-onboarding', defaults: { firstRunShown: false } })
  : null

/** Reasons already explained this session, so we never nag twice. */
const explainedThisSession = new Set<string>()

// ─── Status checks ──────────────────────────────────────────────────────────

/** Accessibility granted? Never shows a system prompt. Always true off macOS. */
export function checkAccessibility(): boolean {
  if (!isMac) return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

// ─── Opening System Settings ────────────────────────────────────────────────

function openSettingsPane(pane: keyof typeof SETTINGS_PANES): void {
  shell.openExternal(SETTINGS_PANES[pane]).catch((err) => {
    console.warn(`[Permissions] Could not open ${pane} settings:`, err)
  })
}

/**
 * Ask for Accessibility: registers PeakFlow in the Accessibility list (system
 * prompt) and opens the right System Settings pane.
 */
export function requestAccessibility(): void {
  if (!isMac) return
  systemPreferences.isTrustedAccessibilityClient(true)
  openSettingsPane('accessibility')
}

// ─── First run ──────────────────────────────────────────────────────────────

/**
 * Shown once, on the first launch on a Mac. Explains in plain English what
 * each permission is for and offers to open the Accessibility settings.
 */
export async function runMacFirstRunPermissions(): Promise<void> {
  if (!isMac || !onboardingStore) return
  if (onboardingStore.get('firstRunShown')) return
  onboardingStore.set('firstRunShown', true)

  if (checkAccessibility()) {
    console.log('[Permissions] First run: Accessibility already granted')
    return
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Set up PeakFlow on your Mac',
    message: 'PeakFlow needs your OK for two things on a Mac.',
    detail:
      'Accessibility lets QuickBoard paste into the app you were using, and helps FocusDim follow ' +
      'exactly which window you are working in.\n\n' +
      'Camera and Microphone are only used by MeetReady (to check how you look and sound before a call) ' +
      'and LiquidFocus (to notice when you look away). macOS asks the first time you open those tools.\n\n' +
      'Click "Open Accessibility Settings", then switch PeakFlow on in the list.',
    buttons: ['Open Accessibility Settings', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })

  if (response === 0) {
    requestAccessibility()
  }
  console.log(`[Permissions] First run explainer shown (choice: ${response === 0 ? 'open settings' : 'later'})`)
}

// ─── Just-in-time prompts ───────────────────────────────────────────────────

const ACCESSIBILITY_REASONS: Record<string, string> = {
  paste: 'QuickBoard needs Accessibility to paste into the app you were using. Your item is on the clipboard, so you can press Cmd+V yourself for now.'
}

/**
 * Called when a feature needs Accessibility and it is missing. Explains why
 * (once per session per feature) and offers to open System Settings.
 */
export function notifyAccessibilityNeeded(reason: string): void {
  if (!isMac || checkAccessibility()) return
  if (explainedThisSession.has(reason)) return
  explainedThisSession.add(reason)

  const detail = ACCESSIBILITY_REASONS[reason] ?? 'This feature needs Accessibility access.'
  void dialog.showMessageBox({
    type: 'info',
    title: 'Accessibility permission needed',
    message: 'PeakFlow needs Accessibility access for this.',
    detail: `${detail}\n\nOpen System Settings, then switch PeakFlow on under Privacy & Security > Accessibility.`,
    buttons: ['Open Accessibility Settings', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }).then(({ response }) => {
    if (response === 0) requestAccessibility()
  })
}

/**
 * When a camera/mic tool opens: if macOS has never asked, let it ask now;
 * if access was denied earlier, explain and offer the right settings pane.
 * Callers run this without awaiting it, so the tool window is never delayed
 * by a prompt or the explanation dialog.
 */
export async function ensureMediaAccess(toolName: string, needs: Array<'camera' | 'microphone'>): Promise<void> {
  if (!isMac) return

  for (const media of needs) {
    const status = systemPreferences.getMediaAccessStatus(media)
    if (status === 'not-determined') {
      await systemPreferences.askForMediaAccess(media)
      continue
    }
    const key = `${toolName}:${media}`
    if (status === 'denied' && !explainedThisSession.has(key)) {
      explainedThisSession.add(key)
      const Label = media === 'camera' ? 'Camera' : 'Microphone'
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: `${Label} access is off`,
        message: `${toolName} can't use your ${media}.`,
        detail: `Your Mac is blocking PeakFlow from the ${media}. To fix it, open System Settings and switch PeakFlow on under Privacy & Security > ${Label}.`,
        buttons: [`Open ${Label} Settings`, 'Not Now'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (response === 0) openSettingsPane(media)
    }
  }
}
