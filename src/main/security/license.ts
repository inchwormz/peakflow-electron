/**
 * License validation and activation via LemonSqueezy.
 *
 * PeakFlow uses LemonSqueezy's public license API endpoints which require
 * no API key — only the license_key in the request body.
 *
 * The license key is stored encrypted via the credentials module. A cached
 * validation timestamp avoids hitting the network on every app launch;
 * re-validation happens after LICENSE_CACHE_DAYS (30).
 *
 * Port of the Python `license.py` module.
 */

import os from 'node:os'
import Store from 'electron-store'
import { ToolId } from '@shared/tool-ids'
import { storeCredential, getCredential, deleteCredential } from './credentials'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of days a successful online validation is cached locally. */
export const LICENSE_CACHE_DAYS = 30

/**
 * Map LemonSqueezy product_id → which tool(s) the license covers.
 * 'all' = subscription or bundle (every tool).
 * Individual tool IDs = perpetual single-tool license.
 * Unknown product_ids default to 'all' for backwards compatibility.
 */
const PRODUCT_TOOL_MAP: Record<number, ToolId | 'all'> = {
  // Individual perpetual licenses ($9.99 one-time)
  861329: ToolId.FocusDim, // live
  861493: ToolId.FocusDim, // test mode
  // All other product IDs (subscriptions, etc.) default to 'all' via getToolsForProduct()
}

/** Pricing page URL shown when the trial expires. */
export const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

/** LemonSqueezy public license endpoints (no API key required). */
const LS_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate'
const LS_ACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/activate'

// ─── Store ──────────────────────────────────────────────────────────────────

/** Dedicated store for license metadata (validation cache, status). */
const licenseStore = new Store({ name: 'peakflow-license' })

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the instance name sent to LemonSqueezy on activation.
 * Matches the Python convention: `PeakFlow-{COMPUTERNAME}`.
 */
function getInstanceName(): string {
  return `PeakFlow-${os.hostname()}`
}

/**
 * Check whether the cached validation is still fresh (< LICENSE_CACHE_DAYS old).
 */
function isCacheValid(): boolean {
  try {
    const cached = licenseStore.get('validation_timestamp') as string | undefined
    if (!cached) return false

    const cachedDate = new Date(cached)
    if (isNaN(cachedDate.getTime())) return false

    const now = new Date()
    const elapsedMs = now.getTime() - cachedDate.getTime()
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24)

    return elapsedDays < LICENSE_CACHE_DAYS
  } catch {
    return false
  }
}

/**
 * Persist a successful validation timestamp and status.
 */
function cacheValidation(status: string): void {
  licenseStore.set('validation_timestamp', new Date().toISOString())
  licenseStore.set('license_status', status)
}

/**
 * Store the product_id from a LemonSqueezy response.
 */
function storeProductId(productId: number): void {
  storeCredential('license', 'product_id', String(productId))
  console.log(`[PeakFlow:License] Stored product_id: ${productId}`)
}

/**
 * Look up which tool(s) a product_id grants access to.
 * Unknown IDs default to 'all' (backwards compat for subscription keys).
 */
function getToolsForProduct(productId: number): ToolId | 'all' {
  return PRODUCT_TOOL_MAP[productId] ?? 'all'
}

/**
 * Extract meta.product_id from a LemonSqueezy API response.
 */
