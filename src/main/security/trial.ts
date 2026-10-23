/**
 * Trial period management.
 *
 * v2 (John, 19 Oct 2026: "Let's do a thirty-day trial. For all six tools...
 * make the trial happen automatically"): ONE 30-day trial for the whole app,
 * starting the first time PeakFlow opens. No "start trial" step: every tool is
 * switched on automatically (autoInstallTools) and shares the same clock.
 *
 * The trial END is worked out once and saved encrypted (trial_expires_at), so it never
 * drifts: the LATEST of (start + 30 days) over the four v2 tools' existing
 * per-tool starts (hidden MeetReady/SoundSplit don't count), or first launch
 * + 30 days when there are none. So a v1 user on a 14-day per-tool trial gets
 * 30 days from the newest tool they started, and one whose 14 days ran out
 * less than 30 days ago is open again. Generous by design (few v1 users).
 * Dates are encrypted at rest via safeStorage. Licences are in license.ts.
 */

import Store from 'electron-store'
import { ToolId, PANEL_TOOLS } from '@shared/tool-ids'
import { encryptString, decryptString, isAvailable } from './safe-storage'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Length of the free trial in days (v2: 30, app-wide; v1 was 14 per tool). */
export const TRIAL_DAYS = 30

const DAY_MS = 1000 * 60 * 60 * 24

// ─── Store ──────────────────────────────────────────────────────────────────

/** Dedicated store for license / trial data — kept separate from tool configs. */
const licenseStore = new Store({ name: 'peakflow-license' })

// ─── Install Date ───────────────────────────────────────────────────────────

/**
 * Retrieve or create the install date.
 *
 * On first call the current date is encrypted and persisted. Subsequent calls
 * decrypt and return the stored date. If decryption fails (e.g. the user moved
 * the data to another machine), the current date is used as a fallback so the
 * trial effectively restarts rather than crashing.
 */
export function getInstallDate(): Date {
  try {
    const stored = licenseStore.get('install_date') as string | undefined

    if (stored) {
      // Attempt to decrypt
      if (isAvailable()) {
        const decrypted = decryptString(stored)
        if (decrypted !== null) {
          const parsed = new Date(decrypted)
          if (!isNaN(parsed.getTime())) return parsed
        }
      }

      // Fallback: try parsing as a raw ISO string (unencrypted dev env)
      const raw = new Date(stored)
      if (!isNaN(raw.getTime())) return raw

      console.warn('[PeakFlow:Trial] Could not parse stored install date, resetting')
    }

    // First run — stamp install date
    const now = new Date()
    const isoString = now.toISOString()

    if (isAvailable()) {
      const encrypted = encryptString(isoString)
      if (encrypted !== null) {
        licenseStore.set('install_date', encrypted)
        return now
      }
    }

    // safeStorage not ready — store plaintext
    console.warn('[PeakFlow:Trial] safeStorage unavailable, storing install date as plaintext')
    licenseStore.set('install_date', isoString)
    return now
  } catch (error) {
    console.warn('[PeakFlow:Trial] getInstallDate failed, using current date:', error)
    return new Date()
  }
}

// ─── Trial Status ───────────────────────────────────────────────────────────

/** Read a stored date (encrypted or plain ISO) without changing anything. */
function readStoredDate(key: string): Date | null {
  try {
    const stored = licenseStore.get(key) as unknown
    if (!stored || typeof stored !== 'string') return null
    if (isAvailable()) {
      const decrypted = decryptString(stored)
      if (decrypted !== null) {
        const parsed = new Date(decrypted)
        if (!isNaN(parsed.getTime())) return parsed
      }
    }
    const raw = new Date(stored)
    return isNaN(raw.getTime()) ? null : raw
  } catch {
    return null // corrupt record: skipped, never fatal
  }
}

const EXPIRY_KEY = 'trial_expires_at'

/** Tools whose install dates can date the app-wide trial (see ensureTrialExpiry). */
const TRIAL_HISTORY_TOOLS: readonly ToolId[] = [ToolId.FocusDim, ToolId.LiquidFocus, ToolId.ScreenSlap, ToolId.QuickBoard]

/**
 * The saved trial end, ONLY if it decrypts (safeStorage). A plaintext value is
 * never trusted as the saved end, so typing a future date into the store file
 * doesn't override the real history; the end is then worked out again from
 * the tool records (plaintext ones are accepted there as legacy v1 input).
 */
function readSavedExpiry(): Date | null {
  try {
    const stored = licenseStore.get(EXPIRY_KEY) as unknown
    if (!stored || typeof stored !== 'string' || !isAvailable()) return null
    const decrypted = decryptString(stored)
    if (decrypted === null) return null
    const parsed = new Date(decrypted)
    return isNaN(parsed.getTime()) ? null : parsed
  } catch {
    return null
  }
}

/** Save the trial end encrypted; without encryption it isn't saved (worked out each launch). */
function saveExpiry(d: Date): void {
  const encrypted = isAvailable() ? encryptString(d.toISOString()) : null
  if (encrypted === null) {
    console.warn('[PeakFlow:Trial] Encryption unavailable: trial end not saved')
    return
  }
  licenseStore.set(EXPIRY_KEY, encrypted)
}

/**
 * Work out and save when the app-wide trial ends, if that isn't saved yet.
 * Call on launch BEFORE autoInstallTools, so tools switched on now don't count
 * as old trial starts. Unreadable records are skipped; nothing here throws.
 */
