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
import { isLicensed, isToolLicensed as isLicenseForTool } from './license'
import { isToolInstalled, getToolTrialDaysRemaining } from './trial'

/**
 * Determine whether the user has access to a PeakFlow tool.
 *
 * Check order:
 *   1. Tool not installed          → blocked (storefront gate)
 *   2. Licensed AND covers tool    → full access
 *   3. Per-tool trial still active → access with countdown
 *   4. Trial expired + licensed    → blocked (wrong tool)
 *   5. Trial expired + no license  → blocked
 *
 * @param toolId - The tool being opened (used for per-tool license gating)
 * @returns An {@link AccessStatus} object describing the current access state
 */
export async function checkAccess(toolId = 'PeakFlow'): Promise<AccessStatus> {
  try {
    // 1. Tool not installed → storefront gate
    if (toolId !== 'PeakFlow' && !isToolInstalled(toolId)) {
      return {
        allowed: false,
        message: 'tool_not_installed',
        daysRemaining: 0,
        isLicensed: false,
        isToolLicensed: false
      }
    }

    const licensed = await isLicensed()
    const toolCovered = licensed && isLicenseForTool(toolId)
    const daysRemaining = getToolTrialDaysRemaining(toolId)
    const trialActive = daysRemaining > 0

    // 2. License covers this specific tool → full access
    if (toolCovered) {
      return {
        allowed: true,
        message: 'Licensed',
        daysRemaining: -1,
        isLicensed: true,
        isToolLicensed: true
      }
    }

    // 3. Per-tool trial still running → access with countdown
    if (trialActive) {
      return {
        allowed: true,
        message: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in trial`,
        daysRemaining,
        isLicensed: licensed,
        isToolLicensed: false
      }
    }

    // 4. Licensed but for a different tool (per-tool trial expired)
    if (licensed) {
      return {
        allowed: false,
        message: 'tool_not_licensed',
        daysRemaining: 0,
        isLicensed: true,
        isToolLicensed: false
      }
    }

    // 5. No license, trial expired
    return {
      allowed: false,
      message: 'trial_expired',
      daysRemaining: 0,
      isLicensed: false,
      isToolLicensed: false
    }
  } catch (error) {
    console.warn('[PeakFlow:AccessCheck] checkAccess failed:', error)
    return {
      allowed: true,
      message: 'Access check unavailable',
      daysRemaining: -1,
      isLicensed: false,
      isToolLicensed: false
    }
  }
}
