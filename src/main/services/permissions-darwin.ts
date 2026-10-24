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
import { accessibilityPrompt } from '@shared/accessibility-prompt'

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
  /** Accessibility only: the app version when it was last seen trusted (tells an update from a deliberate revoke) */
  lastTrustedVersion: Partial<Record<'accessibility', string>>
  /** App version the set-up page was last shown for a lost permission or a wrong location */
  setupShownFor: string
  /** Permissions seen off since they were last granted: the next time one works, PeakFlow says "All set" */
  awaitingFix: Partial<Record<MacPermission, boolean>>
}

const onboardingStore = isMac
  ? new Store<OnboardingData>({ name: 'mac-onboarding', defaults: { firstRunShown: false, everGranted: {}, lastTrustedVersion: {}, setupShownFor: '', awaitingFix: {} } })
  : null

/** Reasons already explained this session, so we never nag twice. */
const explainedThisSession = new Set<string>()

/** When each permission started working again after being off: "All set" shows for a while after. */
const fixedAt = new Map<MacPermission, number>()
export const ALL_SET_FOR_MS = 10 * 60 * 1000

/** Development screenshots only (dev-shots.ts): pretend a permission is on or off. */
const devOverride = new Map<MacPermission, boolean>()
export function setDevPermission(kind: MacPermission, granted: boolean | null): void {
  if (app.isPackaged) return
  if (granted === null) devOverride.delete(kind)
  else devOverride.set(kind, granted)
}

// ─── Status checks ──────────────────────────────────────────────────────────

/** Accessibility granted? Never shows a system prompt. Always true off macOS. */
export function checkAccessibility(): boolean {
  if (!isMac) return true
  return systemPreferences.isTrustedAccessibilityClient(false)
}

function isGranted(kind: MacPermission): boolean {
  if (!isMac) return true
  const forced = devOverride.get(kind)
  if (forced !== undefined) return forced
  if (kind === 'accessibility') return checkAccessibility()
  return systemPreferences.getMediaAccessStatus(kind) === 'granted'
}

/**
 * Granted, or lost since it was granted (an unsigned update), with the fix
 * in plain English. The shared helper for every tool that needs a permission.
 */
export function permissionStatus(kind: MacPermission): PermissionStatus {
  const granted = isGranted(kind)
  const undecided = isMac && !devOverride.has(kind) && kind !== 'accessibility' && systemPreferences.getMediaAccessStatus(kind) === 'not-determined'
  let lost = false
  if (isMac && onboardingStore) {
    const ever = onboardingStore.get('everGranted') ?? {}
    const trustedVersions = onboardingStore.get('lastTrustedVersion') ?? {}
    if (granted && !ever[kind]) onboardingStore.set('everGranted', { ...ever, [kind]: true })
    if (granted && kind === 'accessibility' && trustedVersions.accessibility !== app.getVersion()) {
      onboardingStore.set('lastTrustedVersion', { ...trustedVersions, accessibility: app.getVersion() })
    }
    if (kind === 'accessibility') {
      // Lost means: trusted under an earlier version. Off in this same version is a deliberate revoke.
      lost = !granted && accessibilityPrompt({
        trusted: false,
        everGranted: !!ever[kind],
        lastTrustedVersion: trustedVersions.accessibility,
        currentVersion: app.getVersion(),
        featuresOn: true
      }) === 'forgot-after-update'
    } else {
      lost = !granted && !!ever[kind]
    }
    // Off (and macOS has asked): remember it, across restarts, so the next grant says "All set"
    const waiting = onboardingStore.get('awaitingFix') ?? {}
    if (!granted && !undecided && !waiting[kind]) onboardingStore.set('awaitingFix', { ...waiting, [kind]: true })
    if (granted && waiting[kind]) {
      onboardingStore.set('awaitingFix', { ...waiting, [kind]: false })
      fixedAt.set(kind, Date.now())
      console.log(`[Permissions] ${kind} works again`)
    }
  }
  const since = fixedAt.get(kind)
  const fixed = granted && since !== undefined && Date.now() - since < ALL_SET_FOR_MS
  return { kind, granted, lost, undecided, advice: granted ? '' : permissionAdvice(kind, lost), fixed }
}

let fixWatch: ReturnType<typeof setInterval> | null = null

/**
 * After "Open Settings": check every 1.5 seconds (for up to 10 minutes) and,
 * the moment the permission works, open the panel so the customer sees
 * "All set" without having to come back and look.
 */
export function watchForFix(kind: MacPermission, onFixed: () => void): void {
  if (!isMac || isGranted(kind)) return
  if (fixWatch) clearInterval(fixWatch)
  const started = Date.now()
  fixWatch = setInterval(() => {
    const done = Date.now() - started > 10 * 60 * 1000
    if (!done && !isGranted(kind)) return
    if (fixWatch) clearInterval(fixWatch)
    fixWatch = null
    if (done) return
    permissionStatus(kind) // records the fix
    onFixed()
  }, 1500)
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
  const everBefore = !!(onboardingStore.get('everGranted') ?? {}).accessibility
  const trustedVersionBefore = (onboardingStore.get('lastTrustedVersion') ?? {}).accessibility
  const waiting = { ...(onboardingStore.get('awaitingFix') ?? {}) }
  const ax = permissionStatus('accessibility')
  // Any permission seen off that works now (fixed while PeakFlow was closed)
  const fixedWhileClosed = (['accessibility', 'microphone', 'camera'] as const).filter(
    (k) => waiting[k] && (k === 'accessibility' ? ax : permissionStatus(k)).fixed
  )
  onboardingStore.set('firstRunShown', true)
  const version = app.getVersion()
  if (firstRun) {
    onboardingStore.set('setupShownFor', version)
    console.log('[Permissions] First launch: showing the set-up page')
    return 'app/setup'
  }
  // Fixed while PeakFlow was closed (the customer quit and reopened it): say "All set" once
  if (fixedWhileClosed.length) {
    onboardingStore.set('setupShownFor', version) // the same page also covers a wrong location
    console.log(`[Permissions] ${fixedWhileClosed.join(', ')} works again: showing the set-up page`)
    return 'app/setup'
  }
  // Accessibility missing: an update reset it (trusted under an earlier version), or an install from before this release (no record).
  // SnapGrid always needs Accessibility, so it is always on here.
  const likelyLost = accessibilityPrompt({
    trusted: ax.granted,
    everGranted: everBefore,
    lastTrustedVersion: trustedVersionBefore,
    currentVersion: version,
    featuresOn: true
  }) !== 'none'
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
