/**
 * TriggerBuilder — Rule editor in Settings > Triggers tab.
 *
 * Each trigger has conditions (source app, content type, regex pattern)
 * and actions (add tags, apply transform pipeline).
 *
 * NOTE: IPC channels for triggers (get/set) are not yet implemented.
 * This component renders the UI and will connect when channels exist.
 */

import { useState, useCallback } from 'react'
import { DS, SectionLabel, Toggle } from './shared'

interface TriggerRule {
  id: string
  name: string
  enabled: boolean
  conditions: {
    sourceApp?: string
    contentPattern?: string
    contentType?: 'text' | 'code' | 'url' | 'image'
  }
  actions: {
    addTags?: string[]
    applyTransform?: string
  }
}

const EMPTY_RULE: TriggerRule = {
  id: '',
  name: 'New Rule',
  enabled: true,
  conditions: {},
  actions: {}
}

const CONTENT_TYPES = ['text', 'code', 'url', 'image'] as const

export function TriggerBuilder(): React.JSX.Element {
  const [rules, setRules] = useState<TriggerRule[]>([])
  const [editing, setEditing] = useState<TriggerRule | null>(null)
  const [tagInput, setTagInput] = useState('')

  const createNew = useCallback(() => {
    setEditing({ ...EMPTY_RULE, id: Date.now().toString(36) })
  }, [])

  const saveRule = useCallback(() => {
    if (!editing) return
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === editing.id)
      if (idx >= 0) return prev.map((r, i) => i === idx ? editing : r)
      return [...prev, editing]
    })
    setEditing(null)
  }, [editing])

  const deleteRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
    setEditing(null)
  }, [])

  const toggleEnabled = useCallback((id: string) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }, [])

  const addTag = useCallback(() => {
    if (!editing || !tagInput.trim()) return
    const tags = editing.actions.addTags || []
    if (!tags.includes(tagInput.trim())) {
      setEditing({
        ...editing,
        actions: { ...editing.actions, addTags: [...tags, tagInput.trim()] }
      })
    }
    setTagInput('')
  }, [editing, tagInput])

  const removeTag = useCallback((tag: string) => {
    if (!editing) return
    setEditing({
      ...editing,
      actions: {
        ...editing.actions,
        addTags: (editing.actions.addTags || []).filter((t) => t !== tag)
      }
    })
  }, [editing])

  // ── List view ──

  if (!editing) {
    return (
      <div>
        <SectionLabel>Rules (evaluated top to bottom)</SectionLabel>
        {rules.length === 0 && (
          <div style={{ fontSize: 11, color: DS.textDim, padding: '8px 0' }}>
            No rules yet. Triggers auto-tag or transform clips when they match conditions.
          </div>
        )}
        {rules.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: 8,
              border: `1px solid ${DS.border}`,
              background: DS.bgLight
            }}
          >
            <Toggle checked={r.enabled} onChange={() => toggleEnabled(r.id)} />
            <button
              onClick={() => setEditing({ ...r })}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                color: r.enabled ? DS.textPrimary : DS.textDim,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                padding: 0
              }}
            >
              {r.name}
            </button>
          </div>
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
          + New Rule
        </button>
      </div>
    )
  }

  // ── Editor view ──

  return (
    <div>
      {/* Back + rule name */}
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

      {/* Conditions */}
      <SectionLabel>When (all must match)</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {/* Source app */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: DS.textDim, width: 70 }}>Source app</span>
          <input
            placeholder="e.g. Chrome"
            value={editing.conditions.sourceApp || ''}
            onChange={(e) =>
              setEditing({
                ...editing,
                conditions: { ...editing.conditions, sourceApp: e.target.value || undefined }
              })
            }
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${DS.textGhost}`,
              background: DS.bgLight,
              color: DS.textPrimary,
              fontSize: 11,
              fontFamily: 'inherit',
              outline: 'none'
            }}
          />
        </div>

        {/* Content type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: DS.textDim, width: 70 }}>Type</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {CONTENT_TYPES.map((ct) => (
              <button
                key={ct}
                onClick={() =>
                  setEditing({
                    ...editing,
                    conditions: {
                      ...editing.conditions,
                      contentType: editing.conditions.contentType === ct ? undefined : ct
                    }
                  })
                }
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${editing.conditions.contentType === ct ? DS.accent : DS.textGhost}`,
                  background: editing.conditions.contentType === ct ? DS.surface : 'transparent',
                  color: editing.conditions.contentType === ct ? DS.accent : DS.textDim,
                  fontSize: 9,
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
              >
                {ct}
              </button>
            ))}
          </div>
        </div>

        {/* Content pattern (regex) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: DS.textDim, width: 70 }}>Pattern</span>
          <input
            placeholder="regex pattern"
            value={editing.conditions.contentPattern || ''}
            onChange={(e) =>
              setEditing({
                ...editing,
                conditions: { ...editing.conditions, contentPattern: e.target.value || undefined }
              })
            }
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${DS.textGhost}`,
              background: DS.bgLight,
              color: DS.textPrimary,
              fontSize: 11,
              fontFamily: 'monospace',
              outline: 'none'
            }}
          />
        </div>
      </div>

      {/* Actions */}
      <SectionLabel>Then</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Add tags */}
        <div>
          <span style={{ fontSize: 10, color: DS.textDim }}>Add tags:</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {(editing.actions.addTags || []).map((tag) => (
              <span
                key={tag}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: DS.surface,
                  color: DS.textSecondary,
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                #{tag}
                <button
                  onClick={() => removeTag(tag)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: DS.textGhost,
                    fontSize: 10,
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1
                  }}
                >
                  &times;
                </button>
              </span>
            ))}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                placeholder="tag name"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTag() }}
                style={{
                  width: 80,
                  padding: '3px 6px',
                  borderRadius: 4,
                  border: `1px solid ${DS.textGhost}`,
                  background: DS.bgLight,
                  color: DS.textPrimary,
                  fontSize: 10,
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
              />
              <button
                onClick={addTag}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: DS.textMuted,
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between' }}>
        <button
          onClick={() => deleteRule(editing.id)}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Toggle
            checked={editing.enabled}
            onChange={() => setEditing({ ...editing, enabled: !editing.enabled })}
          />
          <button
            onClick={saveRule}
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
    </div>
  )
}
