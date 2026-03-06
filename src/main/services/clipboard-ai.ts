/**
 * AI proxy client for QuickBoard.
 * All AI calls go through the Vercel serverless proxy at getpeakflow.pro/api/ai.
 * API key never touches the Electron binary.
 */

import { checkAccess } from '../security/access-check'
import { ToolId } from '@shared/tool-ids'

const PROXY_URL =
  import.meta.env.MAIN_VITE_AI_PROXY_URL || 'https://getpeakflow.pro/api/ai'

// ─── License key retrieval ───────────────────────────────────────────────────

function getLicenseKey(): string | null {
  try {
    const Store = require('electron-store')
    const store = new Store({ name: 'peakflow-license' })
    return store.get('license_key', null) as string | null
  } catch {
    return null
  }
}

// ─── Access check ────────────────────────────────────────────────────────────

export async function checkAiAccess(): Promise<{ allowed: boolean }> {
  const status = await checkAccess(ToolId.QuickBoard)
  return { allowed: status.isToolLicensed }
}

// ─── Transform ───────────────────────────────────────────────────────────────

export interface AiTransformResult {
  ok: boolean
  result?: string
  error?: string
  usage?: { remaining: number }
}

export async function aiTransform(
  type: string,
  text: string,
  targetLang?: string
): Promise<AiTransformResult> {
  const access = await checkAiAccess()
  if (!access.allowed) {
    return { ok: false, error: 'not_licensed' }
  }

  const licenseKey = getLicenseKey()
  if (!licenseKey) {
    return { ok: false, error: 'no_license_key' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'transform',
        license_key: licenseKey,
        payload: { type, text, targetLang }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data.error || `http_${res.status}` }
    }

    return {
      ok: true,
      result: data.result,
      usage: data.usage
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' }
    }
    return { ok: false, error: 'network_error' }
  }
}

// ─── Onboard ─────────────────────────────────────────────────────────────────

export interface OnboardAnswers {
  role: string
  apps: string[]
  copyPatterns: string[]
  repetitiveText: string
}

export interface OnboardConfig {
  tags: string[]
  transforms: Array<{ name: string; steps: Array<{ type: string; label: string }> }>
  pinnedTemplates: Array<{ text: string; label: string }>
  autoTriggers: Array<{ pattern: string; action: string }>
  workflows: Array<{
    name: string
    description: string
    items: Array<{ label: string; text: string }>
  }>
  formProfiles: Array<{
    name: string
    fields: Array<{ label: string; value: string; type: string }>
  }>
}

export interface AiOnboardResult {
  ok: boolean
  config?: OnboardConfig
  error?: string
}

export async function aiOnboard(answers: OnboardAnswers): Promise<AiOnboardResult> {
  const access = await checkAiAccess()
  if (!access.allowed) {
    return { ok: false, error: 'not_licensed' }
  }

  const licenseKey = getLicenseKey()
  if (!licenseKey) {
    return { ok: false, error: 'no_license_key' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'onboard',
        license_key: licenseKey,
        payload: answers
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data.error || `http_${res.status}` }
    }

    return {
      ok: true,
      config: data.config as OnboardConfig
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' }
    }
    return { ok: false, error: 'network_error' }
  }
}

// ─── Suggest ─────────────────────────────────────────────────────────────────

export interface HistoryStats {
  totalItems: number
  contentTypes: Record<string, number>
  topSourceApps: string[]
  repeatedItems: Array<{ preview: string; count: number }>
  existingTags: string[]
  existingWorkflows: string[]
}

export interface AiSuggestion {
  id: string
  type: 'pin_template' | 'create_tag' | 'create_workflow' | 'add_trigger'
  reason: string
  action: Record<string, unknown>
  label: string
}

export interface AiSuggestResult {
  ok: boolean
  suggestions?: AiSuggestion[]
  error?: string
}

export async function aiSuggest(historyStats: HistoryStats): Promise<AiSuggestResult> {
  const access = await checkAiAccess()
  if (!access.allowed) {
    return { ok: false, error: 'not_licensed' }
  }

  const licenseKey = getLicenseKey()
  if (!licenseKey) {
    return { ok: false, error: 'no_license_key' }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'suggest',
        license_key: licenseKey,
        payload: { historyStats }
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data.error || `http_${res.status}` }
    }

    return {
      ok: true,
      suggestions: data.suggestions as AiSuggestion[]
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' }
    }
    return { ok: false, error: 'network_error' }
  }
}
