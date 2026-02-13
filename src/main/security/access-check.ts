/**
 * Unified access gate for PeakFlow tools.
 *
 * `checkAccess()` is the single entry point that the rest of the app calls
 * to determine whether the user may use a tool. It checks, in order:
 *
 *   1. Active license key  ->  full access
 *   2. Trial still active  ->  access with countdown
 *   3. Trial expired       ->  blocked
 *
 * Port of the Python `check_access()` function.
 */

import type { AccessStatus } from '@shared/ipc-types'
import { isLicensed } from './license'
import { getTrialDaysRemaining, isTrialActive } from './trial'

/**
 * Determine whether the user has access to a PeakFlow tool.
 *
 * @param _toolName - Reserved for future per-tool gating (currently unused)
 * @returns An {@link AccessStatus} object describing the current access state
 */
export async function checkAccess(_toolName = 'PeakFlow'): Promise<AccessStatus> {
  try {
    // 1. Licensed users get unconditional access
    const licensed = await isLicensed()
    if (licensed) {
      return {
        allowed: true,
        message: 'Licensed',
        daysRemaining: -1, // unlimited
        isLicensed: true
      }
    }

    // 2. Trial still running
    const daysRemaining = getTrialDaysRemaining()
    if (isTrialActive()) {
      return {
        allowed: true,
        message: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in trial`,
        daysRemaining,
        isLicensed: false
      }
    }

    // 3. Trial expired
    return {
      allowed: false,
      message: 'trial_expired',
      daysRemaining: 0,
      isLicensed: false
    }
  } catch (error) {
    console.warn('[PeakFlow:AccessCheck] checkAccess failed:', error)
    // Fail open during errors so users aren't locked out by bugs
    return {
      allowed: true,
      message: 'Access check unavailable',
      daysRemaining: -1,
      isLicensed: false
    }
  }
}
