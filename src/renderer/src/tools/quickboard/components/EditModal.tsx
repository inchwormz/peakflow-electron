/**
 * EditModal — Overlay for editing a text clip in-place.
 */

import { useState, useRef, useEffect } from 'react'
import { DS, type ClipboardItem } from './shared'

interface EditModalProps {
  item: ClipboardItem
  onSave: (itemId: string, editedText: string) => void
  onCancel: () => void
}

export function EditModal({ item, onSave, onCancel }: EditModalProps): React.JSX.Element {
  const [text, setText] = useState(item.editedText ?? item.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onSave(item.id, text)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [item.id, text, onSave, onCancel])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        padding: 24,
        zIndex: 100,
        borderRadius: 28
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: DS.textPrimary }}>Edit Clip</span>
        <span style={{ fontSize: 9, color: DS.textDim }}>Ctrl+S to save, Esc to cancel</span>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          flex: 1,
          background: DS.bgLight,
          border: `1px solid ${DS.border}`,
          borderRadius: 8,
          padding: 12,
          fontFamily: "'Be Vietnam Pro', monospace",
          fontSize: 12,
          color: DS.white,
          resize: 'none',
          outline: 'none',
          lineHeight: 1.5
        }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: `1px solid ${DS.border}`,
            background: 'transparent',
            color: DS.textSecondary,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(item.id, text)}
          style={{
            padding: '8px 16px',
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
