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
  green: '#4ae08a',
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

const DIM_COLORS = [
  { key: 'black', hex: '#000000', label: 'Black' },
  { key: 'dark_purple', hex: '#1a0a2e', label: 'Purple' },
  { key: 'dark_blue', hex: '#0a1628', label: 'Blue' },
  { key: 'dark_gray', hex: '#151515', label: 'Gray' }
]

interface FocusDimState {
  enabled: boolean
  opacity: number
  dimColor: string
  showBorder: boolean
  fadeDuration: number
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FocusDim(): React.JSX.Element {
  const [state, setState] = useState<FocusDimState>({
    enabled: false,
    opacity: 0.6,
    dimColor: 'black',
    showBorder: true,
    fadeDuration: 200
  })

  const sliderRef = useRef<HTMLInputElement>(null)

  // ── Load initial state ─────────────────────────────────────────────────

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_GET_STATE).then((s) => {
      if (s && typeof s === 'object') {
        setState(s as FocusDimState)
      }
    })
  }, [])

  // ── Listen for state changes from main process ─────────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(IPC_SEND.FOCUSDIM_STATE_CHANGED, (s: unknown) => {
      if (s && typeof s === 'object') {
        setState(s as FocusDimState)
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

  const handleSetColor = useCallback((colorKey: string) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_COLOR, colorKey)
    setState((prev) => ({ ...prev, dimColor: colorKey }))
  }, [])

  const handleSetBorder = useCallback((show: boolean) => {
    window.peakflow.invoke(IPC_INVOKE.FOCUSDIM_SET_BORDER, show)
    setState((prev) => ({ ...prev, showBorder: show }))
  }, [])

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
  const dimColorHex =
    DIM_COLORS.find((c) => c.key === state.dimColor)?.hex ?? '#000000'

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
          {DIM_COLORS.map((c) => (
            <ColorSwatch
              key={c.key}
              hex={c.hex}
              label={c.label}
              active={c.key === state.dimColor}
              onClick={() => handleSetColor(c.key)}
            />
          ))}
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0'
          }}
        >
          <span style={{ fontSize: 13, color: DS.textSecondary }}>
            Keyboard shortcut
          </span>
          <span
            style={{
              fontSize: 13,
              color: DS.textDim,
              fontWeight: 500,
              letterSpacing: '1px'
            }}
          >
            Ctrl+Shift+D
          </span>
        </div>
      </div>
    </>
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
          background: checked ? DS.green : DS.surface2,
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
