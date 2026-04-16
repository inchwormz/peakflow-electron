/**
 * Trial period management.
 *
 * Tracks the install date (encrypted at rest via safeStorage) and computes
 * how many trial days remain. The install date is stamped on first run and
 * never changes.
 *
 * Port of the Python trial module with TRIAL_DAYS updated to 14.
 */

import Store from 'electron-store'
import { ToolId } from '@shared/tool-ids'
import { encryptString, decryptString, isAvailable } from './safe-storage'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Length of the free trial in days. */
export const TRIAL_DAYS = 14

// ─── Store ──────────────────────────────────────────────────────────────────

/** Dedicated store for license / trial data — kept separate from tool configs. */
const licenseStore = new Store({ name: 'peakflow-license' })

function tryParseDate(value: string): Date | null {
  const parsed = new Date(value)
  return isNaN(parsed.getTime()) ? null : parsed
}

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
        const decrypted = decryptString(stored, false)
        if (decrypted !== null) {
          const parsed = tryParseDate(decrypted)
          if (parsed) return parsed
        }
      }

      // Fallback: try parsing as a raw ISO string (unencrypted dev env)
      const raw = tryParseDate(stored)
      if (raw) return raw

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

/**
 * Calculate how many full trial days remain.
 *
 * @returns A non-negative integer (0 means the trial has expired).
 */
export function getTrialDaysRemaining(): number {
  try {
    const installDate = getInstallDate()
    const now = new Date()
    const elapsedMs = now.getTime() - installDate.getTime()
    // Clamp to 0 so a backwards system clock can't grant extra trial days
    const elapsedDays = Math.max(0, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)))
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
 * Check whether a tool has been "installed" (enabled by the user).
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
      const decrypted = decryptString(stored, false)
      if (decrypted !== null) {
        const parsed = tryParseDate(decrypted)
        if (parsed) return parsed
      }
    }

    // Fallback: try parsing as raw ISO string
    const raw = tryParseDate(stored)
    if (raw) return raw

    return null
  } catch {
    return null
  }
}

/**
 * Calculate how many per-tool trial days remain for a specific tool.
 * Returns 0 if the tool isn't installed or the trial has expired.
 */
export function getToolTrialDaysRemaining(toolId: ToolId | string): number {
  const installDate = getToolTrialStart(toolId)
  if (!installDate) return 0

  const now = new Date()
  const elapsedMs = now.getTime() - installDate.getTime()
  const elapsedDays = Math.max(0, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)))
  return Math.max(TRIAL_DAYS - elapsedDays, 0)
}
