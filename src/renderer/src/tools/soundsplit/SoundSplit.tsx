/**
 * SoundSplit — Per-App Volume Control UI.
 *
 * Matches SoundSplit_Redesign.html exactly:
 *   - Master volume section at top with slider + VU meter
 *   - Per-app rows: icon, name, volume slider (small), VU meter, mute button
 *   - Dark cinematic design: #0a0a0a bg, Be Vietnam Pro font
 *   - No navigation tabs — simplest UI of all tools
 *
 * Communicates with main process via IPC:
 *   - soundsplit:get-sessions → get all audio sessions
 *   - soundsplit:set-volume   → set per-app volume
 *   - soundsplit:set-mute     → mute/unmute
 *   - soundsplit:get-master   → get master volume
 *   - soundsplit:set-master   → set master volume
 *   - soundsplit:sessions-updated → push updates (VU meters)
 */

import { useState, useEffect, useCallback } from 'react'
import { TitleBar } from '../../components/layout/TitleBar'
import { Slider } from '../../components/ui/Slider'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'

// ─── Design Tokens (dark cinematic) ─────────────────────────────────────────

const DS = {
  bg: '#0a0a0a',
  surface: '#111111',
  surface2: '#1a1a1a',
  border: '#141414',
  textPrimary: '#f0f0f5',
  textSecondary: '#888888',
  textMuted: '#666666',
  textLabel: '#444444',
  textEmpty: '#333333',
  green: '#4ae08a',
  yellow: '#eab308',
  red: '#f05858',
  white: '#ffffff'
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

interface AudioSession {
  pid: number
  name: string
  displayName: string
  volume: number
  peak: number
  muted: boolean
  iconPath: string | null
}

interface MasterAudio {
  volume: number
  peak: number
}

// ─── App Icons (emoji fallback matching HTML spec) ──────────────────────────

const APP_ICONS: Record<string, string> = {
  Spotify: '\uD83C\uDFB5', // musical note
  chrome: '\uD83C\uDF10', // globe
  Chrome: '\uD83C\uDF10',
  Discord: '\uD83D\uDCAC', // speech bubble
  vlc: '\uD83C\uDFAC', // clapper board
  'VLC Media Player': '\uD83C\uDFAC',
  'Microsoft Teams': '\uD83D\uDCDE', // telephone
  Teams: '\uD83D\uDCDE',
  Firefox: '\uD83E\uDD8A', // fox
  OBS: '\uD83D\uDD34', // red circle
  Zoom: '\uD83D\uDCF9', // video camera
  Steam: '\uD83C\uDFAE' // game controller
}

function getAppIcon(name: string): string {
  return APP_ICONS[name] || name.charAt(0).toUpperCase()
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SoundSplit(): React.JSX.Element {
  const [sessions, setSessions] = useState<AudioSession[]>([])
  const [masterVolume, setMasterVolume] = useState(80)

  // ── Load initial state ──────────────────────────────────────────────────

  useEffect(() => {
    // Get sessions
    window.peakflow
      .invoke(IPC_INVOKE.SOUNDSPLIT_GET_SESSIONS)
      .then((data) => {
        if (Array.isArray(data)) {
          setSessions(data as AudioSession[])
        }
      })

    // Get master volume
    window.peakflow
      .invoke(IPC_INVOKE.SOUNDSPLIT_GET_MASTER)
      .then((data) => {
        if (data && typeof data === 'object') {
          const master = data as MasterAudio
          setMasterVolume(Math.round(master.volume * 100))
        }
      })
  }, [])

  // ── Listen for session updates (VU meters) ──────────────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.SOUNDSPLIT_SESSIONS_UPDATED,
      (data: unknown) => {
        if (Array.isArray(data)) {
          setSessions(data as AudioSession[])
        }
      }
    )
    return unsub
  }, [])

  // ── IPC Actions ─────────────────────────────────────────────────────────

  const handleMasterChange = useCallback((value: number) => {
    setMasterVolume(value)
    window.peakflow.invoke(IPC_INVOKE.SOUNDSPLIT_SET_MASTER, value / 100)
  }, [])

  const handleAppVolumeChange = useCallback((pid: number, value: number) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.pid === pid
          ? { ...s, volume: value / 100, muted: s.muted && value > 0 ? false : s.muted }
          : s
      )
    )
    window.peakflow.invoke(IPC_INVOKE.SOUNDSPLIT_SET_VOLUME, pid, value / 100)
  }, [])

  const handleToggleMute = useCallback((pid: number) => {
    setSessions((prev) => {
      const session = prev.find((s) => s.pid === pid)
      if (session) {
        window.peakflow.invoke(IPC_INVOKE.SOUNDSPLIT_SET_MUTE, pid, !session.muted)
      }
      return prev.map((s) => (s.pid === pid ? { ...s, muted: !s.muted } : s))
    })
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <TitleBar title="SoundSplit" showMaximize={false} />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
        }}
      >
        {/* Subtitle */}
        <div
          style={{
            fontSize: 10,
            color: DS.textMuted,
            letterSpacing: '0.5px',
            padding: '2px 24px 16px'
          }}
        >
          Per-app volume control
        </div>

        {/* MASTER section label */}
        <SectionLabel>Master</SectionLabel>

        {/* Master volume row */}
        <div style={{ padding: '0 24px 4px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: DS.surface,
              borderRadius: 14,
              padding: '14px 16px'
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>
              {'\uD83D\uDD0A'}
            </span>
            <div style={{ flex: 1 }}>
              <Slider
                value={masterVolume}
                min={0}
                max={100}
                onChange={handleMasterChange}
                aria-label="Master volume"
              />
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: DS.textSecondary,
                width: 32,
                textAlign: 'right',
                flexShrink: 0
              }}
            >
              {masterVolume}%
            </span>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: DS.border,
            margin: '12px 24px'
          }}
        />

        {/* Applications section label */}
        <SectionLabel>Applications ({sessions.length})</SectionLabel>

        {/* App list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 24px 20px'
          }}
        >
          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            sessions.map((session) => (
              <AppRow
                key={session.pid}
                session={session}
                onVolumeChange={(value) => handleAppVolumeChange(session.pid, value)}
                onToggleMute={() => handleToggleMute(session.pid)}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Section label: 8px uppercase, letter-spacing 2.5px, #444 */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: '2.5px',
        textTransform: 'uppercase',
        color: DS.textLabel,
        padding: '0 24px',
        marginBottom: 8
      }}
    >
      {children}
    </div>
  )
}

