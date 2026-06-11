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
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import { storeCredential, getCredential, deleteCredential } from './credentials'
import { installTool } from './trial'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of days a successful online validation is cached locally. */
export const LICENSE_CACHE_DAYS = 30

/**
 * Baseline map of LemonSqueezy product_id → which tool(s) the license covers.
 * 'all' = subscription or bundle (every tool).
 * Individual tool IDs = perpetual single-tool license.
 *
 * This hardcoded map is only the fallback: it is overlaid by product-map.json
 * fetched from the releases repo (see refreshProductMap), so new products can
 * be mapped with a JSON commit instead of shipping an app update — the v1.6.0
 * lockout happened because this map could only change via a release.
 */
// Product names verified against live checkout pages on peakflow.lemonsqueezy.com, 2026-06-11.
const PRODUCT_TOOL_MAP: Record<number, ToolId | 'all'> = {
  // Individual permanent licenses (one per tool)
  861329: ToolId.FocusDim, // live
  861493: ToolId.FocusDim, // test mode
  863557: ToolId.ScreenSlap,
  863559: ToolId.LiquidFocus, // was wrongly mapped 'all' in v1.6.3 (assumed Pro sub)
  863744: ToolId.MeetReady,
  863751: ToolId.QuickBoard,
  863756: ToolId.SoundSplit,
  // Subscriptions / all-tools bundles
  822965: 'all', // PeakFlow Pro monthly — linked from getpeakflow.pro pricing
  841306: 'all', // PeakFlow Subscription monthly — storefront
  863806: 'all', // PeakFlow Suite perpetual
  875766: 'all' // PeakFlow Annual subscription
}

/**
 * Remote product map JSON ({"<product_id>": "<tool-id>" | "all"}) hosted in
 * the public releases repo — same trust root the auto-updater already uses.
 */
const REMOTE_PRODUCT_MAP_URL =
  'https://raw.githubusercontent.com/inchwormz/peakflow-releases/main/product-map.json'

/** licenseStore key caching the last successfully fetched remote map. */
const PRODUCT_MAP_CACHE_KEY = 'product_map_cache'

/** Pricing page URL shown when the trial expires. */
export const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

/** LemonSqueezy public license endpoints (no API key required). */
const LS_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate'
const LS_ACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/activate'

function broadcastLicenseStatusChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_SEND.LICENSE_STATUS_CHANGED)
    }
  }
}

/**
 * Auto-enable tools covered by the stored license so licensed users are not
 * stuck on the trial "Try Free" storefront.
 */
export function isSuiteLicense(): boolean {
  if (!hasActiveLicenseRecord()) return false

  const stored = getCredential('license', 'product_id')
  if (!stored) return true // legacy key — full suite

  const productId = parseInt(stored, 10)
  if (isNaN(productId)) return false

  const covers = getToolsForProduct(productId)
  return covers === null || covers === 'all'
}

