/**
 * License validation and activation via LemonSqueezy.
 *
 * PeakFlow uses LemonSqueezy's public license API endpoints which require
 * no API key — only the license_key in the request body.
 *
 * The license key is stored encrypted via the credentials module.
 *
 * Re-checks (B3/S6, 24 Oct 2026):
 * - A good check is trusted for RECHECK_HOURS; after that the app re-checks in
 *   the background (at most once an hour) and keeps the current answer while
 *   it waits, so key presses and panels never wait on the network.
 * - When Lemon Squeezy really answers expired, disabled or not found, that
 *   status is saved and the tools lock.
 * - Network errors, timeouts and server errors never lock by themselves: a
 *   licence stays good for OFFLINE_GRACE_DAYS after the last good check AND
 *   until the app has seen failed checks spread over a day of running time
 *   (FAILED_HOURS_TO_LOCK). The second condition stops a clock moved forward
 *   from locking anyone; a clock moved back can't extend the grace forever,
 *   because then only the failed-check hours count (CLOCK_BACK_HOURS_TO_LOCK).
 *   Once locked, each use asks the server again (at most once a minute) and
 *   unlocks the moment it answers "valid".
 * - Every request has a 10 s timeout; checks, activation and removal run one
 *   at a time, and an answer that arrives after the licence changed is dropped.
 * - A key is only saved after Lemon Squeezy activates it on this computer.
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

/** A good check is trusted this long before a background re-check. */
export const RECHECK_HOURS = 24
/** Network trouble never locks a licence within this many days of the last good check. */
export const OFFLINE_GRACE_DAYS = 14
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Background re-checks: at most one attempt per hour of running time. */
const RETRY_MS = HOUR_MS
/** Failed checks, at most one counted per hour of running time, needed before offline locks. */
const FAILED_HOURS_TO_LOCK = 24
/** Same, when the last good check is dated in the future (clock moved back). */
const CLOCK_BACK_HOURS_TO_LOCK = OFFLINE_GRACE_DAYS * 24
/** When the answer would be "locked": ask again at most once a minute. */
const LOCKED_RETRY_MS = 60 * 1000
/** Every Lemon Squeezy request gives up after this long. */
const REQUEST_TIMEOUT_MS = 10_000
/** Times this far in the future count as "the clock moved back". */
const CLOCK_SKEW_MS = 5 * 60 * 1000

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
  875766: 'all', // PeakFlow Annual subscription
  // v2 offer (created 22 Oct 2026)
  1461019: 'all', // PeakFlow Pro monthly
  1461021: 'all' // PeakFlow, all four tools (one-time)
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
const LS_DEACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/deactivate'

const mainListeners = new Set<() => void>()

/** Main-process services (SnapGrid drag watch) that react to licence changes. */
export function onLicenceChanged(cb: () => void): () => void {
  mainListeners.add(cb)
  return () => mainListeners.delete(cb)
}

function broadcastLicenseStatusChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_SEND.LICENSE_STATUS_CHANGED)
    }
  }
  for (const cb of mainListeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[PeakFlow:License] listener failed:', err)
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

const computerWord = (): string => (process.platform === 'darwin' ? 'Mac' : 'PC')

/** A stored ISO time as epoch ms, or null when missing or unreadable. */
function readTime(key: string): number | null {
  const v = licenseStore.get(key)
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const nowIso = (): string => new Date(Date.now()).toISOString()
const mono = (): number => performance.now()

function failedHours(): number {
  const n = licenseStore.get('failed_check_hours')
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

/** Statuses only a real Lemon Squeezy answer can set; they lock the tools. */
const REVOKED_STATUSES = ['expired', 'disabled', 'not_found'] as const
type RevokedStatus = (typeof REVOKED_STATUSES)[number]
const isRevokedStatus = (s: unknown): s is RevokedStatus => (REVOKED_STATUSES as readonly unknown[]).includes(s)

/**
 * none: no key. licensed: good, or offline but still inside the grace rules.
 * revoked: Lemon Squeezy said expired, disabled or not found. lapsed: offline
 * past the grace rules. unvalidated: a key saved offline by 2.0 that was never
 * activated; it unlocks nothing until the customer enters it again.
 */
export type LicenceState = 'none' | 'licensed' | 'revoked' | 'lapsed' | 'unvalidated'

/**
 * Licences activated before 2.1 get a fresh grace period from the first 2.1
 * launch, so nobody offline on update day is locked by an old timestamp.
 */
function migrateGrace(now: number): void {
  if (licenseStore.has('grace_from') || licenseStore.has('last_check_attempt')) return
  licenseStore.set('grace_from', new Date(now).toISOString())
}

/** Offline grace still running? See the header for the two conditions. */
function withinGrace(now: number): boolean {
  const lastGood = readTime('validation_timestamp')
  const graceFrom = readTime('grace_from')
  const anchor = Math.max(lastGood ?? -Infinity, graceFrom ?? -Infinity)
  const failed = failedHours()
  if (Number.isFinite(anchor) && anchor > now + CLOCK_SKEW_MS) {
    // Last good check dated in the future: the clock moved back. Wall time
    // can't be trusted either way, so only failed-check hours count.
    return failed < CLOCK_BACK_HOURS_TO_LOCK
  }
  const wallExpired = !Number.isFinite(anchor) || now - anchor >= OFFLINE_GRACE_DAYS * DAY_MS
  return !(wallExpired && failed >= FAILED_HOURS_TO_LOCK)
}

/** Sync licence state from what is stored (no network). */
export function getLicenceState(now = Date.now()): LicenceState {
  const key = getCredential('license', 'key')
  if (!key) return 'none'
  const status = licenseStore.get('license_status') as string | undefined
  if (status === 'active' || status === 'valid') {
    migrateGrace(now)
    return withinGrace(now) ? 'licensed' : 'lapsed'
  }
  if (isRevokedStatus(status)) return 'revoked'
  return 'unvalidated'
}

/** Sync check: user has a stored licence that is good right now. */
function hasActiveLicenseRecord(): boolean {
  return getLicenceState() === 'licensed'
}

/** Monotonic times this run (immune to clock changes). */
let lastAttemptMono: number | null = null
let lastLockedAttemptMono: number | null = null
let lastCountedFailureMono: number | null = null

/** Is a background re-check due? */
function backgroundCheckDue(state: LicenceState, now: number): boolean {
  if (state === 'licensed') {
    const lastGood = readTime('validation_timestamp')
    if (lastGood !== null && lastGood <= now + CLOCK_SKEW_MS && now - lastGood < RECHECK_HOURS * HOUR_MS) return false
  }
  return lastAttemptMono === null || mono() - lastAttemptMono >= RETRY_MS
}

function lockedRetryDue(): boolean {
  return lastLockedAttemptMono === null || mono() - lastLockedAttemptMono >= LOCKED_RETRY_MS
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

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const errorText = (body: Record<string, unknown> | null): string =>
  body && typeof body.error === 'string' ? body.error.trim() : ''

/** The License API takes form-encoded bodies and answers JSON. */
function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
}

// ─── One change at a time ───────────────────────────────────────────────────

/** Bumped by every activation and removal; a check that started before is dropped. */
let generation = 0
let mutationChain: Promise<unknown> = Promise.resolve()

/** Activation and removal run one after another, never interleaved. */
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn)
  mutationChain = run.catch(() => undefined)
  return run
}

// ─── Online validation ──────────────────────────────────────────────────────

export type ValidationOutcome =
  | { kind: 'valid'; productId: number | null }
  | { kind: RevokedStatus }
  | { kind: 'transient'; reason: string }

/**
 * Classify a validate response. Only a real Lemon Squeezy answer can lock:
 * a JSON body whose license_key.status is expired or disabled, or a 404 JSON
 * error saying the licence key was not found. Only valid:true unlocks.
 * 5xx, 429, captive-portal HTML, odd bodies and network errors are all
 * 'transient' (no change).
 */
export function classifyValidation(httpStatus: number, body: Record<string, unknown> | null): ValidationOutcome {
  if (!body || httpStatus >= 500 || httpStatus === 429) return { kind: 'transient', reason: `HTTP ${httpStatus}` }
  const lk = body.license_key as Record<string, unknown> | null | undefined
  const status = lk && typeof lk === 'object' ? lk.status : undefined
  if (httpStatus < 300 && body.valid === true) return { kind: 'valid', productId: extractProductId(body) }
  if (status === 'expired') return { kind: 'expired' }
  if (status === 'disabled') return { kind: 'disabled' }
  const err = errorText(body)
  if (httpStatus === 404 && (lk === null || lk === undefined) && /not\s*found/i.test(err) && !/instance/i.test(err)) {
    return { kind: 'not_found' }
  }
  return { kind: 'transient', reason: `HTTP ${httpStatus}, status ${String(status)}` }
}

/**
 * Ask Lemon Squeezy about a key. No side effects; 10 s timeout.
 *
 * POST https://api.lemonsqueezy.com/v1/licenses/validate  license_key=…
 */
export async function validateLicenseOnline(licenseKey: string): Promise<ValidationOutcome> {
  try {
    const response = await postForm(LS_VALIDATE_URL, { license_key: licenseKey })
    const outcome = classifyValidation(response.status, await readJson(response))
    if (outcome.kind !== 'valid') console.warn(`[PeakFlow:License] Validation: ${outcome.kind} (HTTP ${response.status})`)
    return outcome
  } catch (error) {
    console.warn('[PeakFlow:License] Online validation failed (network or timeout):', error)
    return { kind: 'transient', reason: 'network' }
  }
}

let inFlight: Promise<void> | null = null

/**
 * Run one licence check and save the answer. Concurrent callers share the
 * same request. If the licence was activated, replaced or removed while the
 * request ran, the answer is dropped.
 */
export function refreshLicence(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const key = getCredential('license', 'key')
    if (!key) return
    const gen = generation
    lastAttemptMono = mono()
    licenseStore.set('last_check_attempt', nowIso())
    const before = getLicenceState()
    const outcome = await validateLicenseOnline(key)
    if (gen !== generation || getCredential('license', 'key') !== key) return
    if (outcome.kind === 'valid') {
      licenseStore.set('validation_timestamp', nowIso())
      licenseStore.set('license_status', 'active')
      licenseStore.delete('failed_check_hours')
      lastCountedFailureMono = null
      if (outcome.productId !== null) storeProductId(outcome.productId)
      syncLicensedToolInstalls()
    } else if (outcome.kind === 'transient') {
      // Count at most one failed hour per hour of running time
      if (lastCountedFailureMono === null || mono() - lastCountedFailureMono >= HOUR_MS) {
        lastCountedFailureMono = mono()
        licenseStore.set('failed_check_hours', failedHours() + 1)
      }
    } else {
      licenseStore.set('license_status', outcome.kind)
      console.warn(`[PeakFlow:License] Licence ${outcome.kind}: tools locked`)
    }
    if (getLicenceState() !== before) broadcastLicenseStatusChanged()
  })()
    .catch((err) => console.warn('[PeakFlow:License] refresh failed:', err))
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Is the user licensed right now?
 * - Good licence: yes at once; a due re-check runs in the background.
 * - Revoked: no; a due re-check runs in the background (a renewed key recovers).
 * - Lapsed (offline past grace): ask the server now (shared, 10 s cap, at
 *   most once a minute), then answer from what it said.
 * - Unvalidated (2.0 offline save): no; the key must be entered again.
 */
