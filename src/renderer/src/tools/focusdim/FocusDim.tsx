/**
 * FocusDim Settings Panel — matches FocusDim_Redesign.html exactly.
 *
 * Dark cinematic design system:
 *   - #0a0a0a background, Be Vietnam Pro font
 *   - Green (#4ae08a) toggles, white active states
 *   - Purple accent border preview
 *
 * Communicates with main process via IPC:
 *   - focusdim:get-state  → retrieve current state
 *   - focusdim:toggle     → enable/disable
 *   - focusdim:set-opacity → 0-1 float
 *   - focusdim:set-color  → color key string
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { TitleBar } from '../../components/layout/TitleBar'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'

// ─── Design Tokens (dark cinematic — NOT neo-brutalist) ──────────────────────

const DS = {
  bg: '#0a0a0a',
  surface: '#111111',
  surface2: '#1a1a1a',
  border: '#1a1a1a',
  borderActive: '#333333',
  textPrimary: '#f0f0f5',
  textSecondary: '#888888',
  textMuted: '#666666',
  textDim: '#555555',
  textLabel: '#444444',
  accent: '#ffe17c',
  red: '#f05858',
  white: '#ffffff',
  accentPurple: 'rgba(168, 85, 247, 0.9)'
} as const

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESETS = [
  { value: 0.3, pct: '30%', label: 'Light' },
  { value: 0.5, pct: '50%', label: 'Medium' },
  { value: 0.7, pct: '70%', label: 'Heavy' },
  { value: 0.85, pct: '85%', label: 'Max' }
]

const DIM_COLOR_PRESETS = [
  { hex: '#000000', label: 'Black' },
  { hex: '#1a0a2e', label: 'Purple' },
  { hex: '#0a1628', label: 'Blue' },
  { hex: '#151515', label: 'Gray' }
]

interface FocusDimState {
  enabled: boolean
  opacity: number
  dimColor: string
  showBorder: boolean
  fadeDuration: number
  peekDuration: number
  peeking: boolean
  hotkey: string
  autoRevealDesktop: boolean
}

interface DisplayInfo {
  id: number
  label: string
  bounds: Electron.Rectangle
  disabled: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FocusDim(): React.JSX.Element {
  const [state, setState] = useState<FocusDimState>({
    enabled: false,
    opacity: 0.6,
    dimColor: '#000000',
    showBorder: true,
    fadeDuration: 200,
    peekDuration: 3,
    peeking: false,
    hotkey: 'ctrl+shift+d',
    autoRevealDesktop: true
  })

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [recording, setRecording] = useState(false)

  const [hexInput, setHexInput] = useState('#000000')

  const sliderRef = useRef<HTMLInputElement>(null)

  // ── Load initial state ─────────────────────────────────────────────────

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_GET_STATE).then((s) => {
      if (s && typeof s === 'object') {
        const st = s as FocusDimState
        setState(st)
        setHexInput(st.dimColor)
      }
    })
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_GET_DISPLAYS).then((d) => {
      if (Array.isArray(d)) setDisplays(d as DisplayInfo[])
    })
  }, [])

  // ── Listen for state changes from main process ─────────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(IPC_SEND.FOCUSDIM_STATE_CHANGED, (s: unknown) => {
      if (s && typeof s === 'object') {
        const st = s as FocusDimState
        setState(st)
        setHexInput(st.dimColor)
      }
    })
    return unsub
  }, [])

  // ── IPC Actions ────────────────────────────────────────────────────────

  const handleToggle = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_TOGGLE).then((s) => {
      if (s && typeof s === 'object') setState(s as FocusDimState)
    })
  }, [])

  const handleSetOpacity = useCallback((opacity: number) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_OPACITY, opacity)
    setState((prev) => ({ ...prev, opacity }))
  }, [])

  const handleSetColor = useCallback((hex: string) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_COLOR, hex)
    setState((prev) => ({ ...prev, dimColor: hex }))
    setHexInput(hex)
  }, [])

  const handleSetFadeDuration = useCallback((ms: number) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_FADE_DURATION, ms)
    setState((prev) => ({ ...prev, fadeDuration: ms }))
  }, [])

  const handleSetPeekDuration = useCallback((seconds: number) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_PEEK_DURATION, seconds)
    setState((prev) => ({ ...prev, peekDuration: seconds }))
  }, [])

  const handleSetBorder = useCallback((show: boolean) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_BORDER, show)
    setState((prev) => ({ ...prev, showBorder: show }))
  }, [])

  const handleSetAutoRevealDesktop = useCallback((enabled: boolean) => {
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
      tool: 'focusdim',
      key: 'auto_reveal_desktop',
      value: enabled
    })
    setState((prev) => ({ ...prev, autoRevealDesktop: enabled }))
  }, [])

  const handleSetHotkey = useCallback((hotkey: string) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_HOTKEY, hotkey).then((ok) => {
      if (ok) {
        setState((prev) => ({ ...prev, hotkey }))
      }
    })
  }, [])

  const handleToggleDisplay = useCallback((displayId: number, currentlyDisabled: boolean) => {
    const newDisplays = displays.map((d) =>
      d.id === displayId ? { ...d, disabled: !currentlyDisabled } : d
    )
    setDisplays(newDisplays)
    const disabledIds = newDisplays.filter((d) => d.disabled).map((d) => d.id)
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_DISABLED_DISPLAYS, disabledIds)
  }, [displays])

  const handlePresetClick = useCallback(
    (value: number) => {
      handleSetOpacity(value)
      if (sliderRef.current) {
        sliderRef.current.value = String(Math.round(value * 100))
      }
    },
    [handleSetOpacity]
  )

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = parseInt(e.target.value)
      handleSetOpacity(pct / 100)
    },
    [handleSetOpacity]
  )

  // ── Derived values ─────────────────────────────────────────────────────

  const sliderPct = Math.round(state.opacity * 100)
  const dimColorHex = state.dimColor

  // Preview opacity: show a muted preview when disabled, full when enabled
  const previewOpacity = state.enabled ? state.opacity : 0.15

  return (
    <>
      <TitleBar title="FocusDim" showMaximize={false} />

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 24px 24px',
          fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
        }}
      >
        {/* ── Subtitle ── */}
        <div
          style={{
            fontSize: 10,
            color: DS.textMuted,
            letterSpacing: '0.5px',
            padding: '2px 0 16px'
          }}
        >
          Dim inactive windows
        </div>

        {/* ── Preview ── */}
        <Preview
          colorHex={dimColorHex}
          opacity={previewOpacity}
          showBorder={state.showBorder}
        />

        {/* ── Main Toggle ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: DS.textPrimary
              }}
            >
              Dim Enabled
            </span>
            <span
              style={{
                fontSize: 10,
                color: DS.textMuted,
                marginLeft: 8
              }}
            >
              {state.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <Toggle checked={state.enabled} onChange={handleToggle} />
        </div>

        {/* ── Intensity Section ── */}
        <SectionLabel>Intensity</SectionLabel>

        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map((p) => (
            <PresetButton
              key={p.value}
              pct={p.pct}
              label={p.label}
              active={Math.abs(p.value - state.opacity) < 0.02}
              onClick={() => handlePresetClick(p.value)}
            />
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 0'
          }}
        >
          <input
            ref={sliderRef}
            type="range"
            min={10}
            max={90}
            value={sliderPct}
            onChange={handleSliderChange}
            style={sliderStyle}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: DS.textSecondary,
              width: 36,
              textAlign: 'right'
            }}
          >
            {sliderPct}%
          </span>
        </div>

        {/* ── Dim Color Section ── */}
        <SectionLabel>Dim Color</SectionLabel>

        <div style={{ display: 'flex', gap: 10, padding: '4px 0' }}>
          {DIM_COLOR_PRESETS.map((c) => (
            <ColorSwatch
              key={c.hex}
              hex={c.hex}
              label={c.label}
              active={c.hex === state.dimColor}
              onClick={() => handleSetColor(c.hex)}
            />
          ))}
        </div>

        {/* Custom hex input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0'
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: dimColorHex,
              border: `2px solid ${DS.borderActive}`,
              flexShrink: 0
            }}
          />
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={() => {
              if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hexInput)) {
                handleSetColor(hexInput)
              } else {
                setHexInput(state.dimColor)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur()
              }
            }}
            style={{
              width: 80,
              padding: '4px 8px',
              background: DS.surface,
              border: `1px solid ${DS.border}`,
              borderRadius: 6,
              color: DS.textSecondary,
              fontFamily: 'monospace',
              fontSize: 12,
              outline: 'none'
            }}
          />
          <span style={{ fontSize: 10, color: DS.textLabel }}>Custom</span>
        </div>

        {/* ── Options Section ── */}
        <SectionLabel>Options</SectionLabel>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <span style={{ fontSize: 13, color: DS.textSecondary }}>
            Active window border
          </span>
          <Toggle
            checked={state.showBorder}
            onChange={() => handleSetBorder(!state.showBorder)}
          />
        </div>

        {/* Fade speed slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <span style={{ fontSize: 13, color: DS.textSecondary }}>
            Fade speed
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              min={0}
              max={5000}
              step={100}
              value={state.fadeDuration}
              onChange={(e) => handleSetFadeDuration(parseInt(e.target.value))}
              style={{ ...sliderStyle, width: 100 }}
            />
            <span
              style={{
                fontSize: 11,
                color: DS.textDim,
                width: 48,
                textAlign: 'right'
              }}
            >
              {state.fadeDuration === 0 ? 'Instant' : `${state.fadeDuration}ms`}
            </span>
          </div>
        </div>

        {/* Peek duration slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <span style={{ fontSize: 13, color: DS.textSecondary }}>
            Peek duration
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={state.peekDuration}
              onChange={(e) => handleSetPeekDuration(parseInt(e.target.value))}
              style={{ ...sliderStyle, width: 100 }}
            />
            <span
              style={{
                fontSize: 11,
                color: DS.textDim,
                width: 24,
                textAlign: 'right'
              }}
            >
              {state.peekDuration}s
            </span>
          </div>
        </div>

        {/* Hide on desktop focus */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <span style={{ fontSize: 13, color: DS.textSecondary }}>
            Hide on desktop focus
          </span>
          <Toggle
            checked={state.autoRevealDesktop}
            onChange={() => handleSetAutoRevealDesktop(!state.autoRevealDesktop)}
          />
        </div>

        {/* Keyboard shortcuts */}
        <SectionLabel>Shortcuts</SectionLabel>

        {/* Toggle dim — editable hotkey */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 0'
          }}
        >
          <span style={{ fontSize: 12, color: DS.textSecondary }}>
            Toggle dim
          </span>
          {recording ? (
            <HotkeyRecorder
              onRecord={(combo) => {
                setRecording(false)
                handleSetHotkey(combo)
              }}
              onCancel={() => setRecording(false)}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  color: DS.textDim,
                  fontWeight: 500,
                  letterSpacing: '0.5px'
                }}
              >
                {formatHotkeyDisplay(state.hotkey)}
              </span>
              <button
                onClick={() => setRecording(true)}
                style={{
                  fontSize: 9,
                  color: DS.textMuted,
                  background: DS.surface,
                  border: `1px solid ${DS.border}`,
                  borderRadius: 4,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* Static shortcuts */}
        {[
          { label: 'Intensity up', shortcut: 'Ctrl+Alt+Up' },
          { label: 'Intensity down', shortcut: 'Ctrl+Alt+Down' },
          { label: 'Peek', shortcut: 'Ctrl+Alt+`' }
        ].map((s) => (
          <div
            key={s.shortcut}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0'
            }}
          >
            <span style={{ fontSize: 12, color: DS.textSecondary }}>
              {s.label}
            </span>
            <span
              style={{
                fontSize: 11,
                color: DS.textDim,
                fontWeight: 500,
                letterSpacing: '0.5px'
              }}
            >
              {s.shortcut}
            </span>
          </div>
        ))}

        {/* Displays section — only if 2+ displays */}
        {displays.length >= 2 && (
          <>
            <SectionLabel>Displays</SectionLabel>
            {displays.map((d) => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: `1px solid ${DS.surface}`
                }}
              >
                <span style={{ fontSize: 13, color: DS.textSecondary }}>
                  {d.label}
                </span>
                <Toggle
                  checked={!d.disabled}
                  onChange={() => handleToggleDisplay(d.id, d.disabled)}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

// ─── Hotkey helpers ──────────────────────────────────────────────────────────

/** Format config hotkey (ctrl+shift+d) for display (Ctrl+Shift+D) */
function formatHotkeyDisplay(hotkey: string): string {
  return hotkey
    .split('+')
    .map((p) => {
      const l = p.trim().toLowerCase()
      if (l === 'ctrl' || l === 'control') return 'Ctrl'
      if (l === 'cmd' || l === 'command') return 'Cmd'
      if (l === 'commandorcontrol') return 'Ctrl'
      return l.charAt(0).toUpperCase() + l.slice(1)
    })
    .join('+')
}

/** Map DOM key event to combo string for config format */
function HotkeyRecorder({
  onRecord,
  onCancel
}: {
  onRecord: (combo: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [keys, setKeys] = useState<string[]>([])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        onCancel()
        return
      }

      // Only capture when a non-modifier key is pressed
      const modifiers: string[] = []
      if (e.ctrlKey) modifiers.push('ctrl')
      if (e.altKey) modifiers.push('alt')
      if (e.shiftKey) modifiers.push('shift')
      if (e.metaKey) modifiers.push('meta')

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      // Ignore lone modifier presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        setKeys(modifiers)
        return
      }

      if (modifiers.length === 0) return // Need at least one modifier

      const combo = [...modifiers, key].join('+')
      onRecord(combo)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onRecord, onCancel])

  return (
    <span
      style={{
        fontSize: 11,
        color: DS.accent,
        fontWeight: 500,
        letterSpacing: '0.5px',
        animation: 'pulse 1.5s infinite'
      }}
    >
      {keys.length > 0 ? formatHotkeyDisplay(keys.join('+')) + '+...' : 'Press keys...'}
    </span>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Section label matching the HTML spec: 8px, uppercase, letter-spacing 2.5px */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: '2.5px',
        textTransform: 'uppercase' as const,
        color: DS.textLabel,
        margin: '16px 0 8px'
      }}
    >
      {children}
    </div>
  )
}

