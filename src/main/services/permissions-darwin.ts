/**
 * macOS permissions: the set-up page shown in the panel, plus just-in-time prompts.
 *
 * - Accessibility: QuickBoard paste, FocusDim (which window is in front),
 *   SnapGrid (moving windows), snippets and the launcher's selected text.
 * - Microphone: Dictation. Camera: LiquidFocus (look-away detection).
 *   macOS shows its own prompt the first time; we only step in to explain
 *   and open System Settings when access is off.
 *
 * permissionStatus() is the one helper every tool uses: it remembers that a
 * permission was granted on this Mac, so after an unsigned update it can say
 * "macOS forgot PeakFlow" with the fix that works (review S1). The words live
 * in shared/mac-permissions.ts.
 *
 * Every export is a no-op on other platforms, so callers need no guards.
 */

import { app, systemPreferences, dialog, shell } from 'electron'
import Store from 'electron-store'
import { permissionAdvice, PERMISSION_LABEL, type MacPermission, type PermissionStatus } from '@shared/mac-permissions'

const isMac = process.platform === 'darwin'

const SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
} as const

interface OnboardingData {
  firstRunShown: boolean
  /** Permissions seen granted on this Mac (missing = never recorded: an install from before 2.1.1) */
  everGranted: Partial<Record<MacPermission, boolean>>
  /** App version the set-up page was last shown for a lost permission or a wrong location */
  setupShownFor: string
}

const onboardingStore = isMac
  ? new Store<OnboardingData>({ name: 'mac-onboarding', defaults: { firstRunShown: false, everGranted: {}, setupShownFor: '' } })
  : null

/** Reasons already explained this session, so we never nag twice. */
const explainedThisSession = new Set<string>()

// ─── Status checks ──────────────────────────────────────────────────────────

/** Accessibility granted? Never shows a system prompt. Always true off macOS. */
export function checkAccessibility(): boolean {
  if (!isMac) return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

function isGranted(kind: MacPermission): boolean {
  if (!isMac) return true
  if (kind === 'accessibility') return checkAccessibility()
  return systemPreferences.getMediaAccessStatus(kind) === 'granted'
}

/**
 * Granted, or lost since it was granted (an unsigned update), with the fix
 * in plain English. The shared helper for every tool that needs a permission.
 */
export function permissionStatus(kind: MacPermission): PermissionStatus {
  const granted = isGranted(kind)
  let lost = false
  if (isMac && onboardingStore) {
    const ever = onboardingStore.get('everGranted') ?? {}
    if (granted && !ever[kind]) onboardingStore.set('everGranted', { ...ever, [kind]: true })
    lost = !granted && !!ever[kind]
  }
  const undecided = isMac && kind !== 'accessibility' && systemPreferences.getMediaAccessStatus(kind) === 'not-determined'
  return { kind, granted, lost, undecided, advice: granted ? '' : permissionAdvice(kind, lost) }
}

/** Open the System Settings pane for a permission (Accessibility also adds PeakFlow to its list). */
export function openPermissionPane(kind: MacPermission): void {
  if (!isMac) return
  if (kind === 'accessibility') requestAccessibility()
  else openSettingsPane(kind)
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

// ─── First launch and after updates (review S13) ────────────────────────────

/** Where PeakFlow is running from, when it isn't Applications. */
export function appLocation(): 'applications' | 'downloads' | 'disk-image' | 'elsewhere' {
  if (!isMac || !app.isPackaged) return 'applications'
  try {
    if (app.isInApplicationsFolder()) return 'applications'
  } catch { /* not available: treat as elsewhere */ }
  const exe = process.execPath
  if (exe.startsWith('/Volumes/')) return 'disk-image'
  if (exe.includes('/AppTranslocation/')) return 'disk-image' // opened straight from the download
  if (exe.startsWith(app.getPath('downloads'))) return 'downloads'
  return 'elsewhere'
}

/**
 * The panel page to open at launch instead of the last tool, or null:
 * the set-up page on the first launch on a Mac, and once per version when a
 * permission was lost or PeakFlow runs from outside Applications.
 * Replaces the old dialog, which took focus and closed the panel behind it.
 */
export function macStartupRoute(): string | null {
  if (!isMac || !onboardingStore) return null
  const firstRun = !onboardingStore.get('firstRunShown')
  // Read before permissionStatus() records anything
  const neverRecorded = !(onboardingStore.get('everGranted') ?? {}).accessibility
  const ax = permissionStatus('accessibility')
  onboardingStore.set('firstRunShown', true)
  const version = app.getVersion()
  if (firstRun) {
    onboardingStore.set('setupShownFor', version)
    console.log('[Permissions] First launch: showing the set-up page')
    return 'app/setup'
  }
  // An install from before this release that has no Accessibility now: most likely an update reset it
  const likelyLost = ax.lost || (!ax.granted && neverRecorded)
  const misplaced = appLocation() !== 'applications'
  if ((likelyLost || misplaced) && onboardingStore.get('setupShownFor') !== version) {
    onboardingStore.set('setupShownFor', version)
    console.log(`[Permissions] Showing the set-up page (${likelyLost ? 'Accessibility missing' : ''}${likelyLost && misplaced ? ', ' : ''}${misplaced ? `running from ${appLocation()}` : ''})`)
    return 'app/setup'
  }
  return null
}

/** Move to Applications (macOS copies it from a disk image) and relaunch. */
export function moveToApplications(): boolean {
  if (!isMac || !app.isPackaged) return false
  try {
    return app.moveToApplicationsFolder()
  } catch (err) {
    console.warn('[Permissions] Move to Applications failed:', err)
    return false
  }
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
    detail: `${detail}\n\n${permissionStatus('accessibility').advice}`,
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
    if (status === 'granted') {
      permissionStatus(media) // remember it, so a later loss is explained
      continue
    }
    const key = `${toolName}:${media}`
    if (status === 'denied' && !explainedThisSession.has(key)) {
      explainedThisSession.add(key)
      const Label = PERMISSION_LABEL[media]
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: `${Label} access is off`,
        message: `${toolName} can't use your ${media}.`,
        detail: permissionStatus(media).advice,
        buttons: [`Open ${Label} Settings`, 'Not Now'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (response === 0) openSettingsPane(media)
    }
  }
}