function extractProductId(result: Record<string, unknown>): number | null {
  const meta = result.meta as Record<string, unknown> | undefined
  if (meta && typeof meta.product_id === 'number') {
    return meta.product_id
  }
  return null
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether the user has a valid (or recently-validated) license key.
 *
 * 1. Retrieve the stored key from the credential store.
 * 2. If a cached validation exists and is < 30 days old, return `true`.
 * 3. Otherwise, validate online.
 * 4. On network failure, trust the local key if one is stored.
 */
export async function isLicensed(): Promise<boolean> {
  try {
    const key = getCredential('license', 'key')
    if (!key) return false

    // Check cached validation
    if (isCacheValid()) {
      const status = licenseStore.get('license_status') as string | undefined
      return status === 'active' || status === 'valid'
    }

    // Attempt online validation
    const valid = await validateLicenseOnline(key)
    return valid
  } catch (error) {
    console.warn('[PeakFlow:License] isLicensed check failed:', error)
    // If we have a stored key, give the user the benefit of the doubt
    return getCredential('license', 'key') !== null
  }
}

/**
 * Validate a license key against the LemonSqueezy API.
 *
 * POST https://api.lemonsqueezy.com/v1/licenses/validate
 * Body: { license_key: string }
 *
 * This is a PUBLIC endpoint — no API key header required.
 *
 * @param licenseKey - The license key to validate
 * @returns `true` if the server confirms the key is valid/active
 */
export async function validateLicenseOnline(licenseKey: string): Promise<boolean> {
  try {
    const response = await fetch(LS_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey })
    })

    if (!response.ok) {
      console.warn(`[PeakFlow:License] Validation HTTP ${response.status}`)
      return false
    }

    const result = (await response.json()) as Record<string, unknown>

    // LemonSqueezy returns { valid: true/false, license_key: { status: 'active' | ... } }
    const isValid =
      result.valid === true ||
      (result.license_key as Record<string, unknown> | undefined)?.status === 'active'

    if (isValid) {
      cacheValidation('active')
      // Store product_id for per-tool gating
      const productId = extractProductId(result)
      if (productId !== null) {
        storeProductId(productId)
      }
    }

    return isValid
  } catch (error) {
    console.warn('[PeakFlow:License] Online validation failed (network?):', error)
    return false
  }
}

/**
 * Activate a license key with LemonSqueezy and store it locally.
 *
 * POST https://api.lemonsqueezy.com/v1/licenses/activate
 * Body: { license_key: string, instance_name: string }
 *
 * On network errors the key is stored locally with an "unvalidated" flag
 * so the user isn't blocked. It will be validated on next online check.
 *
 * @param licenseKey - The license key to activate
 * @returns An object with `success` flag and human-readable `message`
 */
export async function activateLicense(
  licenseKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(LS_ACTIVATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: getInstanceName()
      })
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.warn(`[PeakFlow:License] Activation HTTP ${response.status}: ${errorBody}`)
      return {
        success: false,
        message: `Activation failed (HTTP ${response.status}). Please check your license key.`
      }
    }

    const result = (await response.json()) as Record<string, unknown>

    const activated =
      result.activated === true ||
      (result.license_key as Record<string, unknown> | undefined)?.status === 'active'

    if (activated) {
      // Store key + cache validation
      storeCredential('license', 'key', licenseKey)
      cacheValidation('active')
      // Store product_id for per-tool gating
      const productId = extractProductId(result)
      if (productId !== null) {
        storeProductId(productId)
      }
      return { success: true, message: 'License activated successfully!' }
    }

    // Server responded but didn't confirm activation
    const errorMsg =
      (result.error as string) ||
      (result.message as string) ||
      'Unknown activation error'
    return { success: false, message: errorMsg }
  } catch (error) {
    // Network error — store key locally for later validation
    console.warn('[PeakFlow:License] Activation network error, storing locally:', error)
    storeCredential('license', 'key', licenseKey)
    licenseStore.set('license_status', 'unvalidated')
    return {
      success: true,
      message: 'License saved. Will verify when online.'
    }
  }
}

/**
 * Check whether the stored license covers a specific tool.
 * Returns true if: no product_id stored (legacy/backwards compat), product maps to 'all',
 * or product maps to the requested tool.
 */
export function isToolLicensed(toolId: string): boolean {
  const stored = getCredential('license', 'product_id')
  console.log(`[PeakFlow:License] isToolLicensed(${toolId}) — stored product_id raw: "${stored}"`)
  if (!stored) return true // No product_id = legacy key, allow all

  const productId = parseInt(stored, 10)
  console.log(`[PeakFlow:License] parsed productId: ${productId}, map lookup: ${PRODUCT_TOOL_MAP[productId] ?? 'NOT IN MAP → defaults to all'}`)
  if (isNaN(productId)) return true // Corrupt data, fail open

  const covers = getToolsForProduct(productId)
  if (covers === 'all') return true
  return covers === toolId
}

/**
 * Deactivate the current license and clear stored credentials.
 *
 * @returns `true` if credentials were cleared (does NOT call the deactivate API).
 */
export function deactivateLicense(): boolean {
  try {
    deleteCredential('license', 'key')
    deleteCredential('license', 'product_id')
    licenseStore.delete('validation_timestamp')
    licenseStore.delete('license_status')
    console.log('[PeakFlow:License] License deactivated locally')
    return true
  } catch (error) {
    console.warn('[PeakFlow:License] deactivateLicense failed:', error)
    return false
  }
}