export async function isLicensed(): Promise<boolean> {
  try {
    const state = getLicenceState()
    if (state === 'none' || state === 'unvalidated') return false
    if (state === 'licensed' || state === 'revoked') {
      if (backgroundCheckDue(state, Date.now())) void refreshLicence()
      return state === 'licensed'
    }
    if (inFlight) {
      await inFlight // join the check already running
    } else if (lockedRetryDue()) {
      lastLockedAttemptMono = mono()
      await refreshLicence()
    }
    return getLicenceState() === 'licensed'
  } catch (error) {
    console.warn('[PeakFlow:License] isLicensed check failed:', error)
    // Storage trouble: trust a saved good status within the grace rules only
    try {
      const status = licenseStore.get('license_status')
      return (status === 'active' || status === 'valid') && withinGrace(Date.now())
    } catch {
      return false
    }
  }
}

/** Why a stored licence isn't unlocking anything (for the Plan screen). */
export function licenceProblem(): 'ended' | 'offline' | undefined {
  try {
    const state = getLicenceState()
    if (state === 'revoked') return 'ended'
    if (state === 'lapsed') return 'offline'
  } catch {
    /* no answer */
  }
  return undefined
}

/** Is a licence key saved on this computer (good or not)? */
export function hasLicenceKey(): boolean {
  try {
    return getCredential('license', 'key') !== null
  } catch {
    return false
  }
}

function sentence(text: string): string {
  const t = text.trim()
  if (!t) return t
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}

const SERVER_BUSY = 'The licence server didn’t answer. Try again in a few minutes.'

/**
 * Activate a license key with LemonSqueezy and store it locally.
 *
 * POST https://api.lemonsqueezy.com/v1/licenses/activate
 * Body: license_key, instance_name
 *
 * The key is saved only when Lemon Squeezy activates it on this computer, so
 * the activation limit always applies and a failed attempt never touches the
 * licence already saved. Errors show Lemon Squeezy's own text (e.g. the
 * activation limit); the instance ID is stored so the activation can be freed.
 */