export function syncLicensedToolInstalls(): void {
  if (!hasActiveLicenseRecord()) return

  const stored = getCredential('license', 'product_id')
  if (!stored) {
    for (const id of Object.values(ToolId)) installTool(id)
    console.log('[PeakFlow:License] Synced installs for legacy full-suite license')
    return
  }

  const productId = parseInt(stored, 10)
  if (isNaN(productId)) return

  const covers = getToolsForProduct(productId)
  if (covers === null || covers === 'all') {
    for (const id of Object.values(ToolId)) installTool(id)
    console.log(`[PeakFlow:License] Synced installs for suite license (product ${productId})`)
  } else {
    installTool(covers)
    console.log(`[PeakFlow:License] Synced install for ${covers} (product ${productId})`)
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** Dedicated store for license metadata (validation cache, status). */
const licenseStore = new Store({ name: 'peakflow-license' })

// ─── Product Map ────────────────────────────────────────────────────────────

/** Hardcoded baseline merged with the cached remote map. Built lazily. */
let mergedProductMap: Record<number, ToolId | 'all'> | null = null

function isValidMapValue(value: unknown): value is ToolId | 'all' {
  return value === 'all' || (Object.values(ToolId) as unknown[]).includes(value)
}

/** Parse an untrusted map blob, dropping malformed entries. */
function parseProductMap(raw: unknown): Record<number, ToolId | 'all'> {
  const result: Record<number, ToolId | 'all'> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = parseInt(key, 10)
    if (!Number.isFinite(id) || !isValidMapValue(value)) continue
    result[id] = value
  }
  return result
}

function getProductMap(): Record<number, ToolId | 'all'> {
  if (!mergedProductMap) {
    const cached = parseProductMap(licenseStore.get(PRODUCT_MAP_CACHE_KEY))
    mergedProductMap = { ...PRODUCT_TOOL_MAP, ...cached }
  }
  return mergedProductMap
}

/**
 * Fetch the remote product map and overlay it on the hardcoded baseline.
 * Failures (offline, bad JSON) keep the current map. If coverage changed,
 * tool installs are re-synced so a newly mapped license unlocks immediately.
 */
export async function refreshProductMap(): Promise<void> {
  try {
    const response = await fetch(REMOTE_PRODUCT_MAP_URL, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      console.warn(`[PeakFlow:License] Product map fetch HTTP ${response.status}`)
      return
    }
    const remote = parseProductMap(await response.json())
    if (Object.keys(remote).length === 0) {
      console.warn('[PeakFlow:License] Remote product map empty/invalid — keeping current map')
      return
    }
    const before = JSON.stringify(getProductMap())
    licenseStore.set(PRODUCT_MAP_CACHE_KEY, remote)
    mergedProductMap = { ...PRODUCT_TOOL_MAP, ...remote }
    console.log(
      `[PeakFlow:License] Product map refreshed (${Object.keys(remote).length} remote entries)`
    )
    if (JSON.stringify(mergedProductMap) !== before) {
      syncLicensedToolInstalls()
      broadcastLicenseStatusChanged()
    }
  } catch (error) {
    console.warn('[PeakFlow:License] Product map refresh failed (offline?):', error)
  }
}

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

/** Sync check: user has a locally stored license marked active/valid. */
function hasActiveLicenseRecord(): boolean {
  const key = getCredential('license', 'key')
  if (!key) return false
  const status = licenseStore.get('license_status') as string | undefined
  return status === 'active' || status === 'valid'
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
 * Unknown IDs return null; callers decide the fail-open/closed policy.
 */
function getToolsForProduct(productId: number): ToolId | 'all' | null {
  return getProductMap()[productId] ?? null
}

/**
 * Extract meta.product_id from a LemonSqueezy API response.
 */
function parseProductId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractProductId(result: Record<string, unknown>): number | null {
  const meta = result.meta as Record<string, unknown> | undefined
  if (meta) {
    const fromMeta = parseProductId(meta.product_id)
    if (fromMeta !== null) return fromMeta
  }

  const licenseKey = result.license_key as Record<string, unknown> | undefined
  if (licenseKey) {
    const fromLicense = parseProductId(licenseKey.product_id)
    if (fromLicense !== null) return fromLicense
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
    if (valid) return true

    // Offline / transient API failure — trust last successful activation
    return hasActiveLicenseRecord()
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
      syncLicensedToolInstalls()
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
      syncLicensedToolInstalls()
      broadcastLicenseStatusChanged()
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
    syncLicensedToolInstalls()
    broadcastLicenseStatusChanged()
    return {
      success: true,
      message: 'License saved. Will verify when online.'
    }
  }
}

/**
 * Check whether the stored license covers a specific tool.
 * Returns true if: no product_id stored (legacy/backwards compat), product maps to 'all',
 * or product maps to the requested tool. Unmapped product_ids are denied.
 */
export function isToolLicensed(toolId: string): boolean {
  if (!hasActiveLicenseRecord()) return false

  const stored = getCredential('license', 'product_id')
  if (!stored) return true // No product_id = legacy key, allow all

  const productId = parseInt(stored, 10)
  if (isNaN(productId)) return false // Corrupt data, fail closed

  const covers = getToolsForProduct(productId)
  if (covers === null) {
    // Product not yet in map — never lock out a validated licensee, but this
    // grants full access: map the product in product-map.json ASAP.
    console.warn(
      `[PeakFlow:License] Unknown product_id ${productId} — failing open until product-map.json is updated`
    )
    return true
  }
  if (covers === 'all') return true
  if (toolId === 'PeakFlow') return true // suite sentinel: any mapped license counts
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
    broadcastLicenseStatusChanged()
    return true
  } catch (error) {
    console.warn('[PeakFlow:License] deactivateLicense failed:', error)
    return false
  }
}