/** Pill toggle: 36x20, green when on, matching HTML spec exactly */
function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <label
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        cursor: 'pointer',
        display: 'inline-block',
        flexShrink: 0
      }}
      onClick={(e) => {
        e.preventDefault()
        onChange()
      }}
    >
      {/* Background pill */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? DS.accent : DS.surface2,
          borderRadius: 10,
          transition: 'background 0.25s'
        }}
      />
      {/* Dot */}
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: checked ? DS.white : '#444444',
          transition: 'all 0.25s'
        }}
      />
    </label>
  )
}

/** Live preview panel showing dim effect */
function Preview({
  colorHex,
  opacity,
  showBorder
}: {
  colorHex: string
  opacity: number
  showBorder: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        height: 110,
        borderRadius: 14,
        overflow: 'hidden',
        marginBottom: 4
      }}
    >
      {/* Dim background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: colorHex,
          opacity,
          transition: 'background 0.3s, opacity 0.3s'
        }}
      />

      {/* "Window" mock */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 130,
          height: 64,
          background: '#1a1a2a',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2
        }}
      >
        <div
          style={{
            width: 100,
            height: 10,
            borderRadius: 3,
            background: '#333',
            marginBottom: 3
          }}
        />
        <div
          style={{
            width: 60,
            height: 5,
            borderRadius: 2,
            background: '#444'
          }}
        />
      </div>

      {/* Border indicator */}
      <div
        style={{
          position: 'absolute',
          top: 11,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 136,
          height: 70,
          border: '3px solid #fff',
          borderRadius: 11,
          zIndex: 3,
          pointerEvents: 'none',
          opacity: showBorder ? 1 : 0,
          transition: 'opacity 0.3s'
        }}
      />

      {/* Preview label */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 8,
          letterSpacing: '2px',
          textTransform: 'uppercase' as const,
          color: DS.textDim,
          zIndex: 2
        }}
      >
        Preview
      </div>
    </div>
  )
}

