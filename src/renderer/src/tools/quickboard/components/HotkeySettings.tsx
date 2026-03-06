/**
 * HotkeySettings — Custom hotkey assignment in Settings > Hotkeys tab.
 *
 * Global shortcuts with a "press to record" UI.
 * Queries the main process for registered hotkeys to detect conflicts.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { DS, SectionLabel } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface HotkeyBinding {
  id: string
  label: string
  keys: string
  category: 'global' | 'tag'
  tagName?: string
}

interface RegisteredHotkey {
  accelerator: string
  label: string
}

const DEFAULT_BINDINGS: HotkeyBinding[] = [
  { id: 'open', label: 'Open QuickBoard', keys: 'Ctrl+Shift+V', category: 'global' },
  { id: 'paste_next', label: 'Paste Next (Queue)', keys: 'Ctrl+Shift+N', category: 'global' },
  { id: 'cancel_queue', label: 'Cancel Queue', keys: 'Ctrl+Shift+Q', category: 'global' }
]

/** Normalize accelerator to comparable form: lowercase, CommandOrControl → ctrl */
function normalizeAccel(accel: string): string {
  return accel
    .toLowerCase()
    .replace(/commandorcontrol/g, 'ctrl')
    .replace(/control/g, 'ctrl')
    .replace(/command/g, 'ctrl')
    .split('+')
    .sort()
    .join('+')
}

/** Map binding ID to the registered hotkey label prefix */
const BINDING_TO_REGISTERED: Record<string, string> = {
  open: 'quickboard',
  paste_next: 'quickboard:paste-next',
  cancel_queue: 'quickboard:cancel-queue'
}

function KeyRecorder({
  keys,
  conflict,
  onRecord
}: {
  keys: string
  conflict?: string
  onRecord: (keys: string) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Win')

      const key = e.key
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        parts.push(key.length === 1 ? key.toUpperCase() : key)
        onRecord(parts.join('+'))
        setRecording(false)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [recording, onRecord])

  const borderColor = conflict ? DS.red : recording ? DS.accent : DS.textGhost
  const textColor = conflict ? DS.red : recording ? DS.accent : DS.textSecondary

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button
        ref={ref}
        onClick={() => setRecording(true)}
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 6,
          border: `1px solid ${borderColor}`,
          background: recording ? DS.surface : DS.bgLight,
          color: textColor,
          fontSize: 11,
          fontFamily: 'monospace',
          cursor: 'pointer',
          outline: 'none',
          textAlign: 'left',
          transition: 'border-color 0.2s'
        }}
      >
        {recording ? 'Press keys...' : keys || 'Click to set'}
      </button>
      {conflict && (
        <span style={{ fontSize: 9, color: DS.red, lineHeight: 1.2 }}>
          Conflicts with {conflict}
        </span>
      )}
    </div>
  )
}

