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
import { encryptString, decryptString, isAvailable } from './safe-storage'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Length of the free trial in days. */
export const TRIAL_DAYS = 14

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
