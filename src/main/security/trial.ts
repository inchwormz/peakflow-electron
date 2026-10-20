/**
 * Trial period management.
 *
 * v2 (John, 19 Oct 2026: "Let's do a thirty-day trial. For all six tools...
 * make the trial happen automatically"): ONE 30-day trial for the whole app,
 * starting the first time PeakFlow opens. No "start trial" step: every tool is
 * switched on automatically (autoInstallTools) and shares the same clock.
 *
 * The trial start is the EARLIEST date PeakFlow has stored (the app install
 * date, or any tool's old per-tool trial start), so v1 users who were on a
 * 14-day per-tool trial get 30 days from when they first started, and one
 * whose 14 days ran out less than 30 days ago is open again. Dates are
 * encrypted at rest via safeStorage. Licences are handled in license.ts.
 */

import Store from 'electron-store'
import { ToolId } from '@shared/tool-ids'
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
  const stored = licenseStore.get(key) as string | undefined
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
}

/**
 * When the app-wide trial started: the earliest date PeakFlow has stored (the
 * install date or any tool's old per-tool start). A fresh install has none, so
 * this stamps the install date now; that is the automatic start.
 */
export function getTrialStart(): Date {
  try {
    const keys = ['install_date', ...[...(Object.values(ToolId) as string[]), 'PeakFlow'].map((id) => `tool_install_${id}`)]
    let earliest: Date | null = null
    for (const key of keys) {
      const d = readStoredDate(key)
      if (d && (!earliest || d.getTime() < earliest.getTime())) earliest = d
    }
    return earliest ?? getInstallDate()
  } catch (error) {
    console.warn('[PeakFlow:Trial] getTrialStart failed, using install date:', error)
    return getInstallDate()
  }
}

/**
 * Calculate how many full days of the app-wide trial remain.
 *
 * @returns A non-negative integer (0 means the trial has expired).
 */
export function getTrialDaysRemaining(now: Date = new Date()): number {
  try {
    const elapsedMs = now.getTime() - getTrialStart().getTime()
    // Clamp to 0 so a backwards system clock can't grant extra trial days
    const elapsedDays = Math.max(0, Math.floor(elapsedMs / DAY_MS))
    return Math.max(TRIAL_DAYS - elapsedDays, 0)
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
