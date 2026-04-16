/**
 * WorkflowPanel — Browse, launch, edit, and generate clipboard workflows.
 * Workflows are multi-step sequential paste sequences.
 */

import { useState, useEffect, useCallback } from 'react'
import { DS, NavButton, navBarStyle, SectionLabel } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface WorkflowItem {
  label: string
  text: string
}

interface Workflow {
  id: string
  name: string
  description: string
  items: WorkflowItem[]
  isAiGenerated: boolean
  createdAt: string
}

interface WorkflowPanelProps {
  onBack: () => void
}

/** Card wrapper with hover interaction */
function HoverCard({
  children,
  style
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 12px',
        marginBottom: 6,
        borderRadius: 8,
        background: hovered ? DS.bgHover : DS.bgLight,
        border: `1px solid ${hovered ? DS.textGhost : DS.border}`,
        transition: 'all 0.15s',
        ...style
      }}
    >
      {children}
    </div>
  )
}

/** Small action button with hover */
function SmallButton({
  label,
  onClick,
  color = DS.textDim,
  bg,
  hoverColor
}: {
  label: string
  onClick: () => void
  color?: string
  bg?: string
  hoverColor?: string
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: bg ? 'none' : `1px solid ${hovered ? DS.textGhost : DS.border}`,
        background: bg || 'transparent',
        color: hovered && hoverColor ? hoverColor : color,
        fontSize: 9,
        fontWeight: bg ? 600 : 400,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
        outline: 'none'
      }}
    >
      {label}
    </button>
  )
}

