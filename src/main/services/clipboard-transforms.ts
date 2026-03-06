/**
 * clipboard-transforms.ts — Text transform pipeline for QuickBoard.
 *
 * Provides a set of text transforms that can be applied at paste time.
 * Users can configure custom pipelines (ordered arrays of transform steps).
 */

import Store from 'electron-store'

// ─── Types ──────────────────────────────────────────────────────────────────

export type TransformType =
  | 'uppercase'
  | 'lowercase'
  | 'title_case'
  | 'trim'
  | 'remove_newlines'
  | 'strip_html'
  | 'slug'
  | 'escape_html'
  | 'unescape_html'

export interface TransformStep {
  type: TransformType
  label: string
}

export interface TransformPipeline {
  id: string
  name: string
  steps: TransformStep[]
}

// ─── Built-in transforms ────────────────────────────────────────────────────

const TRANSFORM_FNS: Record<TransformType, (text: string) => string> = {
  uppercase: (t) => t.toUpperCase(),
  lowercase: (t) => t.toLowerCase(),
  title_case: (t) =>
    t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  trim: (t) => t.trim(),
  remove_newlines: (t) => t.replace(/[\r\n]+/g, ' '),
  strip_html: (t) => t.replace(/<[^>]*>/g, ''),
  slug: (t) =>
    t.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, ''),
  escape_html: (t) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  unescape_html: (t) =>
    t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/** All available transform types with labels */
export const AVAILABLE_TRANSFORMS: TransformStep[] = [
  { type: 'uppercase', label: 'UPPERCASE' },
  { type: 'lowercase', label: 'lowercase' },
  { type: 'title_case', label: 'Title Case' },
  { type: 'trim', label: 'Trim Whitespace' },
  { type: 'remove_newlines', label: 'Remove Newlines' },
  { type: 'strip_html', label: 'Strip HTML' },
  { type: 'slug', label: 'URL Slug' },
  { type: 'escape_html', label: 'Escape HTML' },
  { type: 'unescape_html', label: 'Unescape HTML' }
]

// ─── Pipeline execution ─────────────────────────────────────────────────────

/** Apply a single transform step to text. */
export function applyStep(type: TransformType, text: string): string {
  const fn = TRANSFORM_FNS[type]
  return fn ? fn(text) : text
}

/** Apply a full pipeline of transform steps to text. */
export function applyPipeline(steps: TransformStep[], text: string): string {
  let result = text
  for (const step of steps) {
    result = applyStep(step.type, result)
  }
  return result
}

// ─── Pipeline persistence ───────────────────────────────────────────────────

const store = new Store({ name: 'quickboard-transforms', clearInvalidConfig: true })

export function getSavedPipelines(): TransformPipeline[] {
  const data = store.get('pipelines') as TransformPipeline[] | undefined
  return Array.isArray(data) ? data : []
}

export function savePipeline(pipeline: TransformPipeline): TransformPipeline[] {
  const pipelines = getSavedPipelines()
  const idx = pipelines.findIndex((p) => p.id === pipeline.id)
  if (idx !== -1) pipelines[idx] = pipeline
  else pipelines.push(pipeline)
  store.set('pipelines', pipelines)
  return pipelines
}

export function deletePipeline(pipelineId: string): TransformPipeline[] {
  const pipelines = getSavedPipelines().filter((p) => p.id !== pipelineId)
  store.set('pipelines', pipelines)
  return pipelines
}
