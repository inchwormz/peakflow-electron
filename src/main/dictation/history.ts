import { isExcludedApp } from '../security/excluded-apps'
export interface HistoryEntry { text: string; at: number; app?: string }
export interface HistoryContext { secure?: boolean; focusId?: string; app?: string; appId?: string; title?: string }

export function mayKeepHistory(enabled: boolean, ctx: HistoryContext, text = ''): boolean {
  return enabled && !looksLikeSecret(text) && ctx.secure === false && !isExcludedApp([ctx.title, ctx.app].filter(Boolean).join(' '), ctx.appId)
}

export function addHistory(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  if (!entry.text.trim()) return list
  // Pick fields explicitly so no audio, cursor text or other metadata can be persisted.
  return [{ text: entry.text, at: entry.at, ...(entry.app ? { app: entry.app } : {}) }, ...list].slice(0, 25)
}

/** Avoid retaining password-shaped text even if focus briefly moved between samples. */
export function looksLikeSecret(text: string): boolean {
  if (text.length < 8 || /\s/u.test(text)) return false
  return [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter((kind) => kind.test(text)).length >= 2
}
