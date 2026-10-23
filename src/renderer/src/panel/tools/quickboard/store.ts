/**
 * QuickBoard panel state shared across its routes: clip history (live from
 * CLIPBOARD_ON_CHANGE), tags, the list's search/filter/tab/selection, the
 * select-several picks, AI suggestions and the setup wizard's answers.
 * Kept in a tiny external store so it survives route changes.
 */

import { useSyncExternalStore } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { invoke } from '../../hooks'
import { scoreItem } from '../../../tools/quickboard/fuzzy-search'

/* ─── Types (mirror src/main/services/clipboard*.ts) ─────────────────────── */

export interface Clip {
  id: string
  text: string | null
  type: 'text' | 'image' | 'file'
  timestamp: string
  copyCount: number
  pinned: boolean
  preview: string
  imageDataUrl?: string
  imageWidth?: number
  imageHeight?: number
  tags: string[]
  sourceApp: string | null
  contentType: 'text' | 'code' | 'url' | 'image' | 'file'
  ocrText: string | null
  filePaths?: string[]
  fileMeta?: { name: string; size: number; ext: string }[]
  editedText?: string
  linkTitle?: string
}

export type TransformType = 'uppercase' | 'lowercase' | 'title_case' | 'trim' | 'remove_newlines' | 'strip_html' | 'slug' | 'escape_html' | 'unescape_html'
export interface TransformStep { type: TransformType; label: string }
export interface Pipeline { id: string; name: string; steps: TransformStep[] }

export interface Suggestion {
  id: string
  type: 'pin_template' | 'create_tag' | 'create_workflow' | 'add_trigger'
  reason: string
  action: Record<string, unknown>
  label: string
}

export interface Workflow { id: string; name: string; description: string; items: Array<{ label: string; text: string }>; isAiGenerated: boolean }
export interface FormProfile { id: string; name: string; fields: Array<{ label: string; value: string; type: 'text' | 'template' }>; isAiGenerated: boolean }

export interface PasteStatus { kind: 'queue' | 'workflow' | 'form'; active: boolean; current: number; total: number; label: string }

export interface OnboardConfig {
  tags?: string[]
  pinnedTemplates?: Array<{ text: string; label: string }>
  workflows?: Array<{ name: string; description: string; items: Array<{ label: string; text: string }> }>
  formProfiles?: Array<{ name: string; fields: Array<{ label: string; value: string; type: string }> }>
}

export type TypeFilter = 'all' | 'text' | 'code' | 'url' | 'image' | 'file'

interface State {
  history: Clip[] | null
  tags: string[]
  q: string
  type: TypeFilter
  tagFilter: string[]
  tab: 'recent' | 'top'
  filterOpen: boolean
  sel: number
  selectMode: boolean
  picks: string[]
  suggestions: Suggestion[]
  suggestionsHidden: boolean
  paste: PasteStatus
  wizard: { role: string; customRole: string; apps: string[]; patterns: string[]; repetitive: string; config: OnboardConfig | null; error: string }
}

const NO_PASTE: PasteStatus = { kind: 'queue', active: false, current: 0, total: 0, label: '' }
export const WIZARD_START: State['wizard'] = { role: '', customRole: '', apps: [], patterns: [], repetitive: '', config: null, error: '' }

let state: State = {
  history: null,
  tags: [],
  q: '',
  type: 'all',
  tagFilter: [],
  tab: 'recent',
  filterOpen: false,
  sel: 0,
  selectMode: false,
  picks: [],
  suggestions: [],
  suggestionsHidden: false,
  paste: NO_PASTE,
  wizard: WIZARD_START
}
const subs = new Set<() => void>()

export function setQB(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  subs.forEach((f) => f())
}
export function getQB(): State {
  return state
}

let started = false
function start(): void {
  if (started) return
  started = true
  window.peakflow.on(IPC_SEND.CLIPBOARD_ON_CHANGE, (data: unknown) => {
    if (Array.isArray(data)) setQB({ history: data as Clip[] })
  })
  window.peakflow.on(IPC_SEND.CLIPBOARD_AI_SUGGESTIONS_READY, (data: unknown) => {
    if (Array.isArray(data)) setQB({ suggestions: usable(data as Suggestion[]), suggestionsHidden: false })
  })
  reloadHistory()
  reloadTags()
  // Ask for suggestions once per app run (each call is an AI request), only when they're on
  invoke<Record<string, unknown> | null>(IPC_INVOKE.CONFIG_GET, { tool: 'quickboard' })
    .then((c) => {
      if (c && c.ai_suggestions_enabled === false) return
      return invoke<Suggestion[]>(IPC_INVOKE.CLIPBOARD_AI_SUGGEST).then((list) => {
        if (Array.isArray(list) && list.length) setQB({ suggestions: usable(list) })
      })
    })
    .catch(() => {})
}

/** Trigger rules don't exist in the app yet, so "add a rule" suggestions can't be applied. */
function usable(list: Suggestion[]): Suggestion[] {
  return list.filter((s) => s.type !== 'add_trigger')
}

