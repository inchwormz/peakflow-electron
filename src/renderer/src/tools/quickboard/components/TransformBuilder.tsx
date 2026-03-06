/**
 * TransformBuilder — Pipeline editor in Settings > Transforms tab.
 *
 * Lists saved pipelines, allows creating/editing/deleting.
 * Each pipeline is an ordered list of transform steps with live preview.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { DS, SectionLabel } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface TransformStep {
  type: string
  pattern?: string
  replacement?: string
}

interface TransformPipeline {
  id: string
  name: string
  steps: TransformStep[]
}

const STEP_TYPES = [
  { type: 'uppercase', label: 'UPPERCASE' },
  { type: 'lowercase', label: 'lowercase' },
  { type: 'title_case', label: 'Title Case' },
  { type: 'trim', label: 'Trim Whitespace' },
  { type: 'strip_formatting', label: 'Strip HTML' },
  { type: 'url_encode', label: 'URL Encode' },
  { type: 'url_decode', label: 'URL Decode' },
  { type: 'remove_linebreaks', label: 'Remove Newlines' },
  { type: 'regex_replace', label: 'Regex Replace' }
]

const SAMPLE_TEXT = '  <b>Hello World</b>\nThis is a TEST  '

function applyPreview(text: string, steps: TransformStep[]): string {
  let result = text
  for (const step of steps) {
    switch (step.type) {
      case 'uppercase': result = result.toUpperCase(); break
      case 'lowercase': result = result.toLowerCase(); break
      case 'title_case': result = result.replace(/\b\w/g, (c) => c.toUpperCase()); break
      case 'trim': result = result.trim(); break
      case 'strip_formatting': result = result.replace(/<[^>]*>/g, ''); break
      case 'url_encode': result = encodeURIComponent(result); break
      case 'url_decode': try { result = decodeURIComponent(result) } catch { /* keep as-is */ } break
      case 'remove_linebreaks': result = result.replace(/[\r\n]+/g, ' '); break
      case 'regex_replace':
        if (step.pattern) {
          try { result = result.replace(new RegExp(step.pattern, 'g'), step.replacement || '') } catch { /* invalid regex */ }
        }
        break
    }
  }
  return result
}

