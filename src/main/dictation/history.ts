import { isExcludedApp } from '../security/excluded-apps'
export interface HistoryEntry { text: string; at: number; app?: string }
export interface HistoryContext { secure?: boolean; app?: string; appId?: string; title?: string }

export function mayKeepHistory(enabled: boolean, ctx: HistoryContext): boolean {
  return enabled && ctx.secure === false && !isExcludedApp([ctx.title, ctx.app].filter(Boolean).join(' '), ctx.appId)
}

export function addHistory(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  if (!entry.text.trim()) return list
  // Pick fields explicitly so no audio, cursor text or other metadata can be persisted.
  return [{ text: entry.text, at: entry.at, ...(entry.app ? { app: entry.app } : {}) }, ...list].slice(0, 25)
}