export function ensureTrialExpiry(now: Date = new Date()): Date {
  const saved = readSavedExpiry()
  if (saved) return saved
  let latestEnd: number | null = null
  // Only the four original tools: a tool added in a later version is switched
  // on with today's date when the update first runs, so counting it would give
  // an expired user a fresh trial whenever the saved end is missing.
  for (const id of TRIAL_HISTORY_TOOLS) {
    const start = readStoredDate(`tool_install_${id}`)
    if (!start) continue
    const end = start.getTime() + TRIAL_DAYS * DAY_MS
    if (latestEnd === null || end > latestEnd) latestEnd = end
  }
  const expiry = new Date(latestEnd ?? now.getTime() + TRIAL_DAYS * DAY_MS)
  try {
    saveExpiry(expiry)
    console.log(`[PeakFlow:Trial] Trial ends ${expiry.toISOString()}`)
  } catch (error) {
    console.warn('[PeakFlow:Trial] Could not save the trial end:', error)
  }
  return expiry
}

/**
 * How many days of the app-wide trial remain (a part day counts as a day).
 *
 * @returns 0..TRIAL_DAYS (0 means the trial has expired).
 */
export function getTrialDaysRemaining(now: Date = new Date()): number {
  try {
    const leftMs = ensureTrialExpiry(now).getTime() - now.getTime()
    // Capped at TRIAL_DAYS so a backwards system clock can't show extra days
    return Math.min(TRIAL_DAYS, Math.max(0, Math.ceil(leftMs / DAY_MS)))
  } catch (error) {
    console.warn('[PeakFlow:Trial] getTrialDaysRemaining failed:', error)
    return 0
  }
}

/**
 * Check whether the free trial is still active.
 */
export function isTrialActive(): boolean {
  return getTrialDaysRemaining() > 0
}

// ─── Per-Tool Install (Storefront Model) ─────────────────────────────────

/**
 * Run once on startup to handle backwards compatibility.
 *
 * Existing users (who have a global `install_date` from before the storefront
 * feature) get all tools auto-installed with the global trial date.
 * New users start with no tools installed.
 */
export function migrateExistingInstalls(): void {
  try {
    if (licenseStore.get('storefront_migrated')) return

    const hasGlobalInstall = licenseStore.has('install_date')
    if (hasGlobalInstall) {
      // Existing user — stamp all tools with global install date
      const globalDate = licenseStore.get('install_date') as string
      for (const id of Object.values(ToolId) as string[]) {
        const key = `tool_install_${id}`
        if (!licenseStore.has(key)) {
          licenseStore.set(key, globalDate)
        }
      }
      console.log('[PeakFlow:Trial] Migrated existing user — all tools auto-installed')
    }
    // else: new user, no tools installed by default

    licenseStore.set('storefront_migrated', true)
  } catch (error) {
    console.warn('[PeakFlow:Trial] migrateExistingInstalls failed:', error)
  }
}

/**
 * v2: switch every listed tool on automatically (no "Turn on" / "Start trial"
 * step). Runs on every launch, so a new tool is on as soon as it ships. Being
 * "on" doesn't start a separate clock: all tools share the app-wide trial.
 */
export function autoInstallTools(toolIds: readonly string[]): void {
  for (const id of toolIds) installTool(id)
}

/**
 * Check whether a tool has been "installed" (switched on).
 */
export function isToolInstalled(toolId: ToolId | string): boolean {
  return licenseStore.has(`tool_install_${toolId}`)
}

/**
 * "Install" a tool — stamps the per-tool trial start date.
 * If the tool is already installed, this is a no-op.
 */
export function installTool(toolId: ToolId | string): void {
  const key = `tool_install_${toolId}`
  if (licenseStore.has(key)) return // already installed

  const now = new Date()
  const isoString = now.toISOString()

  if (isAvailable()) {
    const encrypted = encryptString(isoString)
    if (encrypted !== null) {
      licenseStore.set(key, encrypted)
      console.log(`[PeakFlow:Trial] Tool installed: ${toolId}`)
      return
    }
  }

  // safeStorage not ready — store plaintext
  licenseStore.set(key, isoString)
  console.log(`[PeakFlow:Trial] Tool installed (plaintext): ${toolId}`)
}

/**
 * Get the install date for a specific tool, or null if not installed.
 */
export function getToolTrialStart(toolId: ToolId | string): Date | null {
  try {
    const stored = licenseStore.get(`tool_install_${toolId}`) as string | undefined
    if (!stored) return null

    // Try decrypting
    if (isAvailable()) {
      const decrypted = decryptString(stored)
      if (decrypted !== null) {
        const parsed = new Date(decrypted)
        if (!isNaN(parsed.getTime())) return parsed
      }
    }

    // Fallback: try parsing as raw ISO string
    const raw = new Date(stored)
    if (!isNaN(raw.getTime())) return raw

    // Unreadable ciphertext (DPAPI rotation, corrupt migration, etc.) — re-stamp
    console.warn(`[PeakFlow:Trial] Could not parse stored date for ${toolId}, resetting`)
    const now = new Date()
    const isoString = now.toISOString()
    const key = `tool_install_${toolId}`

    if (isAvailable()) {
      const encrypted = encryptString(isoString)
      if (encrypted !== null) {
        licenseStore.set(key, encrypted)
        return now
      }
    }

    licenseStore.set(key, isoString)
    return now
  } catch {
    return null
  }
}

/**
 * Trial days left for a tool. v2 has one app-wide trial, so this is the same
 * for every tool that is switched on; 0 if the tool isn't on.
 */
export function getToolTrialDaysRemaining(toolId: ToolId | string): number {
  if (!isToolInstalled(toolId)) return 0
  return getTrialDaysRemaining()
}
