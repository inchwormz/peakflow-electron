/**
 * LiquidFocusMini: the always-on-top mini timer (v2 look, monochrome).
 *
 * Frameless 220x64 window in the corner. Shows a small white ring, the time
 * and the task (or Paused / Short break / Long break); pause and stop appear
 * on hover. Clicking it opens the panel on Liquid Focus and closes the mini.
 * The window drags by its edges and gaps; the ring, text and buttons click.
 *
 * When a phase ends and the next one waits for you, it grows (272x148, via
 * LIQUIDFOCUS_SET_MINI {card:true}) into the break prompt:
 *   - focus done:  "Focus session done · That's N of M today" [Start break] [Skip]
 *   - cycle done:  "Four sessions done · … long break" [Start long break] [Stop for now]
 *   - break over:  "Break's over · Next up: <task>" [Start focus] [Stop]
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import '../../panel/panel.css'
import { Ring } from '../../panel/kit'
import { Icon } from '../../panel/icons'
import { fmtClock } from '../../panel/hooks'
import { activeTask, lfPause, lfSkip, lfStart, lfStop, phaseFrac, setMini, useLF, type TimerState } from '../../panel/tools/liquidfocus/store'

type Card = null | 'done' | 'cycle' | 'breakover'

const drag = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/**
 * Which card a state change calls for: a card, null (a phase is running: show
 * the pill) or undefined (no change).
 */
function cardFor(prev: TimerState, next: TimerState): Card | undefined {
  if (next.status !== 'idle') return null
  if (prev.mode === 'work' && next.mode !== 'work' && next.pomodorosCompleted > prev.pomodorosCompleted) {
    return next.mode === 'long_break' ? 'cycle' : 'done'
  }
  if (prev.mode !== 'work' && next.mode === 'work' && prev.status !== 'idle') return 'breakover'
  return undefined
}

/** Fills the whole window: the .mini look without its floating position and shadow. */
const fill: CSSProperties = {
  position: 'fixed',
  inset: 0,
  width: 'auto',
  height: 'auto',
  borderRadius: 0,
  boxShadow: 'none',
  background: '#0a0a0a',
  ...drag
}

export function LiquidFocusMini(): React.JSX.Element {
  const lf = useLF()
  const t = lf?.timer
  const [card, setCard] = useState<Card>(null)
  const prev = useRef<TimerState | null>(null)

  // Watch transitions: grow into the break prompt, shrink back when a phase starts, close after Stop
  useEffect(() => {
    if (!t) return
    const p = prev.current
    prev.current = t
    if (!p) {
      if (t.status === 'idle') setMini(false)
      return
    }
    const c = cardFor(p, t)
    if (c === null) {
      if (card) {
        setCard(null)
        setMini(true, false)
      }
      return
    }
    if (c) {
      setCard(c)
      setMini(true, true)
      return
    }
    // Idle with no prompt showing (stopped or reset elsewhere): the mini isn't needed
    if (t.status === 'idle' && !card) setMini(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  // Dark right to the window edges
  useEffect(() => {
    document.documentElement.style.background = '#0a0a0a'
    document.body.style.background = '#0a0a0a'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [])

  const openPanel = (): void => {
    window.peakflow.invoke(IPC_INVOKE.PANEL_SHOW, 'liquidfocus').catch(() => {})
    setMini(false)
  }
  const stop = (): void => {
    lfStop().then(() => setMini(false))
  }

  if (!lf || !t) return <div className="pf" style={fill} />

  if (card) {
    const n = Math.max(1, Math.min(12, t.sessionsBeforeLong || 4))
    const inCycle = t.pomodorosCompleted % n || n
    const mins = Math.round(t.total / 60)
    const task = activeTask(lf)
    let title: string
    let line: string
    let ask: string | null = null
    let primary: string
    let secondary: string
    let onPrimary: () => void
    let onSecondary: () => void
    if (card === 'done') {
      title = 'Focus session done'
      line = `That’s ${inCycle} of ${n} today.`
      ask = `Take a ${mins}-minute break?`
      primary = 'Start break'
      secondary = 'Skip'
      onPrimary = () => void lfStart()
      // Skip the break and go straight into the next focus session (as the prototype does)
      onSecondary = () => void lfSkip().then(() => lfStart())
    } else if (card === 'cycle') {
      title = `${WORDS[n] ?? n} sessions done`
      line = `${fmtMinutes(lf.stats.today * lf.workDurationMinutes)} of focus today.`
      ask = `Time for a ${mins}-minute long break.`
      primary = 'Start long break'
      secondary = 'Stop for now'
      onPrimary = () => void lfStart()
      onSecondary = stop
    } else {
      title = 'Break’s over'
      line = `Next up: ${task?.name || 'another focus session'}`
      primary = 'Start focus'
      secondary = 'Stop'
      onPrimary = () => void lfStart()
      onSecondary = stop
    }
    return (
      <div className="pf">
        <div className="mini card" style={{ ...fill, justifyContent: 'center' }}>
          <div className="hd">
            <div className="mr">
              <Ring size={38} frac={1} stroke={8} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h4>{title}</h4>
              <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</p>
            </div>
          </div>
          {ask ? <p>{ask}</p> : null}
          <div className="btn-row" style={noDrag}>
            <button className="btn primary" onClick={onPrimary}>
              {primary}
            </button>
            <button className="btn" onClick={onSecondary}>
              {secondary}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const paused = t.status !== 'running'
  const sub =
    t.status === 'paused'
      ? 'Paused'
      : t.mode === 'short_break'
        ? 'Short break'
        : t.mode === 'long_break'
          ? 'Long break'
          : activeTask(lf)?.name || 'Focus'
  return (
    <div className="pf">
      <div className="mini" style={fill} title="Click to open Liquid Focus">
        <div className="mr" style={noDrag} onClick={openPanel}>
          <Ring size={38} frac={phaseFrac(t)} stroke={8} />
        </div>
        <div className="tx" style={noDrag} onClick={openPanel}>
          <b>{fmtClock(t.remaining)}</b>
          <span>{sub}</span>
        </div>
        <div className="mc" style={noDrag}>
          <button aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume' : 'Pause'} onClick={() => (paused ? lfStart() : lfPause())}>
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
          <button aria-label="Stop" title="Stop" onClick={stop}>
            <Icon name="stop" />
          </button>
        </div>
      </div>
    </div>
  )
}