/** Intensity preset button matching the HTML spec */
function PresetButton({
  pct,
  label,
  active,
  onClick
}: {
  pct: string
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        padding: '10px 4px',
        border: `1px solid ${active ? DS.white : hovered ? DS.borderActive : DS.border}`,
        borderRadius: 10,
        background: active ? DS.white : DS.surface,
        color: active ? DS.bg : hovered ? DS.textSecondary : DS.textMuted,
        fontFamily: 'inherit',
        fontSize: 10,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'all 0.2s',
        outline: 'none'
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 14,
          fontWeight: 300,
          marginBottom: 2
        }}
      >
        {pct}
      </span>
      {label}
    </button>
  )
}

/** Color swatch circle with selection ring */
function ColorSwatch({
  hex,
  label,
  active,
  onClick
}: {
  hex: string
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer'
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: hex,
          border: `2px solid ${active ? DS.white : 'transparent'}`,
          transition: 'border-color 0.2s, transform 0.15s',
          transform: hovered ? 'scale(1.1)' : 'scale(1)'
        }}
      />
      <div
        style={{
          fontSize: 8,
          color: DS.textLabel,
          textAlign: 'center',
          marginTop: 4,
          letterSpacing: '0.5px'
        }}
      >
        {label}
      </div>
    </div>
  )
}

// ─── Slider styling ──────────────────────────────────────────────────────────

const sliderStyle: CSSProperties = {
  flex: 1,
  height: 4,
  WebkitAppearance: 'none',
  appearance: 'none' as CSSProperties['appearance'],
  background: DS.surface2,
  borderRadius: 2,
  outline: 'none',
  cursor: 'pointer'
}
