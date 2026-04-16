/**
 * FormFillPanel — Manage and use form fill profiles.
 * Profiles are ordered field sequences for rapid form completion.
 */

import { useState, useEffect, useCallback } from 'react'
import { DS, NavButton, navBarStyle, SectionLabel } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface FormField {
  label: string
  value: string
  type: 'text' | 'template'
}

interface FormProfile {
  id: string
  name: string
  fields: FormField[]
  createdAt: string
  isAiGenerated: boolean
}

interface FormFillPanelProps {
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

export function FormFillPanel({ onBack }: FormFillPanelProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<FormProfile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editFields, setEditFields] = useState<FormField[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_FORM_PROFILES)
      .then((data) => { if (Array.isArray(data)) setProfiles(data as FormProfile[]) })
      .catch(() => {})
  }, [])

  const handleStartFill = useCallback((profileId: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_START_FORM_FILL, profileId)
    setTimeout(() => window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE), 300)
  }, [])

  const handleDelete = useCallback((profileId: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_DELETE_FORM_PROFILE, profileId)
      .then((data) => { if (Array.isArray(data)) setProfiles(data as FormProfile[]) })
  }, [])

  const startCreate = (): void => {
    setCreating(true)
    setEditingId(null)
    setEditName('')
    setEditFields([{ label: 'Name', value: '', type: 'text' }])
  }

  const startEdit = (profile: FormProfile): void => {
    setEditingId(profile.id)
    setCreating(false)
    setEditName(profile.name)
    setEditFields([...profile.fields])
  }

  const saveEdit = async (): Promise<void> => {
    if (!editName.trim() || editFields.length === 0) return
    const payload = {
      id: editingId || undefined,
      name: editName,
      fields: editFields.filter((f) => f.label.trim()),
      isAiGenerated: false
    }

    await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_SAVE_FORM_PROFILE, payload)

    const data = await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_FORM_PROFILES)
    if (Array.isArray(data)) setProfiles(data as FormProfile[])
    setEditingId(null)
    setCreating(false)
  }

  const addField = (): void => {
    setEditFields([...editFields, { label: '', value: '', type: 'text' }])
  }

  const removeField = (idx: number): void => {
    setEditFields(editFields.filter((_, i) => i !== idx))
  }

  const updateField = (idx: number, key: keyof FormField, value: string): void => {
    const updated = [...editFields]
    updated[idx] = { ...updated[idx], [key]: value }
    setEditFields(updated)
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
            Form Fill
          </span>
        </div>
      </div>

      <div style={{ padding: '12px 24px 24px', flex: 1, overflowY: 'auto' }}>
        {isEditing ? (
          /* ─── Editor ─── */
          <>
            <input
              type="text"
              placeholder="Profile name (e.g. Work Signup)"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12, fontSize: 12, fontWeight: 600 }}
            />

            <SectionLabel>Fields</SectionLabel>
            {editFields.map((field, idx) => (
              <div key={idx} style={{
                display: 'flex',
                gap: 6,
                marginBottom: 6,
                alignItems: 'center'
              }}>
                {/* Field number badge */}
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: DS.accent + '18',
                  border: `1px solid ${DS.accent}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 7,
                  fontWeight: 700,
                  color: DS.accent,
                  flexShrink: 0
                }}>
                  {idx + 1}
                </div>
                <input
                  type="text"
                  placeholder="Label"
                  value={field.label}
                  onChange={(e) => updateField(idx, 'label', e.target.value)}
                  style={{ ...inputStyle, width: 70, flexShrink: 0 }}
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={field.value}
                  onChange={(e) => updateField(idx, 'value', e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                {editFields.length > 1 && (
                  <button
                    onClick={() => removeField(idx)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: DS.red,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '2px',
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
              onClick={addField}
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
              + Add Field
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
            {profiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.15 }}>
                  {'\u{1F4CB}'}
                </div>
                <div style={{ fontSize: 11, color: DS.textGhost }}>
                  No form profiles yet
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
              profiles.map((profile) => (
                <HoverCard key={profile.id}>
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
                          {profile.name}
                        </span>
                        {profile.isAiGenerated && (
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
                        {profile.fields.length} fields
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <SmallButton
                        label="Fill"
                        onClick={() => handleStartFill(profile.id)}
                        bg={DS.accent}
                        color={DS.bg}
                      />
                      <SmallButton
                        label="Edit"
                        onClick={() => startEdit(profile)}
                      />
                      <SmallButton
                        label="Del"
                        onClick={() => handleDelete(profile.id)}
                        color={DS.red}
                        hoverColor={DS.red}
                      />
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    marginTop: 6
                  }}>
                    {profile.fields.map((f, i) => (
                      <span key={i} style={{
                        fontSize: 9,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: DS.accent + '0a',
                        border: `1px solid ${DS.accent}15`,
                        color: DS.textDim
                      }}>
                        {f.label}
                      </span>
                    ))}
                  </div>
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
              + Create Profile
            </button>
          </>
        )}
      </div>
    </div>
  )
}