export function activateLicense(licenseKey: string): Promise<{ success: boolean; message: string }> {
  return serialised(async () => {
    generation++
    let response: Response
    try {
      response = await postForm(LS_ACTIVATE_URL, { license_key: licenseKey, instance_name: getInstanceName() })
    } catch (error) {
      console.warn('[PeakFlow:License] Activation network error:', error)
      return { success: false, message: 'Couldn’t reach the licence server. Check your connection and try again.' }
    }

    const result = await readJson(response)
    if (response.ok && result?.activated === true) {
      generation++
      storeCredential('license', 'key', licenseKey)
      const instance = result.instance as Record<string, unknown> | null | undefined
      const instanceId = instance && typeof instance.id === 'string' ? instance.id : null
      if (instanceId) storeCredential('license', 'instance_id', instanceId)
      else deleteCredential('license', 'instance_id')
      licenseStore.set('validation_timestamp', nowIso())
      licenseStore.set('last_check_attempt', nowIso())
      licenseStore.set('license_status', 'active')
      licenseStore.delete('failed_check_hours')
      licenseStore.delete('grace_from')
      const productId = extractProductId(result)
      if (productId !== null) storeProductId(productId)
      else deleteCredential('license', 'product_id')
      syncLicensedToolInstalls()
      broadcastLicenseStatusChanged()
      return { success: true, message: 'License activated successfully!' }
    }

    const lsText = errorText(result)
    console.warn(`[PeakFlow:License] Activation refused: HTTP ${response.status} ${lsText}`)
    if (response.status >= 500 || response.status === 429 || !result) return { success: false, message: SERVER_BUSY }
    return {
      success: false,
      message: lsText ? sentence(lsText) : 'That key wasn’t accepted. Check for typos, or find it in your receipt email.'
    }
  })
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

function clearLocalLicence(): void {
  deleteCredential('license', 'key')
  deleteCredential('license', 'product_id')
  deleteCredential('license', 'instance_id')
  for (const k of ['validation_timestamp', 'license_status', 'last_check_attempt', 'grace_from', 'failed_check_hours']) {
    licenseStore.delete(k)
  }
}

/**
 * "Remove licence from this computer": free this computer's activation with
 * Lemon Squeezy, then clear the key here. The key is cleared only when Lemon
 * Squeezy confirms (deactivated:true) or says the activation is already gone;
 * anything else leaves everything as it was.
 *
 * POST https://api.lemonsqueezy.com/v1/licenses/deactivate  license_key, instance_id
 */
export function deactivateLicense(): Promise<{ success: boolean; message: string }> {
  return serialised(async () => {
    generation++
    const key = getCredential('license', 'key')
    const instanceId = getCredential('license', 'instance_id')
    const pc = computerWord()
    if (key && instanceId) {
      let response: Response
      try {
        response = await postForm(LS_DEACTIVATE_URL, { license_key: key, instance_id: instanceId })
      } catch (error) {
        console.warn('[PeakFlow:License] Deactivate network error:', error)
        return { success: false, message: 'Couldn’t reach the licence server, so nothing was removed. Try again when you’re online.' }
      }
      const body = await readJson(response)
      const err = errorText(body)
      const confirmed = response.ok && body?.deactivated === true
      const alreadyGone = response.status === 404 && /not\s*found/i.test(err)
      console.log(`[PeakFlow:License] Deactivate: HTTP ${response.status}, deactivated=${String(body?.deactivated)}`)
      if (!confirmed && !alreadyGone) {
        if (response.status >= 500 || response.status === 429 || !body) return { success: false, message: SERVER_BUSY }
        return { success: false, message: err ? sentence(err) : SERVER_BUSY }
      }
    }
    if (getCredential('license', 'key') !== key) return { success: false, message: SERVER_BUSY }
    generation++
    clearLocalLicence()
    console.log('[PeakFlow:License] License removed from this computer')
    broadcastLicenseStatusChanged()
    if (key && !instanceId) {
      return {
        success: true,
        message: `Removed from this ${pc}. Keys added before PeakFlow 2.1 can’t free their activation from the app, so it still counts toward your limit. Email contact@getpeakflow.pro and we’ll free it.`
      }
    }
    return { success: true, message: 'Licence removed' }
  })
}