export function reloadHistory(): void {
  invoke<Clip[]>(IPC_INVOKE.CLIPBOARD_GET_HISTORY)
    .then((h) => Array.isArray(h) && setQB({ history: h }))
    .catch(() => setQB((s) => ({ history: s.history ?? [] })))
}
export function reloadTags(): void {
  invoke<string[]>(IPC_INVOKE.CLIPBOARD_GET_ALL_TAGS)
    .then((t) => Array.isArray(t) && setQB({ tags: t }))
    .catch(() => {})
}
export function reloadPasteStatus(): void {
  invoke<PasteStatus>(IPC_INVOKE.CLIPBOARD_PASTE_STATUS)
    .then((p) => p && setQB({ paste: p }))
    .catch(() => {})
}

export function useQB(): State {
  start()
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state
  )
}

/* ─── Derived list ───────────────────────────────────────────────────────── */

export function visibleClips(s: State): Clip[] {
  let items = s.history ?? []
  if (s.type !== 'all') items = items.filter((c) => c.contentType === s.type)
  if (s.tagFilter.length) items = items.filter((c) => s.tagFilter.some((t) => c.tags.includes(t)))
  const q = s.q.trim()
  if (q) {
    items = items
      .map((item) => ({ item, score: scoreItem(q, item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
  }
  const pinned = items.filter((c) => c.pinned)
  const rest = items.filter((c) => !c.pinned)
  const cmp = s.tab === 'top'
    ? (a: Clip, b: Clip): number => b.copyCount - a.copyCount || b.timestamp.localeCompare(a.timestamp)
    : (a: Clip, b: Clip): number => b.timestamp.localeCompare(a.timestamp)
  if (s.tab === 'top' || !q) {
    pinned.sort(cmp)
    rest.sort(cmp)
  }
  return [...pinned, ...rest].slice(0, 200)
}

/* ─── Clip text helpers ──────────────────────────────────────────────────── */

export const clipText = (c: Clip): string => c.editedText ?? c.text ?? ''
export const canEdit = (c: Clip): boolean => c.type === 'text' && (c.contentType === 'text' || c.contentType === 'code')

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** Main line and the grey second line for a clip row. */
export function clipLines(c: Clip): [string, string | null] {
  if (c.type === 'image') {
    const main = c.imageWidth && c.imageHeight ? `Image · ${c.imageWidth}×${c.imageHeight}` : 'Image'
    const ocr = c.ocrText?.replace(/\s+/g, ' ').trim()
    return [main, ocr ? `Text in image: “${ocr.slice(0, 80)}”` : null]
  }
  if (c.type === 'file') {
    const files = c.fileMeta ?? []
    const names = files.length ? files.map((f) => f.name).join(', ') : (c.filePaths ?? []).map((p) => p.split(/[\\/]/).pop()).join(', ') || c.preview
    const total = files.reduce((n, f) => n + (f.size || 0), 0)
    const count = files.length || c.filePaths?.length || 0
    return [names, count ? `${count} ${count === 1 ? 'file' : 'files'}${total ? ` · ${fmtSize(total)}` : ''}` : null]
  }
  const body = (c.editedText ? c.preview : c.preview || c.text || '').replace(/\s+/g, ' ').trim()
  if (c.contentType === 'url' && c.linkTitle) return [c.linkTitle, body]
  return [body, null]
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/* ─── Transforms (same functions as src/main/services/clipboard-transforms.ts, for the live preview) ── */

const FNS: Record<TransformType, (t: string) => string> = {
  uppercase: (t) => t.toUpperCase(),
  lowercase: (t) => t.toLowerCase(),
  title_case: (t) => t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  trim: (t) => t.trim(),
  remove_newlines: (t) => t.replace(/[\r\n]+/g, ' '),
  strip_html: (t) => t.replace(/<[^>]*>/g, ''),
  slug: (t) => t.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, ''),
  escape_html: (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  unescape_html: (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}
export function applySteps(steps: TransformStep[], text: string): string {
  return steps.reduce((t, s) => (FNS[s.type] ? FNS[s.type](t) : t), text)
}

/** Plain, sentence-case names for the built-in transforms (the app's labels are Title Case). */
export const STEP_NAME: Record<TransformType, string> = {
  uppercase: 'UPPERCASE',
  lowercase: 'lowercase',
  title_case: 'Title Case',
  trim: 'Trim whitespace',
  remove_newlines: 'Remove line breaks',
  strip_html: 'Strip HTML',
  slug: 'URL slug',
  escape_html: 'Escape HTML',
  unescape_html: 'Unescape HTML'
}

/* ─── Actions ────────────────────────────────────────────────────────────── */

export const QUEUE_NEXT_KEY = 'CommandOrControl+Shift+N'
export const QUEUE_CANCEL_KEY = 'CommandOrControl+Shift+Q'
export const OPEN_KEY = 'CommandOrControl+Shift+V'

export function togglePin(id: string): void {
  invoke<Clip[]>(IPC_INVOKE.CLIPBOARD_PIN_ITEM, id).then((h) => Array.isArray(h) && setQB({ history: h })).catch(() => {})
}
export function deleteClip(id: string): void {
  invoke<Clip[]>(IPC_INVOKE.CLIPBOARD_DELETE_ITEM, id).then((h) => Array.isArray(h) && setQB({ history: h })).catch(() => {})
}
