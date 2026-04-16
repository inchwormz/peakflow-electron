/**
 * LiquidFocusMini — Compact floating timer widget.
 *
 * Frameless 220x64 window, always-on-top, bottom-right.
 * Premium watch-complication aesthetic: smoked glass surface,
 * living progress ring, precision typography.
 */

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { DS, type TimerState } from './LiquidFocus'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'

const RING = { size: 40, r: 15, cx: 20, cy: 20 }
const RING_C = 2 * Math.PI * RING.r

const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' }

export function LiquidFocusMini(): React.JSX.Element {
  const [timer, setTimer] = useState<TimerState>({
    mode: 'work',
    status: 'idle',
    remaining: 25 * 60,
    total: 25 * 60,
    pomodorosCompleted: 0,
    sessionsBeforeLong: 4,
    activeTaskIndex: -1
  })

  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.LIQUIDFOCUS_GET_STATE)
      .then((state) => {
        const s = state as { timer: TimerState }
        if (s?.timer) setTimer(s.timer)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.LIQUIDFOCUS_STATE_CHANGED,
      (data: unknown) => {
        const update = data as { timer: TimerState }
        if (update?.timer) setTimer(update.timer)
      }
    )
    return unsub
  }, [])

  const isBreak = timer.mode !== 'work'
  const progress = timer.total > 0 ? 1 - timer.remaining / timer.total : 0
  const dashOffset = RING_C * (1 - progress)

  const minutes = Math.floor(timer.remaining / 60)
  const seconds = timer.remaining % 60
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const modeLabel = useMemo(() => {
    switch (timer.mode) {
      case 'work':
        return 'FOCUS'
      case 'short_break':
        return 'SHORT BREAK'
      case 'long_break':
        return 'LONG BREAK'
      default:
        return 'FOCUS'
    }
  }, [timer.mode])

  const pomDots = useMemo(() => {
    const count = timer.sessionsBeforeLong
    const filled = timer.pomodorosCompleted % count
    return Array.from({ length: count }, (_, i) => i < filled)
  }, [timer.pomodorosCompleted, timer.sessionsBeforeLong])

  const handleToggle = useCallback(() => {
    if (timer.status === 'running') {
      window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_PAUSE)
    } else {
      window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_START)
    }
  }, [timer.status])

  const handleOpenFull = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.WINDOW_OPEN, { toolId: ToolId.LiquidFocus })
  }, [])

  const handleClose = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_TOGGLE_MINI)
  }, [])

  const isRunning = timer.status === 'running'
  const accent = isBreak ? DS.accent : DS.orange
  const glowColor = isBreak ? 'rgba(255,225,124,' : 'rgba(255,112,67,'
  const [playHover, setPlayHover] = useState(false)
  const [closeHover, setCloseHover] = useState(false)

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 10px 0 12px',
        background: 'linear-gradient(160deg, rgba(22, 22, 28, 0.97) 0%, rgba(10, 10, 14, 0.97) 100%)',
        border: 'none',
        borderRadius: 0,
        fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
        cursor: 'default',
        WebkitAppRegion: 'drag',
        overflow: 'hidden'
      }}
    >
      {/* Ring — click to open full window */}
      <div style={{ flexShrink: 0, cursor: 'pointer', ...noDrag }} onClick={handleOpenFull}>
        <svg
          viewBox="0 0 40 40"
          width={RING.size}
          height={RING.size}
          style={{
            transform: 'rotate(-90deg)',
            filter: isRunning
              ? `drop-shadow(0 0 6px ${glowColor}0.35))`
              : 'none',
            transition: 'filter 0.4s'
          }}
        >
          {/* Center fill — gives the ring body */}
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r - 2}
            fill={isRunning ? `${glowColor}0.08)` : 'rgba(255,255,255,0.02)'}
            style={{ transition: 'fill 0.4s' }}
          />
          {/* Track */}
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={2.5}
          />
          {/* Progress arc — thicker than track for emphasis */}
          <circle
            cx={RING.cx}
            cy={RING.cy}
            r={RING.r}
            fill="none"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
      </div>

      {/* Center: time + session dots + mode — drag handle */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column' as const,
          justifyContent: 'center',
          gap: 3
        }}
      >
        <div
          style={{
            fontSize: 21,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.95)',
            lineHeight: 1,
            letterSpacing: 2,
            fontFeatureSettings: "'tnum'"
          }}
        >
          {timeDisplay}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {pomDots.map((filled, i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: filled ? accent : 'rgba(255,255,255,0.18)',
                  boxShadow: filled ? `0 0 6px ${glowColor}0.4)` : 'none',
                  transition: 'background 0.3s, box-shadow 0.3s'
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 8.5,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase'
            }}
          >
            {modeLabel}
          </div>
        </div>
      </div>

      {/* Play / Pause */}
      <button
        onClick={handleToggle}
        onMouseEnter={() => setPlayHover(true)}
        onMouseLeave={() => setPlayHover(false)}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: `1px solid ${playHover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}`,
          background: playHover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
          transition: 'background 0.15s, border-color 0.15s',
          ...noDrag
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          {isRunning ? (
            <>
              <rect x="2.5" y="2" width="2.5" height="8" rx="0.75"
                fill={playHover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'} />
              <rect x="7" y="2" width="2.5" height="8" rx="0.75"
                fill={playHover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'} />
            </>
          ) : (
            <path d="M3 1.5L10.5 6L3 10.5V1.5Z"
              fill={playHover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'} />
          )}
        </svg>
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        onMouseEnter={() => setCloseHover(true)}
        onMouseLeave={() => setCloseHover(false)}
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: 'none',
          background: closeHover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
          transition: 'background 0.15s',
          ...noDrag
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path
            d="M1 1L7 7M7 1L1 7"
            stroke={closeHover ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)'}
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{ transition: 'stroke 0.15s' }}
          />
        </svg>
      </button>
    </div>
  )
}
