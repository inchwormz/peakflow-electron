/**
 * Ranking for the launcher: fuzzy match on the title (and keywords), boosted
 * by how often and how recently the person picked that result.
 *   "saf" → Safari (start of name)    "vsc" → Visual Studio Code (initials)
 *   "term" → Terminal                 "blth" → Bluetooth (letters in order)
 */

import type { LauncherItem } from './types'

export interface Usage {
  /** times picked */
  n: number
  /** last picked, ms */
  at: number
}

function words(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2') // "QuickBoard" → "Quick Board"
    .toLowerCase()
    .split(/[^a-z0-9À-￿]+/)
    .filter(Boolean)
}

/** How well `q` (lower case) matches `text`. 0 = no match. */
export function matchScore(q: string, text: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  if (t === q) return 1000
  if (t.startsWith(q)) return 900 - Math.min(100, t.length - q.length)
  const ws = words(text)
  const qs = q.split(/\s+/).filter(Boolean)
  // every typed word starts a word in the text ("vis cod" → Visual Studio Code)
  if (qs.length > 1 && qs.every((qw) => ws.some((w) => w.startsWith(qw)))) return 760
  if (ws.some((w) => w.startsWith(q))) return 700
  // initials: "vsc", "sp" for System Preferences
  const initials = ws.map((w) => w[0]).join('')
  if (q.length >= 2 && initials.startsWith(q)) return 650
  if (t.includes(q)) return 500
  // letters in order, rewarding runs and word starts
  let ti = 0
  let score = 0
  let run = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return 0
    const atWordStart = found === 0 || !/[a-z0-9]/.test(t[found - 1])
    run = found === ti ? run + 1 : 0
    score += 1 + run * 2 + (atWordStart ? 3 : 0)
    ti = found + 1
  }
  // too scattered to be meant
  if (score < q.length * 2) return 0
  return Math.min(450, 100 + score * 8)
}

const KIND_WEIGHT: Record<string, number> = {
  app: 40, command: 30, tool: 30, window: 20, setting: 15, link: 25, snippet: 10, search: 0, file: -30, ai: 0
}

function usageBoost(u: Usage | undefined, now: number): number {
  if (!u) return 0
  const freq = Math.min(240, 70 * Math.log2(1 + u.n))
  const ageH = (now - u.at) / 3_600_000
  const recent = ageH < 1 ? 80 : ageH < 24 ? 50 : ageH < 24 * 7 ? 20 : 0
  return freq + recent
}

export function scoreItem(item: LauncherItem, q: string, usage: Usage | undefined, now = Date.now()): number {
  let m = matchScore(q, item.title)
  for (const k of item.keywords ?? []) m = Math.max(m, matchScore(q, k) * 0.85)
  if (item.snippetKeyword && item.snippetKeyword.toLowerCase().startsWith(q)) m = Math.max(m, 880)
  if (m <= 0) return 0
  return m + (KIND_WEIGHT[item.kind] ?? 0) + usageBoost(usage, now)
}

/** Best matches first. An empty query lists the most used items. */
export function rankItems(items: LauncherItem[], query: string, usage: Record<string, Usage>, limit = 40, now = Date.now()): LauncherItem[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return items
      .filter((i) => usage[i.id])
      .sort((a, b) => usageBoost(usage[b.id], now) - usageBoost(usage[a.id], now))
      .slice(0, limit)
  }
  const scored: Array<[LauncherItem, number]> = []
  for (const it of items) {
    const s = scoreItem(it, q, usage[it.id], now)
    if (s > 0) scored.push([it, s])
  }
  scored.sort((a, b) => b[1] - a[1] || a[0].title.length - b[0].title.length)
  return scored.slice(0, limit).map(([it]) => it)
}
