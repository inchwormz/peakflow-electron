/**
 * TransformPicker — Quick-select a text transform before pasting.
 * Shows as a modal when user right-clicks a text clip.
 * Includes live preview of the transform result.
 * AI Actions section for Pro users: summarize, formal, bullets, grammar, explain code, translate.
 */

import { useState, useMemo, useEffect } from 'react'
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

const AI_TRANSFORMS: Array<{ type: string; label: string; codeOnly?: boolean }> = [
  { type: 'summarize', label: 'Summarize' },
  { type: 'formal', label: 'Rewrite formal' },
  { type: 'bullets', label: 'Bullet points' },
  { type: 'grammar', label: 'Fix grammar' },
  { type: 'explain_code', label: 'Explain code', codeOnly: true }
]

const TRANSLATE_LANGS = [
  'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Korean', 'Portuguese', 'Italian'
]

function applyQuickTransform(text: string, type: string): string {
  switch (type) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'title_case': return text.replace(/\b\w/g, (c) => c.toUpperCase())
    case 'trim': return text.trim()
    case 'remove_newlines': return text.replace(/[\r\n]+/g, ' ')
    case 'strip_html': return text.replace(/<[^>]*>/g, '')
    case 'slug': return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
    default: return text
  }
}

export function TransformPicker({ item, onClose }: TransformPickerProps): React.JSX.Element {
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const [aiAllowed, setAiAllowed] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showTranslateLangs, setShowTranslateLangs] = useState(false)
  const [customLang, setCustomLang] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sourceText = item.editedText ?? item.text ?? ''
  const isCode = item.contentType === 'code'

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_CHECK_ACCESS)
      .then((res: unknown) => {
        const r = res as { allowed: boolean }
        setAiAllowed(r.allowed)
      })
      .catch(() => {})
  }, [])

  const preview = useMemo(() => {
    if (hoveredIdx < 0) return null
    const type = QUICK_TRANSFORMS[hoveredIdx].type
    const result = applyQuickTransform(sourceText, type)
    return result.length > 60 ? result.slice(0, 60) + '\u2026' : result
  }, [hoveredIdx, sourceText])

  const handleApply = (step: TransformStep): void => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_PASTE_WITH_TRANSFORM, item.id, [step])
    onClose()
    setTimeout(() => {
      window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
    }, 400)
  }

  const handleAiTransform = async (type: string, targetLang?: string): Promise<void> => {
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await window.peakflow.invoke(
        IPC_INVOKE.CLIPBOARD_AI_TRANSFORM, type, sourceText, targetLang
      ) as { ok: boolean; result?: string; error?: string }

      if (res.ok && res.result) {
        await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_WRITE_TEXT, res.result)
        setTimeout(async () => {
          window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
        }, 200)
        onClose()
      } else {
        setAiError(res.error || 'Transform failed')
        setTimeout(() => setAiError(null), 3000)
      }
    } catch {
      setAiError('Network error')
      setTimeout(() => setAiError(null), 3000)
    } finally {
      setAiLoading(false)
    }
  }

  const btnStyle = (hovered: boolean, disabled?: boolean): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: 6,
    border: 'none',
    background: hovered && !disabled ? DS.bgLight : 'transparent',
    color: disabled ? DS.textGhost : hovered ? DS.textPrimary : DS.textSecondary,
    fontSize: 11,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.1s',
    opacity: disabled ? 0.5 : 1,
    outline: 'none'
  })

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
          minWidth: 200,
          maxWidth: 260,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          color: DS.textDim,
          padding: '4px 8px',
          marginBottom: 4
        }}>
          Paste as\u2026
        </div>

        {QUICK_TRANSFORMS.map((step, idx) => (
          <button
            key={step.type}
            onClick={() => handleApply(step)}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(-1)}
            style={btnStyle(hoveredIdx === idx)}
          >
            {step.label}
          </button>
        ))}

        {/* Live preview */}
        {preview !== null && (
          <div
            style={{
              margin: '6px 4px 2px',
              padding: '6px 8px',
              borderRadius: 6,
              background: DS.bg,
              border: `1px solid ${DS.border}`,
              fontSize: 10,
              fontFamily: 'monospace',
              color: DS.accent,
              lineHeight: 1.4,
              wordBreak: 'break-all'
            }}
          >
            {preview}
          </div>
        )}

        {/* AI Actions separator */}
        <div style={{
          margin: '8px 8px 4px',
          borderTop: `1px solid ${DS.border}`,
          paddingTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: DS.textDim }}>
            AI Actions
          </span>
          {!aiAllowed && (
            <span style={{
              fontSize: 7,
              fontWeight: 700,
              color: DS.accent,
              background: DS.accent + '15',
              padding: '1px 5px',
              borderRadius: 3,
              letterSpacing: '1px',
              border: `1px solid ${DS.accent}22`
            }}>
              PRO
            </span>
          )}
        </div>

        {aiLoading && (
          <div style={{
            padding: '10px 8px',
            fontSize: 10,
            color: DS.accent,
            textAlign: 'center',
            fontWeight: 500
          }}>
            Processing{'\u2026'}
          </div>
        )}

        {aiError && (
          <div style={{
            padding: '4px 8px',
            margin: '2px 4px',
            fontSize: 10,
            color: DS.red,
            background: DS.red + '11',
            borderRadius: 4
          }}>
            {aiError}
          </div>
        )}

        {!aiLoading && AI_TRANSFORMS.map((t) => {
          if (t.codeOnly && !isCode) return null
          const isHovered = hoveredId === `ai-${t.type}`
          return (
            <button
              key={t.type}
              onClick={() => aiAllowed ? handleAiTransform(t.type) : undefined}
              onMouseEnter={() => setHoveredId(`ai-${t.type}`)}
              onMouseLeave={() => setHoveredId(null)}
              style={btnStyle(isHovered, !aiAllowed)}
              disabled={!aiAllowed}
            >
              {!aiAllowed && <span style={{ opacity: 0.4, marginRight: 4 }}>{'\u{1F512}'}</span>}
              {t.label}
            </button>
          )
        })}

        {/* Translate */}
        {!aiLoading && (
          <button
            onClick={() => aiAllowed ? setShowTranslateLangs(!showTranslateLangs) : undefined}
            onMouseEnter={() => setHoveredId('translate')}
            onMouseLeave={() => setHoveredId(null)}
            style={btnStyle(hoveredId === 'translate', !aiAllowed)}
            disabled={!aiAllowed}
          >
            {!aiAllowed && <span style={{ opacity: 0.4, marginRight: 4 }}>{'\u{1F512}'}</span>}
            Translate {showTranslateLangs ? '\u25B4' : '\u25BE'}
          </button>
        )}

        {showTranslateLangs && aiAllowed && !aiLoading && (
          <div style={{
            marginLeft: 12,
            paddingLeft: 10,
            borderLeft: `1px solid ${DS.accent}33`
          }}>
            {TRANSLATE_LANGS.map((lang) => (
              <button
                key={lang}
                onClick={() => handleAiTransform('translate', lang)}
                onMouseEnter={() => setHoveredId(`lang-${lang}`)}
                onMouseLeave={() => setHoveredId(null)}
                style={btnStyle(hoveredId === `lang-${lang}`)}
              >
                {lang}
              </button>
            ))}
            <div style={{ display: 'flex', gap: 4, padding: '4px 8px' }}>
              <input
                type="text"
                placeholder="Other\u2026"
                value={customLang}
                onChange={(e) => setCustomLang(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customLang.trim()) {
                    handleAiTransform('translate', customLang.trim())
                  }
                }}
                style={{
                  flex: 1,
                  background: DS.bg,
                  border: `1px solid ${DS.border}`,
                  borderRadius: 4,
                  padding: '4px 6px',
                  fontSize: 10,
                  color: DS.textPrimary,
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