export function HotkeySettings(): React.JSX.Element {
  const [bindings, setBindings] = useState<HotkeyBinding[]>(DEFAULT_BINDINGS)
  const [tagShortcuts, setTagShortcuts] = useState<HotkeyBinding[]>([])
  const [registeredHotkeys, setRegisteredHotkeys] = useState<RegisteredHotkey[]>([])

  // Fetch registered hotkeys on mount for conflict detection
  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.HOTKEY_GET_REGISTERED).then((hotkeys: RegisteredHotkey[]) => {
      setRegisteredHotkeys(hotkeys)
    }).catch(() => {})
  }, [])

  /** Check if a key combo conflicts with another registered shortcut (not owned by this binding) */
  const getConflict = useCallback((keys: string, bindingId: string): string | undefined => {
    if (!keys) return undefined
    const normalized = normalizeAccel(keys)
    const ownLabel = BINDING_TO_REGISTERED[bindingId]

    // Check against registered system hotkeys
    for (const rh of registeredHotkeys) {
      if (normalizeAccel(rh.accelerator) === normalized) {
        // Don't flag own binding as conflict
        if (ownLabel && rh.label === ownLabel) continue
        return rh.label
      }
    }

    // Check against other bindings in this list
    for (const b of bindings) {
      if (b.id === bindingId || !b.keys) continue
      if (normalizeAccel(b.keys) === normalized) return b.label
    }
    for (const t of tagShortcuts) {
      if (t.id === bindingId || !t.keys) continue
      if (normalizeAccel(t.keys) === normalized) return `Tag: ${t.tagName || 'unnamed'}`
    }

    return undefined
  }, [registeredHotkeys, bindings, tagShortcuts])

  const updateBinding = useCallback((id: string, keys: string) => {
    setBindings((prev) => prev.map((b) => b.id === id ? { ...b, keys } : b))
  }, [])

  const updateTagShortcut = useCallback((id: string, keys: string) => {
    setTagShortcuts((prev) => prev.map((b) => b.id === id ? { ...b, keys } : b))
  }, [])

  const addTagShortcut = useCallback(() => {
    setTagShortcuts((prev) => [
      ...prev,
      {
        id: `tag_${Date.now().toString(36)}`,
        label: '',
        keys: '',
        category: 'tag',
        tagName: ''
      }
    ])
  }, [])

  const removeTagShortcut = useCallback((id: string) => {
    setTagShortcuts((prev) => prev.filter((b) => b.id !== id))
  }, [])

  return (
    <div>
      <SectionLabel>Global Shortcuts</SectionLabel>
      {bindings.map((b) => (
        <div
          key={b.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 8
          }}
        >
          <span style={{ fontSize: 11, color: DS.textSecondary, width: 110, paddingTop: 6 }}>{b.label}</span>
          <KeyRecorder
            keys={b.keys}
            conflict={getConflict(b.keys, b.id)}
            onRecord={(keys) => updateBinding(b.id, keys)}
          />
        </div>
      ))}

      <SectionLabel>Tag Shortcuts (max 10)</SectionLabel>
      <div style={{ fontSize: 10, color: DS.textDim, marginBottom: 8 }}>
        Jump to a filtered tag view with a global shortcut.
      </div>
      {tagShortcuts.map((b) => (
        <div
          key={b.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginBottom: 6
          }}
        >
          <input
            placeholder="#tag"
            value={b.tagName || ''}
            onChange={(e) =>
              setTagShortcuts((prev) =>
                prev.map((s) => s.id === b.id ? { ...s, tagName: e.target.value, label: e.target.value } : s)
              )
            }
            style={{
              width: 70,
              padding: '5px 6px',
              borderRadius: 4,
              border: `1px solid ${DS.textGhost}`,
              background: DS.bgLight,
              color: DS.textPrimary,
              fontSize: 10,
              fontFamily: 'inherit',
              outline: 'none'
            }}
          />
          <KeyRecorder
            keys={b.keys}
            conflict={getConflict(b.keys, b.id)}
            onRecord={(keys) => updateTagShortcut(b.id, keys)}
          />
          <button
            onClick={() => removeTagShortcut(b.id)}
            style={{
              border: 'none',
              background: 'transparent',
              color: DS.textGhost,
              fontSize: 14,
              cursor: 'pointer',
              padding: '6px 0 0',
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>
      ))}

      {tagShortcuts.length < 10 && (
        <button
          onClick={addTagShortcut}
          style={{
            padding: '6px 10px',
            marginTop: 4,
            borderRadius: 6,
            border: `1px dashed ${DS.textGhost}`,
            background: 'transparent',
            color: DS.textMuted,
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
            width: '100%'
          }}
        >
          + Add Tag Shortcut
        </button>
      )}

      {/* Registered hotkeys reference */}
      {registeredHotkeys.length > 0 && (
        <>
          <SectionLabel>Active System Hotkeys</SectionLabel>
          <div style={{ fontSize: 10, color: DS.textDim, marginBottom: 4 }}>
            These shortcuts are currently registered by PeakFlow.
          </div>
          {registeredHotkeys.map((rh) => (
            <div
              key={rh.accelerator}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '3px 0',
                fontSize: 10
              }}
            >
              <span style={{ color: DS.textDim }}>{rh.label}</span>
              <span style={{ color: DS.textSecondary, fontFamily: 'monospace' }}>{rh.accelerator}</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 9, color: DS.textDim, marginTop: 12 }}>
        Click a shortcut field, then press your desired key combo.
      </div>
    </div>
  )
}