export function WorkflowPanel({ onBack }: WorkflowPanelProps): React.JSX.Element {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editItems, setEditItems] = useState<WorkflowItem[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS)
      .then((data) => { if (Array.isArray(data)) setWorkflows(data as Workflow[]) })
      .catch(() => {})
  }, [])

  const handleStart = useCallback((workflowId: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_START_WORKFLOW, workflowId)
    setTimeout(() => window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE), 300)
  }, [])

  const handleDelete = useCallback((workflowId: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_DELETE_WORKFLOW, workflowId)
      .then((data) => { if (Array.isArray(data)) setWorkflows(data as Workflow[]) })
  }, [])

  const startCreate = (): void => {
    setCreating(true)
    setEditingId(null)
    setEditName('')
    setEditDesc('')
    setEditItems([{ label: 'Step 1', text: '' }])
  }

  const startEdit = (wf: Workflow): void => {
    setEditingId(wf.id)
    setCreating(false)
    setEditName(wf.name)
    setEditDesc(wf.description)
    setEditItems([...wf.items])
  }

  const saveEdit = async (): Promise<void> => {
    if (!editName.trim() || editItems.length === 0) return
    const payload = {
      name: editName,
      description: editDesc,
      items: editItems.filter((i) => i.text.trim()),
      isAiGenerated: false
    }

    if (editingId) {
      await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_DELETE_WORKFLOW, editingId)
    }

    await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_SAVE_WORKFLOW, payload)

    const data = await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS)
    if (Array.isArray(data)) setWorkflows(data as Workflow[])
    setEditingId(null)
    setCreating(false)
  }

  const addItem = (): void => {
    setEditItems([...editItems, { label: `Step ${editItems.length + 1}`, text: '' }])
  }

  const removeItem = (idx: number): void => {
    setEditItems(editItems.filter((_, i) => i !== idx))
  }

  const updateItem = (idx: number, field: 'label' | 'text', value: string): void => {
    const updated = [...editItems]
    updated[idx] = { ...updated[idx], [field]: value }
    setEditItems(updated)
  }

  const isEditing = creating || editingId !== null

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: DS.bgLight,
    border: `1px solid ${DS.border}`,
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 10,
    color: DS.textPrimary,
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s'
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      animation: 'fadeIn 0.2s ease'
    }}>
      {/* Nav */}
      <div style={navBarStyle}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          WebkitAppRegion: 'no-drag'
        }}>
          <NavButton icon="&#9664;" onClick={onBack} />
          <span style={{
            fontSize: 13,
            fontWeight: 400,
            color: DS.textPrimary,
            fontFamily: "'Silkscreen', cursive"
          }}>
            Workflows
          </span>
        </div>
      </div>

      <div style={{ padding: '12px 24px 24px', flex: 1, overflowY: 'auto' }}>
        {isEditing ? (
          /* ─── Editor ─── */
          <>
            <input
              type="text"
              placeholder="Workflow name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={{ ...inputStyle, marginBottom: 6, fontSize: 12, fontWeight: 600 }}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <SectionLabel>Steps</SectionLabel>
            {editItems.map((item, idx) => (
              <div key={idx} style={{
                display: 'flex',
                gap: 6,
                marginBottom: 6,
                alignItems: 'flex-start'
              }}>
                {/* Step number badge */}
                <div style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: DS.accent + '18',
                  border: `1px solid ${DS.accent}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontWeight: 700,
                  color: DS.accent,
                  flexShrink: 0,
                  marginTop: 5
                }}>
                  {idx + 1}
                </div>
                <input
                  type="text"
                  placeholder="Label"
                  value={item.label}
                  onChange={(e) => updateItem(idx, 'label', e.target.value)}
                  style={{ ...inputStyle, width: 70, flexShrink: 0 }}
                />
                <textarea
                  placeholder="Content to paste..."
                  value={item.text}
                  onChange={(e) => updateItem(idx, 'text', e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, flex: 1, resize: 'vertical' }}
                />
                {editItems.length > 1 && (
                  <button
                    onClick={() => removeItem(idx)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: DS.red,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '4px 2px',
                      marginTop: 4,
                      opacity: 0.6,
                      transition: 'opacity 0.15s',
                      outline: 'none'
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.6' }}
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>
            ))}

            <button
              onClick={addItem}
              style={{
                width: '100%',
                padding: 6,
                border: `1px dashed ${DS.border}`,
                borderRadius: 6,
                background: 'transparent',
                color: DS.textDim,
                fontSize: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 12,
                transition: 'border-color 0.15s',
                outline: 'none'
              }}
            >
              + Add Step
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <SmallButton
                label="Cancel"
                onClick={() => { setEditingId(null); setCreating(false) }}
              />
              <button
                onClick={saveEdit}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 8,
                  border: 'none',
                  background: DS.accent,
                  color: DS.bg,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  outline: 'none'
                }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          /* ─── List ─── */
          <>
            {workflows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.15 }}>
                  {'\u26A1'}
                </div>
                <div style={{ fontSize: 11, color: DS.textGhost }}>
                  No workflows yet
                </div>
                <div style={{
                  fontSize: 10,
                  color: DS.textGhost,
                  marginTop: 4,
                  opacity: 0.7
                }}>
                  Create one or run AI Setup to generate them.
                </div>
              </div>
            ) : (
              workflows.map((wf) => (
                <HoverCard key={wf.id}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: DS.textPrimary
                        }}>
                          {wf.name}
                        </span>
                        {wf.isAiGenerated && (
                          <span style={{
                            fontSize: 7,
                            fontWeight: 700,
                            color: DS.accent,
                            background: DS.accent + '15',
                            padding: '1px 4px',
                            borderRadius: 3,
                            letterSpacing: '0.5px'
                          }}>
                            AI
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: 9,
                        color: DS.textDim,
                        marginTop: 2
                      }}>
                        {wf.items.length} steps
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <SmallButton
                        label="Start"
                        onClick={() => handleStart(wf.id)}
                        bg={DS.accent}
                        color={DS.bg}
                      />
                      <SmallButton
                        label="Edit"
                        onClick={() => startEdit(wf)}
                      />
                      <SmallButton
                        label="Del"
                        onClick={() => handleDelete(wf.id)}
                        color={DS.red}
                        hoverColor={DS.red}
                      />
                    </div>
                  </div>
                  {wf.description && (
                    <div style={{
                      fontSize: 10,
                      color: DS.textSecondary,
                      marginTop: 4
                    }}>
                      {wf.description}
                    </div>
                  )}
                </HoverCard>
              ))
            )}

            <button
              onClick={startCreate}
              style={{
                width: '100%',
                padding: 10,
                marginTop: 8,
                borderRadius: 8,
                border: `1px dashed ${DS.border}`,
                background: 'transparent',
                color: DS.textDim,
                fontSize: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s',
                outline: 'none'
              }}
            >
              + Create Workflow
            </button>
          </>
        )}
      </div>
    </div>
  )
}
