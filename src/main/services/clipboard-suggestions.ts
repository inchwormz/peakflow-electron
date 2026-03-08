/**
 * Smart Suggestions engine for QuickBoard.
 * Analyzes clipboard history patterns and proactively suggests
 * tags, pinned templates, workflows, and auto-triggers.
 */

import { getClipboardService } from './clipboard'
import { getConfig, setConfig } from './config-store'
import { ToolId } from '@shared/tool-ids'
import type { QuickBoardConfig } from '@shared/config-schemas'
import { aiSuggest, checkAiAccess } from './clipboard-ai'
import type { AiSuggestion, HistoryStats } from './clipboard-ai'

// ─── Clipboard capture counter ───────────────────────────────────────────────

let captureCount = 0
const SUGGEST_EVERY = 25

export function incrementCaptureCount(): void {
  captureCount++
}

export function shouldRunSuggestions(): boolean {
  if (captureCount < SUGGEST_EVERY) return false
  if (captureCount % SUGGEST_EVERY !== 0) return false
  return true
}

// ─── Check eligibility ──────────────────────────────────────────────────────

export async function checkShouldSuggest(): Promise<boolean> {
  // Check license
  const access = await checkAiAccess()
  if (!access.allowed) return false

  // Check config
  const config = getConfig(ToolId.QuickBoard) as QuickBoardConfig & {
    ai_suggestions_enabled?: boolean
    ai_last_suggestion_date?: string
  }
  if (config.ai_suggestions_enabled === false) return false

  // Check 24h cooldown
  const lastDate = config.ai_last_suggestion_date
  if (lastDate) {
    const last = new Date(lastDate).getTime()
    const now = Date.now()
    if (now - last < 24 * 60 * 60 * 1000) return false
  }

  return true
}

// ─── Build stats from history ────────────────────────────────────────────────

export function buildHistoryStats(): HistoryStats {
  const svc = getClipboardService()
  const history = svc.getHistory()

  const contentTypes: Record<string, number> = {}
  const sourceApps: Record<string, number> = {}
  const textCounts = new Map<string, { preview: string; count: number }>()

  for (const item of history) {
    // Content types
    const ct = item.contentType || 'text'
    contentTypes[ct] = (contentTypes[ct] || 0) + 1

    // Source apps
    if (item.sourceApp) {
      sourceApps[item.sourceApp] = (sourceApps[item.sourceApp] || 0) + 1
    }

    // Repeated items (by text hash)
    if (item.type === 'text' && item.text) {
      const key = item.text.slice(0, 100)
      const existing = textCounts.get(key)
      if (existing) {
        existing.count++
      } else {
        textCounts.set(key, {
          preview: item.text.slice(0, 50),
          count: item.copyCount || 1
        })
      }
    }
  }

  // Top source apps (sorted by frequency)
  const topSourceApps = Object.entries(sourceApps)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([app]) => app)

  // Repeated items (only those with count > 2)
  const repeatedItems = Array.from(textCounts.values())
    .filter((item) => item.count > 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Existing tags
  const tagSet = new Set<string>()
  for (const item of history) {
    if (item.tags) {
      for (const tag of item.tags) tagSet.add(tag)
    }
  }

  // We'd need to import workflows here but to keep it simple, pass empty
  const existingWorkflows: string[] = []

  // Detect paste sequences (items pasted within 60s of each other)
  const pasteLog = svc.getPasteLog()
  const seqMap = new Map<string, number>()
  for (let i = 0; i < pasteLog.length; i++) {
    const seq: string[] = [pasteLog[i].preview]
    for (let j = i + 1; j < pasteLog.length; j++) {
      if (pasteLog[j].timestamp - pasteLog[j - 1].timestamp > 60_000) break
      seq.push(pasteLog[j].preview)
      if (seq.length > 5) break
    }
    if (seq.length >= 2) {
      const key = seq.join(' \u2192 ')
      seqMap.set(key, (seqMap.get(key) || 0) + 1)
    }
  }
  const pasteSequences = Array.from(seqMap.entries())
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([items, count]) => ({ items: items.split(' \u2192 '), count }))

  return {
    totalItems: history.length,
    contentTypes,
    topSourceApps,
    repeatedItems,
    pasteSequences,
    existingTags: Array.from(tagSet),
    existingWorkflows
  }
}

// ─── Run suggestions ─────────────────────────────────────────────────────────

export async function getSuggestions(): Promise<AiSuggestion[]> {
  const stats = buildHistoryStats()
  const result = await aiSuggest(stats)

  if (result.ok && result.suggestions) {
    // Update last suggestion date
    setConfig(ToolId.QuickBoard, 'ai_last_suggestion_date', new Date().toISOString())
    return result.suggestions
  }

  return []
}

// ─── Dismiss ─────────────────────────────────────────────────────────────────

export function dismissSuggestion(suggestionId: string): void {
  const config = getConfig(ToolId.QuickBoard) as QuickBoardConfig & {
    ai_dismissed_suggestions?: string[]
  }
  const dismissed = config.ai_dismissed_suggestions || []
  if (!dismissed.includes(suggestionId)) {
    dismissed.push(suggestionId)
    setConfig(ToolId.QuickBoard, 'ai_dismissed_suggestions', dismissed)
  }
}

export function getDismissedSuggestions(): string[] {
  const config = getConfig(ToolId.QuickBoard) as QuickBoardConfig & {
    ai_dismissed_suggestions?: string[]
  }
  return config.ai_dismissed_suggestions || []
}
