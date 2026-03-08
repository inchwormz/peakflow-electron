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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOnboardConfig(raw: unknown): OnboardConfig {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}

  const tags = Array.isArray(data.tags)
    ? data.tags
      .map((tag) => normalizeText(tag))
      .filter((tag) => tag.length > 0)
    : []

  const transforms = Array.isArray(data.transforms)
    ? data.transforms
      .map((transform) => {
        const item = transform && typeof transform === 'object' ? transform as Record<string, unknown> : {}
        const steps = Array.isArray(item.steps)
          ? item.steps
            .map((step) => {
              const stepItem = step && typeof step === 'object' ? step as Record<string, unknown> : {}
              const type = normalizeText(stepItem.type)
              const label = normalizeText(stepItem.label)
              if (!type || !label) return null
              return { type, label }
            })
            .filter((step): step is { type: string; label: string } => step !== null)
          : []

        const name = normalizeText(item.name)
        if (!name || steps.length === 0) return null
        return { name, steps }
      })
      .filter((transform): transform is OnboardConfig['transforms'][number] => transform !== null)
    : []

  const pinnedTemplates = Array.isArray(data.pinnedTemplates)
    ? data.pinnedTemplates
      .map((template) => {
        const item = template && typeof template === 'object' ? template as Record<string, unknown> : {}
        const text = typeof item.text === 'string' ? item.text : ''
        const label = normalizeText(item.label)
        if (!text.trim() || !label) return null
        return { text, label }
      })
      .filter((template): template is OnboardConfig['pinnedTemplates'][number] => template !== null)
    : []

  const autoTriggers = Array.isArray(data.autoTriggers)
    ? data.autoTriggers
      .map((trigger) => {
        const item = trigger && typeof trigger === 'object' ? trigger as Record<string, unknown> : {}
        const pattern = typeof item.pattern === 'string' ? item.pattern : ''
        const action = normalizeText(item.action)
        if (!pattern.trim() || !action) return null
        return { pattern, action }
      })
      .filter((trigger): trigger is OnboardConfig['autoTriggers'][number] => trigger !== null)
    : []

  const workflows = Array.isArray(data.workflows)
    ? data.workflows
      .map((workflow) => {
        const item = workflow && typeof workflow === 'object' ? workflow as Record<string, unknown> : {}
        const items = Array.isArray(item.items)
          ? item.items
            .map((workflowItem) => {
              const step = workflowItem && typeof workflowItem === 'object' ? workflowItem as Record<string, unknown> : {}
              const label = normalizeText(step.label)
              const text = typeof step.text === 'string' ? step.text : ''
              if (!label || !text.trim()) return null
              return { label, text }
            })
            .filter((step): step is OnboardConfig['workflows'][number]['items'][number] => step !== null)
          : []

        const name = normalizeText(item.name)
        const description = normalizeText(item.description)
        if (!name || !description || items.length === 0) return null
        return { name, description, items }
      })
      .filter((workflow): workflow is OnboardConfig['workflows'][number] => workflow !== null)
    : []

  const formProfiles = Array.isArray(data.formProfiles)
    ? data.formProfiles
      .map((profile) => {
        const item = profile && typeof profile === 'object' ? profile as Record<string, unknown> : {}
        const fields = Array.isArray(item.fields)
          ? item.fields
            .map((field) => {
              const fieldItem = field && typeof field === 'object' ? field as Record<string, unknown> : {}
              const label = normalizeText(fieldItem.label)
              const value = typeof fieldItem.value === 'string' ? fieldItem.value : ''
              const type = normalizeText(fieldItem.type) === 'template' ? 'template' : 'text'
              if (!label || !value.trim()) return null
              return { label, value, type }
            })
            .filter((field): field is OnboardConfig['formProfiles'][number]['fields'][number] => field !== null)
          : []

        const name = normalizeText(item.name)
        if (!name || fields.length === 0) return null
        return { name, fields }
      })
      .filter((profile): profile is OnboardConfig['formProfiles'][number] => profile !== null)
    : []

  return {
    tags,
    transforms,
    pinnedTemplates,
    autoTriggers,
    workflows,
    formProfiles
  }
}

export async function aiOnboard(answers: OnboardAnswers): Promise<AiOnboardResult> {
  const licenseKey = getLicenseKey() || 'trial'

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
      config: normalizeOnboardConfig(data.config)
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
  pasteSequences: Array<{ items: string[]; count: number }>
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
