/**
 * QuickBoard's AI actions, run on the user's own ChatGPT or Claude
 * subscription through their local Codex or Claude Code (local-ai.ts).
 * PeakFlow pays for nothing and sees nothing: prompts go straight from this
 * computer to the provider the user signed in to.
 */

import { checkAccess } from '../security/access-check'
import { redactPersonalInfo } from '../security/secret-detection'
import { ToolId } from '@shared/tool-ids'
import { getDefaultAiProvider, listAiProviders, runLocalAi } from './local-ai'
import {
  TRANSFORM_PROMPTS,
  getTranslatePrompt,
  ONBOARD_PROMPT,
  DEV_ONBOARD_ADDENDUM,
  SUGGEST_PROMPT,
  parseJsonReply
} from './clipboard-ai-prompts'

/** Longest clip sent for a transform */
const MAX_TEXT_LENGTH = 10000

export type AiError =
  | 'not_licensed'
  | 'no_provider'
  | 'not_signed_in'
  | 'timeout'
  | 'failed'
  | 'parse_error'
  | 'unknown_transform_type'

// ─── Access check ────────────────────────────────────────────────────────────

export interface AiAccess {
  allowed: boolean
  reason?: 'not_licensed' | 'no_provider'
  /** e.g. "ChatGPT" or "Claude", when one is connected */
  provider?: string
}

export async function checkAiAccess(): Promise<AiAccess> {
  const status = await checkAccess(ToolId.QuickBoard)
  if (!status.isToolLicensed) return { allowed: false, reason: 'not_licensed' }
  const id = await getDefaultAiProvider()
  if (!id) return { allowed: false, reason: 'no_provider' }
  const provider = (await listAiProviders()).find((p) => p.id === id)
  return { allowed: true, provider: provider?.label ?? 'AI' }
}

async function run(
  system: string,
  prompt: string,
  timeoutMs: number,
  json = false
): Promise<{ ok: true; text: string } | { ok: false; error: AiError }> {
  const access = await checkAiAccess()
  if (!access.allowed) return { ok: false, error: access.reason ?? 'no_provider' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await runLocalAi({ system, prompt, json, signal: controller.signal })
    if (controller.signal.aborted) return { ok: false, error: 'timeout' }
    if (!res.ok || !res.text) return { ok: false, error: res.error ?? 'failed' }
    return { ok: true, text: res.text.trim() }
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'failed' }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Transform ───────────────────────────────────────────────────────────────

export interface AiTransformResult {
  ok: boolean
  result?: string
  error?: string
}

/** The user picked this clip and this action, so the clip is sent as is. */
export async function aiTransform(
  type: string,
  text: string,
  targetLang?: string
): Promise<AiTransformResult> {
  const system = type === 'translate' ? (targetLang ? getTranslatePrompt(targetLang) : '') : TRANSFORM_PROMPTS[type]
  if (!system) return { ok: false, error: 'unknown_transform_type' }
  const res = await run(system, text.slice(0, MAX_TEXT_LENGTH), 60000)
  return res.ok ? { ok: true, result: res.text } : { ok: false, error: res.error }
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
  if (!answers.role) return { ok: false, error: 'failed' }
  const a = answers as OnboardAnswers & {
    devContext?: Record<string, string | string[] | undefined>
    aiTools?: string[]
  }
  const lines = [
    `Role: ${a.role}`,
    a.apps?.length ? `Apps used: ${a.apps.join(', ')}` : '',
    a.copyPatterns?.length ? `Common copy patterns: ${a.copyPatterns.join(', ')}` : '',
    a.repetitiveText ? `Repetitive text: ${a.repetitiveText}` : ''
  ]
  if (a.devContext) {
    for (const [k, v] of Object.entries(a.devContext)) {
      if (v && v.length) lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    }
  }
  if (a.aiTools?.length) lines.push(`AI coding tools: ${a.aiTools.join(', ')}`)
  const system = a.devContext ? ONBOARD_PROMPT + DEV_ONBOARD_ADDENDUM : ONBOARD_PROMPT
  const prompt = `User context:\n${redactPersonalInfo(lines.filter(Boolean).join('\n'))}`
  const res = await run(system, prompt, 180000, true)
  if (!res.ok) return { ok: false, error: res.error }
  try {
    return { ok: true, config: parseJsonReply(res.text) as OnboardConfig }
  } catch {
    return { ok: false, error: 'parse_error' }
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

/**
 * Only a summary of the history is sent: counts, app names and short
 * previews of repeated clips, with emails, phone numbers and secrets blanked.
 */
export async function aiSuggest(historyStats: HistoryStats): Promise<AiSuggestResult> {
  const stats: HistoryStats = {
    ...historyStats,
    repeatedItems: historyStats.repeatedItems.map((r) => ({ ...r, preview: redactPersonalInfo(r.preview) }))
  }
  const prompt = `Clipboard usage data:\n${JSON.stringify(stats, null, 2)}`
  const res = await run(SUGGEST_PROMPT, prompt, 120000, true)
  if (!res.ok) return { ok: false, error: res.error }
  try {
    const parsed = parseJsonReply(res.text) as { suggestions?: AiSuggestion[] }
    return { ok: true, suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [] }
  } catch {
    return { ok: false, error: 'parse_error' }
  }
}