/** Empty state matching HTML .empty-state */
function EmptyState(): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '50px 20px',
        color: DS.textEmpty,
        fontSize: 12,
        lineHeight: 1.6
      }}
    >
      No apps playing audio
      <br />
      <br />
      Play something to see it here
    </div>
  )
}

/** VU meter bar: 3px tall, color-coded green/yellow/red */
function VUMeter({ level }: { level: number }): React.JSX.Element {
  const percent = Math.min(100, Math.max(0, level * 100))

  let color = DS.green
  if (percent > 80) color = DS.red
  else if (percent > 55) color = DS.yellow

  return (
    <div
      style={{
        height: 3,
        borderRadius: 2,
        background: DS.surface2,
        marginTop: 6,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 2,
          width: `${percent}%`,
          background: color,
          transition: 'width 0.1s ease, background 0.2s'
        }}
      />
    </div>
  )
}

/** Per-app volume row matching HTML .app-row */
function AppRow({
  session,
  onVolumeChange,
  onToggleMute
}: {
  session: AudioSession
  onVolumeChange: (value: number) => void
  onToggleMute: () => void
}): React.JSX.Element {
  const [muteHovered, setMuteHovered] = useState(false)

  const volumePercent = Math.round(session.volume * 100)
  const displayName =
    session.displayName.length > 20
      ? session.displayName.slice(0, 18) + '...'
      : session.displayName

  const icon = getAppIcon(session.name) || getAppIcon(session.displayName)

  // Determine if icon is emoji (multi-char surrogate pair) or a letter
  const isEmoji = icon.length > 1

  return (
    <div
      style={{
        background: DS.surface,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 6
      }}
    >
      {/* Top row: icon, name, percentage, mute button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8
        }}
      >
        {/* App icon */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: DS.surface2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isEmoji ? 16 : 14,
            fontWeight: isEmoji ? 400 : 600,
            color: DS.textPrimary,
            flexShrink: 0
          }}
        >
          {icon}
        </div>

        {/* App name */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: DS.textPrimary
          }}
        >
          {displayName}
        </span>

        {/* Volume percentage */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: DS.textMuted,
            width: 32,
            textAlign: 'right'
          }}
        >
          {volumePercent}%
        </span>

        {/* Mute button */}
        <button
          onClick={onToggleMute}
          onMouseEnter={() => setMuteHovered(true)}
          onMouseLeave={() => setMuteHovered(false)}
          style={{
            border: 'none',
            background: 'transparent',
            color: session.muted
              ? DS.red
              : muteHovered
                ? DS.white
                : DS.textSecondary,
            fontSize: 16,
            cursor: 'pointer',
            padding: '2px 4px',
            transition: 'color 0.2s',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label={session.muted ? 'Unmute' : 'Mute'}
        >
          {session.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
        </button>
      </div>

      {/* Volume slider (small: 3px track, 12px thumb) */}
      <Slider
        value={volumePercent}
        min={0}
        max={100}
        onChange={onVolumeChange}
        size="small"
        aria-label={`${session.displayName} volume`}
      />

      {/* VU meter */}
      <VUMeter level={session.muted ? 0 : session.peak} />
    </div>
  )
}