export function TransformBuilder(): React.JSX.Element {
  const [pipelines, setPipelines] = useState<TransformPipeline[]>([])
  const [editing, setEditing] = useState<TransformPipeline | null>(null)
  const [showAddStep, setShowAddStep] = useState(false)

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS).then((data) => {
      if (Array.isArray(data)) setPipelines(data as TransformPipeline[])
    }).catch(() => {})
  }, [])

  const previewResult = useMemo(() => {
    if (!editing) return ''
    return applyPreview(SAMPLE_TEXT, editing.steps)
  }, [editing])

  const savePipeline = useCallback((pipeline: TransformPipeline) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_SAVE_TRANSFORM, pipeline).then(() => {
      setPipelines((prev) => {
        const idx = prev.findIndex((p) => p.id === pipeline.id)
        if (idx >= 0) return prev.map((p, i) => i === idx ? pipeline : p)
        return [...prev, pipeline]
      })
    }).catch(() => {})
  }, [])

  const deletePipeline = useCallback((id: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_DELETE_TRANSFORM, id).then(() => {
      setPipelines((prev) => prev.filter((p) => p.id !== id))
      setEditing(null)
    }).catch(() => {})
  }, [])

  const createNew = useCallback(() => {
    const pipeline: TransformPipeline = {
      id: Date.now().toString(36),
      name: 'New Pipeline',
      steps: []
    }
    setEditing(pipeline)
  }, [])

  const addStep = useCallback((type: string) => {
    if (!editing) return
    const step: TransformStep = { type }
    if (type === 'regex_replace') {
      step.pattern = ''
      step.replacement = ''
    }
    setEditing({ ...editing, steps: [...editing.steps, step] })
    setShowAddStep(false)
  }, [editing])

  const removeStep = useCallback((idx: number) => {
    if (!editing) return
    setEditing({ ...editing, steps: editing.steps.filter((_, i) => i !== idx) })
  }, [editing])

  const moveStep = useCallback((idx: number, dir: -1 | 1) => {
    if (!editing) return
    const steps = [...editing.steps]
    const target = idx + dir
    if (target < 0 || target >= steps.length) return
    ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
    setEditing({ ...editing, steps })
  }, [editing])

  // ── Pipeline list view ──

  if (!editing) {
    return (
      <div>
        <SectionLabel>Pipelines</SectionLabel>
        {pipelines.length === 0 && (
          <div style={{ fontSize: 11, color: DS.textDim, padding: '8px 0' }}>
            No pipelines yet. Create one to chain transforms together.
          </div>
        )}
        {pipelines.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing({ ...p })}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: 8,
              border: `1px solid ${DS.border}`,
              background: DS.bgLight,
              color: DS.textPrimary,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left'
            }}
          >
            <span>{p.name}</span>
            <span style={{ fontSize: 9, color: DS.textDim }}>{p.steps.length} steps</span>
          </button>
        ))}
        <button
          onClick={createNew}
          style={{
            width: '100%',
            padding: '10px 12px',
            marginTop: 8,
            borderRadius: 8,
            border: `1px dashed ${DS.textGhost}`,
            background: 'transparent',
            color: DS.textMuted,
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          + New Pipeline
        </button>
      </div>
    )
  }

  // ── Pipeline editor view ──

  return (
    <div>
      {/* Back + pipeline name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setEditing(null)}
          style={{
            border: 'none',
            background: 'transparent',
            color: DS.textMuted,
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1
          }}
        >
          &#9664;
        </button>
        <input
          value={editing.name}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${DS.textGhost}`,
            color: DS.textPrimary,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            outline: 'none',
            padding: '4px 0'
          }}
        />
      </div>

      {/* Steps */}
      <SectionLabel>Steps</SectionLabel>
      {editing.steps.length === 0 && (
        <div style={{ fontSize: 11, color: DS.textDim, padding: '4px 0 8px' }}>
          Add steps to build your transform pipeline.
        </div>
      )}
      {editing.steps.map((step, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            marginBottom: 4,
            borderRadius: 6,
            background: DS.bgLight,
            border: `1px solid ${DS.border}`
          }}
        >
          {/* Reorder buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
            <button
              onClick={() => moveStep(idx, -1)}
              disabled={idx === 0}
              style={{
                border: 'none',
                background: 'transparent',
                color: idx === 0 ? DS.textGhost : DS.textDim,
                fontSize: 8,
                cursor: idx === 0 ? 'default' : 'pointer',
                padding: 0,
                lineHeight: 1
              }}
            >
              &#9650;
            </button>
            <button
              onClick={() => moveStep(idx, 1)}
              disabled={idx === editing.steps.length - 1}
              style={{
                border: 'none',
                background: 'transparent',
                color: idx === editing.steps.length - 1 ? DS.textGhost : DS.textDim,
                fontSize: 8,
                cursor: idx === editing.steps.length - 1 ? 'default' : 'pointer',
                padding: 0,
                lineHeight: 1
              }}
            >
              &#9660;
            </button>
          </div>

          {/* Step number + label */}
          <span style={{ fontSize: 9, color: DS.textDim, width: 14, textAlign: 'center', flexShrink: 0 }}>
            {idx + 1}
          </span>
          <span style={{ fontSize: 11, color: DS.textPrimary, flex: 1 }}>
            {STEP_TYPES.find((s) => s.type === step.type)?.label || step.type}
          </span>

          {/* Regex inputs */}
          {step.type === 'regex_replace' && (
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                placeholder="pattern"
                value={step.pattern || ''}
                onChange={(e) => {
                  const steps = [...editing.steps]
                  steps[idx] = { ...step, pattern: e.target.value }
                  setEditing({ ...editing, steps })
                }}
                style={{
                  width: 60,
                  padding: '2px 4px',
                  borderRadius: 4,
                  border: `1px solid ${DS.textGhost}`,
                  background: DS.bg,
                  color: DS.textPrimary,
                  fontSize: 9,
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
              />
              <input
                placeholder="replace"
                value={step.replacement || ''}
                onChange={(e) => {
                  const steps = [...editing.steps]
                  steps[idx] = { ...step, replacement: e.target.value }
                  setEditing({ ...editing, steps })
                }}
                style={{
                  width: 60,
                  padding: '2px 4px',
                  borderRadius: 4,
                  border: `1px solid ${DS.textGhost}`,
                  background: DS.bg,
                  color: DS.textPrimary,
                  fontSize: 9,
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
              />
            </div>
          )}

          {/* Remove */}
          <button
            onClick={() => removeStep(idx)}
            style={{
              border: 'none',
              background: 'transparent',
              color: DS.textGhost,
              fontSize: 12,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>
      ))}

      {/* Add step */}
      {showAddStep ? (
        <div style={{ padding: '4px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STEP_TYPES.map((s) => (
            <button
              key={s.type}
              onClick={() => addStep(s.type)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: `1px solid ${DS.textGhost}`,
                background: 'transparent',
                color: DS.textSecondary,
                fontSize: 9,
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setShowAddStep(true)}
          style={{
            padding: '6px 10px',
            marginTop: 4,
            borderRadius: 6,
            border: `1px dashed ${DS.textGhost}`,
            background: 'transparent',
            color: DS.textMuted,
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          + Add Step
        </button>
      )}

      {/* Live preview */}
      {editing.steps.length > 0 && (
        <>
          <SectionLabel>Preview</SectionLabel>
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              background: DS.bgLight,
              border: `1px solid ${DS.border}`,
              fontSize: 10,
              lineHeight: 1.5
            }}
          >
            <div style={{ color: DS.textDim, marginBottom: 4 }}>
              Before: <span style={{ color: DS.textSecondary, fontFamily: 'monospace' }}>{SAMPLE_TEXT}</span>
            </div>
            <div style={{ color: DS.textDim }}>
              After: <span style={{ color: DS.accent, fontFamily: 'monospace' }}>{previewResult}</span>
            </div>
          </div>
        </>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between' }}>
        <button
          onClick={() => deletePipeline(editing.id)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: `1px solid #2a1515`,
            background: '#1a0a0a',
            color: DS.red,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          Delete
        </button>
        <button
          onClick={() => { savePipeline(editing); setEditing(null) }}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: DS.accent,
            color: DS.bg,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
