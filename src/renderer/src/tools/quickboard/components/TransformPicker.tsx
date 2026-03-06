/**
 * TransformPicker — Quick-select a text transform before pasting.
 * Shows as a dropdown when user right-clicks a text clip.
 */

import { useState } from 'react'
import { DS, type ClipboardItem } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface TransformStep {
  type: string
  label: string
}

interface TransformPickerProps {
  item: ClipboardItem
  onClose: () => void
}

const QUICK_TRANSFORMS: TransformStep[] = [
  { type: 'uppercase', label: 'UPPERCASE' },
  { type: 'lowercase', label: 'lowercase' },
  { type: 'title_case', label: 'Title Case' },
  { type: 'trim', label: 'Trim Whitespace' },
  { type: 'remove_newlines', label: 'Remove Newlines' },
  { type: 'strip_html', label: 'Strip HTML' },
  { type: 'slug', label: 'URL Slug' }
]

export function TransformPicker({ item, onClose }: TransformPickerProps): React.JSX.Element {
  const [hoveredIdx, setHoveredIdx] = useState(-1)

  const handleApply = (step: TransformStep): void => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_PASTE_WITH_TRANSFORM, item.id, [step])
    onClose()
    setTimeout(() => {
      window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
    }, 400)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: DS.surface,
          borderRadius: 12,
          border: `1px solid ${DS.border}`,
          padding: 8,
          minWidth: 180
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 10, fontWeight: 600, color: DS.textDim, padding: '4px 8px', marginBottom: 4 }}>
          Paste as...
        </div>
        {QUICK_TRANSFORMS.map((step, idx) => (
          <button
            key={step.type}
            onClick={() => handleApply(step)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(-1)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              borderRadius: 6,
              border: 'none',
              background: hoveredIdx === idx ? DS.bgLight : 'transparent',
              color: DS.textPrimary,
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.1s'
            }}
          >
            {step.label}
          </button>
        ))}
      </div>
    </div>
  )
}
