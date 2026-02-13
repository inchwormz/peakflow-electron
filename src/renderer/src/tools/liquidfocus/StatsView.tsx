/**
 * StatsView — Session statistics display.
 *
 * Matches LiquidFocus_Redesign.html stats section:
 *   - Three stat cards: Focus Time, Sessions, Interruptions
 *   - 7-day bar chart with daily breakdown
 *   - Dark cinematic glassmorphism style
 */

import { useState, useMemo, type CSSProperties } from 'react'
import { DS, type SessionStats } from './LiquidFocus'

interface StatsViewProps {
  stats: SessionStats
  onBack: () => void
}

export function StatsView({ stats, onBack }: StatsViewProps): React.JSX.Element {
  const focusHours = useMemo(() => {
    return Math.round((stats.allTime * 25) / 60 * 10) / 10
  }, [stats.allTime])

  const chartMax = useMemo(() => {
    return Math.max(1, ...stats.dailyBreakdown.map((d) => d.count))
  }, [stats.dailyBreakdown])

  // ── Styles ────────────────────────────────────────────────────────────

  const navBar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 0',
    flexShrink: 0
  }

  const body: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '0 24px 24px',
    scrollbarWidth: 'thin',
    scrollbarColor: `${DS.elevated} transparent`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Nav bar */}
      <div style={navBar}>
        <div style={{ display: 'flex', gap: 8 }}>
          <NavBtn onClick={onBack}>&#9664;</NavBtn>
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: DS.white,
            letterSpacing: 0.5
          }}
        >
          Statistics
        </span>
        <div style={{ width: 32 }} /> {/* Spacer for alignment */}
      </div>

      <div style={body}>
        {/* Stat cards */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 20
          }}
        >
          <StatCard label="Focus Time" value={`${focusHours}h`} color={DS.blue} />
          <StatCard label="Sessions" value={String(stats.allTime)} color={DS.green} />
          <StatCard label="Interruptions" value={String(stats.interruptions)} color={DS.red} />
        </div>

        {/* Quick stats */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            marginTop: 24,
            padding: '16px 0',
            borderTop: `1px solid ${DS.surface}`,
            borderBottom: `1px solid ${DS.surface}`
          }}
        >
          <QuickStat label="Streak" value={String(stats.streak)} suffix="days" />
          <QuickStat label="Today" value={String(stats.today)} suffix="sessions" />
          <QuickStat label="Average" value={String(Math.round(stats.allTime / Math.max(stats.dailyBreakdown.length, 1)))} suffix="/day" />
        </div>

        {/* 7-day chart */}
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 12
            }}
          >
            Last 7 Days
          </div>

          <div
            style={{
              background: DS.surface2,
              borderRadius: 12,
              padding: '20px 16px 12px'
            }}
          >
            {/* Bars */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                height: 80,
                marginBottom: 8
              }}
            >
              {stats.dailyBreakdown.map((day, i) => {
                const h = day.count > 0 ? Math.max(8, (day.count / chartMax) * 60) : 4
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      flex: 1
                    }}
                  >
                    {day.count > 0 && (
                      <div
                        style={{
                          fontSize: 9,
                          color: DS.textDim,
                          fontWeight: 500
                        }}
                      >
                        {day.count}
                      </div>
                    )}
                    <div
                      style={{
                        width: 28,
                        height: h,
                        borderRadius: '4px 4px 0 0',
                        background: day.count > 0 ? DS.blue : DS.border,
                        transition: 'height 0.3s ease'
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* Day labels */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-around'
              }}
            >
              {stats.dailyBreakdown.map((day, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 9,
                    color: DS.textLabel,
                    flex: 1,
                    textAlign: 'center'
                  }}
                >
                  {day.date.slice(-2)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color
}: {
  label: string
  value: string
  color: string
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        background: DS.surface2,
        borderRadius: 12,
        padding: '12px 8px',
        textAlign: 'center'
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 4
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color
        }}
      >
        {value}
      </div>
    </div>
  )
}

function QuickStat({
  label,
  value,
  suffix
}: {
  label: string
  value: string
  suffix: string
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: DS.white,
          lineHeight: 1
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          color: DS.textLabel,
          marginTop: 4,
          textTransform: 'uppercase',
          letterSpacing: 1
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 8,
          color: DS.textLabel,
          marginTop: 2
        }}
      >
        {suffix}
      </div>
    </div>
  )
}

function NavBtn({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
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
