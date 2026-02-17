/**
 * AlertOverlay — Full-Screen Meeting Alert
 *
 * Rendered in a fullscreen BrowserWindow (SystemWindowId.ScreenSlapAlert).
 * Matches ScreenSlap_Redesign.html alert section pixel-for-pixel:
 *   - Dark background (#0a0a1a) with animated gradient bars
 *   - Radial glow effect behind content
 *   - Pulsing "UPCOMING" label in blue
 *   - Large event title (52px), time, and countdown
 *   - Urgency states: blue (normal) → yellow (< 3 min) → red (< 1 min)
 *   - Join Meeting button (if meeting link detected)
 *   - Snooze 5 min / Snooze 10 min buttons
 *   - Dismiss button
 *   - "Press any key to dismiss" hint
 *   - Fade-in animation on mount
 *
 * Receives alert data via IPC: 'screenslap:alert-data'
 * Actions via IPC: screenslap:snooze, screenslap:dismiss, screenslap:join-meeting
 */

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'

// ─── Design Tokens ──────────────────────────────────────────────────────────

const DS = {
  bg: '#0a0a1a',
  textPrimary: '#ffffff',
  textSecondary: '#5eb8ff',
  textTime: '#888888',
  textHint: '#444444',
  blue: '#5eb8ff',
  green: '#4ae08a',
  yellow: '#eab308',
  red: '#f05858',
  dismissBg: '#1a1a1a',
  dismissHover: '#222222',
  dismissText: '#888888',
  dismissBorder: '#333333',
  snoozeBg: '#1a2f2a',
  snoozeHover: '#254540',
  snoozeText: '#4ade80',
  snoozeBorder: '#22c55e',
  joinBg: '#0a84ff',
  joinHover: '#5eb8ff',
  joinText: '#ffffff',
  joinBorder: '#0a84ff'
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

interface AlertInfo {
  eventId: string
  summary: string
  startTime: string
  timeFormatted: string
  timeUntil: string
  meetingLink: string | null
  meetingService: string | null
  durationMinutes: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const api = window.peakflow

function formatRelative(ms: number): string {
  if (ms <= 0) return 'Starting now!'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'Starting now!'
  const min = Math.ceil(ms / 60_000)
  if (min === 1) return 'In 1 minute'
  if (min < 60) return `In ${min} minutes`
  const hrs = Math.floor(min / 60)
  const rem = min % 60
  if (hrs === 1 && rem === 0) return 'In 1 hour'
  if (rem === 0) return `In ${hrs} hours`
  return `In ${hrs}h ${rem}m`
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AlertOverlay(): React.JSX.Element {
  const [alert, setAlert] = useState<AlertInfo | null>(null)
  const [opacity, setOpacity] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [, forceUpdate] = useState(0)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Receive alert data from main process ───────────────────────────────

  useEffect(() => {
    const unsub = api.on(IPC_SEND.SCREENSLAP_ALERT_DATA, (data: unknown) => {
      setAlert(data as AlertInfo)
    })
    return unsub
  }, [])

  // ─── Fade in on mount / when alert arrives ──────────────────────────────

  useEffect(() => {
    if (alert && !dismissed) {
      // Animate opacity from 0 to 1 over 300ms
      let frame = 0
      const steps = 15
      const step = (): void => {
        frame++
        setOpacity(Math.min(frame / steps, 1))
        if (frame < steps) {
          fadeTimer.current = setTimeout(step, 20)
        }
      }
      step()

      // Play notification sound via synthesized tone (reliable across platforms)
      try {
        const audioCtx = new AudioContext()
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.type = 'sine'
        // Two-tone alert: ascending beep
        osc.frequency.setValueAtTime(523, audioCtx.currentTime) // C5
        osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.15) // E5
        osc.frequency.setValueAtTime(784, audioCtx.currentTime + 0.3) // G5
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + 0.5)
        osc.onended = () => audioCtx.close()
      } catch {
        // Sound not critical
      }
    }

    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    }
  }, [alert, dismissed])

  // ─── Countdown tick ─────────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // ─── Keyboard dismiss ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!dismissed) {
        handleDismiss()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dismissed])

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleDismiss = (): void => {
    if (dismissed) return
    setDismissed(true)
    fadeOut(() => {
      api.invoke(IPC_INVOKE.SCREENSLAP_DISMISS)
    })
  }

  const handleSnooze = (minutes: number): void => {
    if (dismissed || !alert) return
    setDismissed(true)
    fadeOut(() => {
      api.invoke(IPC_INVOKE.SCREENSLAP_SNOOZE, alert.eventId, minutes)
    })
  }

  const handleJoinMeeting = (): void => {
    if (!alert?.meetingLink) return
    api.invoke(IPC_INVOKE.SCREENSLAP_JOIN_MEETING, alert.meetingLink)
    setDismissed(true)
    fadeOut(() => {})
  }

  const fadeOut = (onComplete: () => void): void => {
    let frame = 10
    const step = (): void => {
      frame--
      setOpacity(Math.max(frame / 10, 0))
      if (frame > 0) {
        setTimeout(step, 20)
      } else {
        onComplete()
      }
    }
    step()
  }

  // ─── Computed values ────────────────────────────────────────────────────

  const diff = alert
    ? new Date(alert.startTime).getTime() - Date.now()
    : 0

  const countdownText = alert ? formatRelative(diff) : ''

  // Urgency class: blue → yellow (< 3 min) → red (< 1 min)
  let countdownColor = DS.textSecondary
  let countdownAnimation: string | undefined
  if (diff < 60_000) {
    countdownColor = DS.red
    countdownAnimation = 'blink 1s infinite'
  } else if (diff < 180_000) {
    countdownColor = DS.yellow
  }

  const displayTitle = alert
    ? alert.summary.length < 60
      ? alert.summary
      : alert.summary.slice(0, 57) + '\u2026'
    : ''

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!alert) {
    return <div style={{ ...styles.root, opacity: 0 }} />
  }

  return (
    <div style={{ ...styles.root, opacity }}>
      {/* Gradient accent bars */}
      <div style={styles.barTop} />
      <div style={styles.barBot} />

      {/* Radial glow */}
      <div style={styles.glow} />

      {/* Content */}
      <div style={styles.content}>
        {/* Upcoming label with pulse animation */}
        <div style={styles.upcoming}>&#9889; UPCOMING</div>

        {/* Event title */}
        <div style={styles.title}>{displayTitle}</div>

        {/* Event time */}
        <div style={styles.time}>{alert.timeFormatted}</div>

        {/* Countdown with urgency color */}
        <div
          style={{
            ...styles.countdown,
            color: countdownColor,
            animation: countdownAnimation
          }}
        >
          {diff <= 0 ? 'Starting now!' : countdownText}
        </div>

        {/* Action buttons */}
        <div style={styles.btns}>
          {alert.meetingLink && (
            <AlertButton
              label={`\uD83C\uDFA5 Join ${alert.meetingService ?? 'Meeting'}`}
              bg={DS.joinBg}
              hoverBg={DS.joinHover}
              color={DS.joinText}
              borderColor={DS.joinBorder}
              onClick={handleJoinMeeting}
              wide
            />
          )}
          <AlertButton
            label="&#9200; 5 min"
            bg={DS.snoozeBg}
            hoverBg={DS.snoozeHover}
            color={DS.snoozeText}
            borderColor={DS.snoozeBorder}
            onClick={() => handleSnooze(5)}
          />
          <AlertButton
            label="&#9200; 10 min"
            bg={DS.snoozeBg}
            hoverBg={DS.snoozeHover}
            color={DS.snoozeText}
            borderColor={DS.snoozeBorder}
            onClick={() => handleSnooze(10)}
          />
          <AlertButton
            label="&#10003; Dismiss"
            bg={DS.dismissBg}
            hoverBg={DS.dismissHover}
            color={DS.dismissText}
            borderColor={DS.dismissBorder}
            onClick={handleDismiss}
          />
        </div>
      </div>

      {/* Hint */}
      <div style={styles.hint}>Press any key to dismiss</div>

      {/* Inline keyframe styles */}
      <style>{`
        @keyframes barShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ─── Alert Button ───────────────────────────────────────────────────────────

function AlertButton({
  label,
  bg,
  hoverBg,
  color,
  borderColor,
  onClick,
  wide
}: {
  label: string
  bg: string
  hoverBg: string
  color: string
  borderColor: string
  onClick: () => void
  wide?: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      style={{
        ...styles.btn,
        background: hovered ? hoverBg : bg,
        color,
        borderColor,
        minWidth: wide ? 180 : 120,
        transform: hovered ? 'translateY(-2px)' : 'none'
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      dangerouslySetInnerHTML={{ __html: label }}
    />
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 10,
    background: DS.bg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    transition: 'opacity 0.3s ease',
    cursor: 'default'
  },

  barTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
    background: 'linear-gradient(90deg, #5eb8ff, #4ae08a, #5eb8ff, #4ae08a)',
    backgroundSize: '200% 100%',
    animation: 'barShift 8s ease infinite'
  },

  barBot: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
    background: 'linear-gradient(90deg, #4ae08a, #5eb8ff, #4ae08a, #5eb8ff)',
    backgroundSize: '200% 100%',
    animation: 'barShift 8s ease infinite reverse'
  },

  glow: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 600,
    height: 600,
    borderRadius: '50%',
    background:
      'radial-gradient(circle, rgba(94,184,255,0.1) 0%, rgba(74,224,138,0.05) 40%, transparent 70%)',
    pointerEvents: 'none'
  },

  content: {
    textAlign: 'center',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: 5
  },

  upcoming: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 5,
    textTransform: 'uppercase',
    color: DS.textSecondary,
    marginBottom: 20,
    animation: 'pulse 2s ease-in-out infinite'
  },

  title: {
    fontSize: 52,
    fontWeight: 700,
    color: DS.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
    maxWidth: '80vw',
    lineHeight: 1.15,
    padding: '0 40px'
  },

  time: {
    fontSize: 26,
    color: DS.textTime,
    marginBottom: 6,
    fontWeight: 500
  },

  countdown: {
    fontSize: 18,
    marginBottom: 36,
    fontWeight: 400,
    letterSpacing: 0.5
  },

  btns: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    justifyContent: 'center'
  },

  btn: {
    padding: '14px 28px',
    borderRadius: 14,
    border: '2px solid transparent',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    letterSpacing: 0.3,
    outline: 'none'
  },

  hint: {
    position: 'absolute',
    bottom: 28,
    fontSize: 11,
    color: DS.textHint,
    letterSpacing: 1.5
  }
}
