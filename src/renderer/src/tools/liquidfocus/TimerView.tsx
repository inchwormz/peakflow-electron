/**
 * TimerView — SVG ring timer + controls + pomodoro dots + stats row.
 *
 * Matches LiquidFocus_Redesign.html .timer-body exactly:
 *   - 190x190 SVG ring with gradient stroke (#4ae08a -> #5eb8ff)
 *   - 46px timer digits, 300 weight, letter-spacing 2px
 *   - 6x6 pomodoro dots, pill-shaped Start/Pause button
 *   - Stats row: Streak / Today (mini chart) / All Time
 */

import { useState, useMemo, type CSSProperties } from 'react'
import { DS, type TimerState, type SessionStats } from './LiquidFocus'

interface TimerViewProps {
  timer: TimerState
  stats: SessionStats
  onToggle: () => void
  onReset: () => void
  onSkip: () => void
  onShowTasks: () => void
  onShowStats: () => void
  onShowSettings: () => void
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RING_SIZE = 190
const RING_RADIUS = 88
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// ─── Component ──────────────────────────────────────────────────────────────

export function TimerView({
  timer,
  stats,
  onToggle,
  onReset,
  onSkip,
  onShowTasks,
  onShowStats,
  onShowSettings
}: TimerViewProps): React.JSX.Element {
  const isRunning = timer.status === 'running'
  const progress = timer.total > 0 ? 1 - timer.remaining / timer.total : 0
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress)

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

  const isBreak = timer.mode !== 'work'

  // Pomodoro dots
  const pomDots = useMemo(() => {
    const count = timer.sessionsBeforeLong
    const filled = timer.pomodorosCompleted % count
    return Array.from({ length: count }, (_, i) => i < filled)
  }, [timer.pomodorosCompleted, timer.sessionsBeforeLong])

  // ── Styles ────────────────────────────────────────────────────────────

  const navBar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 0',
    flexShrink: 0
  }

  const timerBody: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 24px 20px'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Nav bar */}
      <div style={navBar}>
        <div style={{ display: 'flex', gap: 8 }}>
          <NavButton onClick={onShowTasks} title="Tasks">
            &#9776;
          </NavButton>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <NavButton onClick={onShowSettings} title="Settings">
            &#9881;
          </NavButton>
        </div>
      </div>

      {/* Timer body */}
      <div style={timerBody}>
        {/* SVG Ring Container */}
        <div
          style={{
            position: 'relative',
            width: RING_SIZE,
            height: RING_SIZE,
            marginBottom: 14
          }}
        >
          <svg
            viewBox="0 0 200 200"
            width={RING_SIZE}
            height={RING_SIZE}
            style={{ transform: 'rotate(-90deg)' }}
          >
            <defs>
              <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={DS.green} />
                <stop offset="100%" stopColor={DS.blue} />
              </linearGradient>
            </defs>
            {/* Track */}
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              fill="none"
              stroke={DS.elevated}
              strokeWidth={4}
            />
            {/* Progress */}
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              fill="none"
              stroke={isBreak ? DS.green : 'url(#ringGrad)'}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>

          {/* Timer center overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                fontSize: 46,
                fontWeight: 300,
                letterSpacing: 2,
                color: DS.white,
                lineHeight: 1,
                fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
              }}
            >
              {timeDisplay}
            </div>
          </div>
        </div>

        {/* Pomodoro dots */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 4 }}>
          {pomDots.map((filled, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: filled ? DS.green : DS.textGhost
              }}
            />
          ))}
        </div>

        {/* Mode label */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: DS.textMuted,
            marginBottom: 16
          }}
        >
          {modeLabel}
        </div>

        {/* Timer controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            width: '100%'
          }}
        >
          <IconButton onClick={onReset} title="Reset">
            &#8635;
          </IconButton>
          <MainButton isRunning={isRunning} onClick={onToggle} />
          <IconButton onClick={onSkip} title="Skip">
            &#9654;
          </IconButton>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            width: '100%',
            marginTop: 'auto',
            paddingTop: 16,
            borderTop: `1px solid ${DS.surface2}`
          }}
        >
          <StatItem
            value={String(stats.streak)}
            label="STREAK"
            color={DS.white}
            onClick={onShowStats}
          />
          <div style={{ textAlign: 'center', cursor: 'pointer' }} onClick={onShowStats}>
            <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1, color: DS.green }}>
              {stats.today}
            </div>
            <div
              style={{
                fontSize: 8,
                fontWeight: 500,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: DS.textDim,
                marginTop: 4
              }}
            >
              TODAY
            </div>
            <MiniChart data={stats.dailyBreakdown} />
          </div>
          <StatItem
            value={String(stats.allTime)}
            label="ALL TIME"
            color={DS.blue}
            onClick={onShowStats}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function NavButton({
  children,
  onClick,
  title,
  isClose
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  isClose?: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1px solid ${hovered ? '#444' : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? (isClose ? DS.red : DS.elevated) : 'transparent',
        color: hovered && isClose ? DS.red : DS.white,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        transition: 'all 0.2s',
        fontFamily: 'inherit',
        padding: 0
      }}
    >
      {children}
    </button>
  )
}

function IconButton({
  children,
  onClick,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: `1px solid ${hovered ? '#444' : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? DS.elevated : 'transparent',
        color: DS.white,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        transition: 'all 0.2s',
        fontFamily: 'inherit',
        padding: 0
      }}
    >
      {children}
    </button>
  )
}

function MainButton({
  isRunning,
  onClick
}: {
  isRunning: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const baseStyle: CSSProperties = {
    padding: '10px 32px',
    borderRadius: 20,
    border: `1px solid ${isRunning ? DS.white : DS.borderLight}`,
    background: isRunning ? DS.white : DS.surface2,
    color: isRunning ? DS.bg : DS.white,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 2,
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }

  if (hovered) {
    if (isRunning) {
      baseStyle.background = '#ddd'
      baseStyle.borderColor = '#ddd'
    } else {
      baseStyle.background = DS.borderLight
      baseStyle.borderColor = '#444'
    }
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={baseStyle}
    >
      {isRunning ? 'PAUSE' : 'START'}
    </button>
  )
}

function StatItem({
  value,
  label,
  color,
  onClick
}: {
  value: string
  label: string
  color: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1, color }}>{value}</div>
      <div
        style={{
          fontSize: 8,
          fontWeight: 500,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: DS.textDim,
          marginTop: 4
        }}
      >
        {label}
      </div>
    </div>
  )
}

function MiniChart({
  data
}: {
  data: { date: string; count: number }[]
}): React.JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.count))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        height: 16,
        marginTop: 6,
        justifyContent: 'center'
      }}
    >
      {data.map((d, i) => {
        const h = d.count > 0 ? Math.max(20, (d.count / max) * 100) : 12
        return (
          <div
            key={i}
            style={{
              width: 6,
              borderRadius: '2px 2px 0 0',
              background: d.count > 0 ? DS.green : DS.elevated,
              height: `${h}%`,
              minHeight: 2
            }}
          />
        )
      })}
    </div>
  )
}

