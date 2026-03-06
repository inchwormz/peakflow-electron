/**
 * SuggestionBanner — Dismissible cards showing AI-generated workflow suggestions.
 * Appears at the top of QuickBoard when suggestions are available.
 */

import { useState } from 'react'
import { DS } from './shared'

interface AiSuggestion {
  id: string
  type: 'pin_template' | 'create_tag' | 'create_workflow' | 'add_trigger'
  reason: string
  action: Record<string, unknown>
  label: string
}

interface SuggestionBannerProps {
  suggestions: AiSuggestion[]
  onApply: (suggestion: AiSuggestion) => void
  onDismiss: (suggestionId: string) => void
  onClose: () => void
}

const TYPE_ICONS: Record<string, string> = {
  pin_template: '\u{1F4CC}',
  create_tag: '\u{1F3F7}',
  create_workflow: '\u{26A1}',
  add_trigger: '\u{2699}'
}

/** Left-border accent per suggestion type */
const TYPE_COLORS: Record<string, string> = {
  pin_template: DS.accent,
  create_tag: DS.yellow,
  create_workflow: DS.textMuted,
  add_trigger: DS.red
}

export function SuggestionBanner({
  suggestions,
  onApply,
  onDismiss,
  onClose
}: SuggestionBannerProps): React.JSX.Element {
  const [applying, setApplying] = useState<string | null>(null)
  const [applyHovered, setApplyHovered] = useState<string | null>(null)
  const [dismissHovered, setDismissHovered] = useState<string | null>(null)
  const [closeHovered, setCloseHovered] = useState(false)

  if (suggestions.length === 0) return <></>

  const handleApply = async (sug: AiSuggestion): Promise<void> => {
    setApplying(sug.id)
    try {
      onApply(sug)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div style={{
      margin: '0 24px',
      padding: '8px 10px',
      borderRadius: 8,
      background: DS.accent + '11',
      border: `1px solid ${DS.accent}33`,
      animation: 'fadeIn 0.25s ease'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: DS.accent }}>
          {suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''}
        </span>
        <button
          onClick={onClose}
          onMouseEnter={() => setCloseHovered(true)}
          onMouseLeave={() => setCloseHovered(false)}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: `1px solid ${closeHovered ? DS.textGhost : 'transparent'}`,
            background: closeHovered ? DS.bgHover : 'transparent',
            color: closeHovered ? DS.textSecondary : DS.textDim,
            cursor: 'pointer',
            fontSize: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
            outline: 'none',
            padding: 0
          }}
        >
          {'\u2715'}
        </button>
      </div>

      {suggestions.map((sug) => {
        const borderColor = TYPE_COLORS[sug.type] || DS.textGhost
        return (
          <div
            key={sug.id}
            style={{
              padding: '6px 8px',
              marginBottom: 4,
              borderRadius: 6,
              background: DS.bgLight,
              border: `1px solid ${DS.border}`,
              borderLeft: `3px solid ${borderColor}`
            }}
          >
            <div style={{
              fontSize: 10,
              color: DS.textSecondary,
              marginBottom: 5,
              lineHeight: 1.3
            }}>
              {TYPE_ICONS[sug.type] || ''} {sug.reason}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleApply(sug)}
                disabled={applying === sug.id}
                onMouseEnter={() => setApplyHovered(sug.id)}
                onMouseLeave={() => setApplyHovered(null)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: applyHovered === sug.id && applying !== sug.id
                    ? DS.accent
                    : DS.accent + 'cc',
                  color: DS.bg,
                  fontSize: 9,
                  fontWeight: 600,
                  cursor: applying === sug.id ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: applying === sug.id ? 0.5 : 1,
                  transition: 'all 0.15s',
                  outline: 'none'
                }}
              >
                {applying === sug.id ? '\u2026' : sug.label}
              </button>
              <button
                onClick={() => onDismiss(sug.id)}
                onMouseEnter={() => setDismissHovered(sug.id)}
                onMouseLeave={() => setDismissHovered(null)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${dismissHovered === sug.id ? DS.textGhost : DS.border}`,
                  background: dismissHovered === sug.id ? DS.bgHover : 'transparent',
                  color: dismissHovered === sug.id ? DS.textSecondary : DS.textDim,
                  fontSize: 9,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  outline: 'none'
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
