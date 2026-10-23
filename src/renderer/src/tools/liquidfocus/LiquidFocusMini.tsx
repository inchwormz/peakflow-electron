/**
 * LiquidFocusMini: the always-on-top mini timer (v2 look, monochrome).
 *
 * Frameless window in the corner (220x64 at size 1; 1.4 by default). Shows a
 * ring, the time and the task (or Paused / Short break / Long break); pause and
 * stop appear on hover. Clicking it opens the panel on Liquid Focus and closes
 * the mini. Drag from anywhere except the buttons; drag an edge or corner to
 * resize (the content scales with it). Dark or light (liquidfocus.mini_theme);
 * right-click to switch.
 *
 * When a phase ends and the next one waits for you, it grows (272x148, via
 * LIQUIDFOCUS_SET_MINI {card:true}) into the break prompt:
 *   - focus done:  "Focus session done · That's N of M today" [Start break] [Skip]
 *   - cycle done:  "Four sessions done · … long break" [Start long break] [Stop for now]
 *   - break over:  "Break's over · Next up: <task>" [Start focus] [Stop]
 *   - looked away: "Looked away — timer reset" [Start again] [Close]  (focus
 *     detection reset the session; liquidfocus.focus_away_action = 'reset')
 *
 * While focus detection watches a running focus session, a small eye shows
 * after the time; it dims while you're looking away (counting toward the
 * threshold, or past it).
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import '../../panel/panel.css'
import { Ring } from '../../panel/kit'
import { Icon } from '../../panel/icons'
import { fmtClock } from '../../panel/hooks'
import { miniStep, type Card } from './mini-card'
import { activeTask, lfDismissAway, lfPause, lfSkip, lfStart, lfStop, phaseFrac, setMini, useLF, type TimerState } from '../../panel/tools/liquidfocus/store'


type Theme = 'dark' | 'light'
/** The layout's own size; the window is this times liquidfocus.mini_size and the content is scaled to fit */
const BASE = { pill: [220, 64], card: [272, 148] } as const
const DRAG_THRESHOLD = 4
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}


/** The .mini look at its base size, without its floating position and shadow; scaled to the window. */
function boxStyle(card: boolean, scale: number): CSSProperties {
  const [w, h] = card ? BASE.card : BASE.pill
  return {
    position: 'fixed',
    left: 0,
    top: 0,
    right: 'auto',
    bottom: 'auto',
    width: w,
    height: h,
    borderRadius: 0,
    boxShadow: 'none',
    background: 'var(--bg)',
    transform: `scale(${scale})`,
    transformOrigin: '0 0',
    userSelect: 'none',
    cursor: 'default'
  }
}

/** The window's scale relative to the layout's base width. */
function useScale(card: boolean): number {
  const base = card ? BASE.card[0] : BASE.pill[0]
  const [w, setW] = useState(window.innerWidth)
  useEffect(() => {
    const on = (): void => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return Math.max(0.5, w / base)
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>('dark')
  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.LiquidFocus })
      .then((c) => setTheme((c as { mini_theme?: Theme } | null)?.mini_theme === 'light' ? 'light' : 'dark'))
      .catch(() => {})
    return window.peakflow.on(IPC_SEND.LIQUIDFOCUS_MINI_THEME, (v) => setTheme(v === 'light' ? 'light' : 'dark'))
  }, [])
  const toggle = (): void => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, { tool: ToolId.LiquidFocus, key: 'mini_theme', value: next }).catch(() => {})
  }
  return [theme, toggle]
}

/**
 * Drag the window from anywhere (buttons excluded: they stop pointerdown).
 * Movement under DRAG_THRESHOLD px counts as a click and calls onClick.
 */
function useDragAnywhere(onClick?: () => void): {
  onPointerDown: (e: RPointerEvent) => void
  onPointerMove: (e: RPointerEvent) => void
  onPointerUp: (e: RPointerEvent) => void
} {
  const s = useRef<{ sx: number; sy: number; wx: number; wy: number; dragging: boolean; frame: number } | null>(null)
  const move = (x: number, y: number, done: boolean): void => {
    window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_MINI_MOVE, { x, y, done }).catch(() => {})
  }
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      s.current = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY, dragging: false, frame: 0 }
    },
    onPointerMove: (e) => {
      const d = s.current
      if (!d) return
      const dx = e.screenX - d.sx
      const dy = e.screenY - d.sy
      if (!d.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      d.dragging = true
      if (d.frame) return
      d.frame = requestAnimationFrame(() => {
        d.frame = 0
        move(d.wx + dx, d.wy + dy, false)
      })
    },
    onPointerUp: (e) => {
      const d = s.current
      s.current = null
      if (!d) return
      if (d.frame) cancelAnimationFrame(d.frame)
      if (d.dragging) move(d.wx + e.screenX - d.sx, d.wy + e.screenY - d.sy, true)
      else onClick?.()
    }
  }
}

type DetState = 'off' | 'loading' | 'focused' | 'absent' | 'away' | 'no-camera' | 'error'

/** The panel's focus detector, as forwarded by main (and whether detection is on at all). */
function useDetectorState(): DetState {
  const [s, setS] = useState<DetState>('off')
  useEffect(() => {
    // A mini opened mid-session hasn't heard a change yet: assume watching if detection is on
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.LiquidFocus })
      .then((c) => {
        if ((c as { focus_detection_enabled?: boolean } | null)?.focus_detection_enabled) setS((cur) => (cur === 'off' ? 'loading' : cur))
      })
      .catch(() => {})
    return window.peakflow.on(IPC_SEND.LIQUIDFOCUS_DETECTOR, (v) => setS(String(v) as DetState))
  }, [])
  return s
}

/** Buttons keep their own clicks and never start a drag. */
const ownPointer = { onPointerDown: (e: RPointerEvent) => e.stopPropagation() }

export function LiquidFocusMini(): React.JSX.Element {
  const lf = useLF()
  const t = lf?.timer
  const [card, setCard] = useState<Card>(null)
  const prev = useRef<TimerState | null>(null)
  const scale = useScale(!!card)
  const [theme, toggleTheme] = useTheme()
  const det = useDetectorState()
  const cardRef = useRef<Card>(null)
  cardRef.current = card

  // Watch timer states: grow into a prompt, shrink back when a phase starts,
  // close after Stop. Rules (incl. the look-away notice from main) in mini-card.ts.
  useEffect(() => {
    if (!t) return
    const p = prev.current
    prev.current = t
    const step = miniStep(p, t, cardRef.current)
    if (step.card !== undefined) {
      cardRef.current = step.card
      setCard(step.card)
    }
    if (step.window === 'close') setMini(false)
    else if (step.window) setMini(true, step.window === 'card')
  }, [t])

  // The timer's colour right to the window edges
  useEffect(() => {
    const bg = theme === 'light' ? '#ffffff' : '#0a0a0a'
    document.documentElement.style.background = bg
    document.body.style.background = bg
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }, [theme])

  const openPanel = (): void => {
    window.peakflow.invoke(IPC_INVOKE.PANEL_SHOW, 'liquidfocus').catch(() => {})
    setMini(false)
  }
  const stop = (): void => {
    lfStop().then(() => setMini(false))
  }
  // Stop on the timer ends the session, so it takes two presses: the first turns
  // the button into "Stop?" for a few seconds (a mis-click no longer loses the session)
  const [stopArmed, setStopArmed] = useState(false)
  useEffect(() => {
    if (!stopArmed) return
    const id = setTimeout(() => setStopArmed(false), 3000)
    return () => clearTimeout(id)
  }, [stopArmed])
  const stopTwice = (): void => {
    if (stopArmed) stop()
    else setStopArmed(true)
  }
  const dragCard = useDragAnywhere()
  const dragPill = useDragAnywhere(openPanel)
  const root = theme === 'light' ? 'pf mini-light' : 'pf'
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    toggleTheme()
  }

  if (!lf || !t) return <div className={root} style={boxStyle(false, scale)} />

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
    if (card === 'away') {
      title = 'Looked away — timer reset'
      line = `Focus is back to ${fmtMinutes(Math.round(t.total / 60))}.`
      primary = 'Start again'
      secondary = 'Close'
      onPrimary = () => void lfStart()
      // Clears main's notice; the idle state that follows closes the mini
      onSecondary = () => void lfDismissAway()
    } else if (card === 'done') {
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
      <div className={root} onContextMenu={onContextMenu}>
        <div className="mini card" style={{ ...boxStyle(true, scale), justifyContent: 'center' }} {...dragCard}>
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
          <div className="btn-row" {...ownPointer}>
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
  const watching = t.mode === 'work' && t.status === 'running' && det !== 'off' && det !== 'no-camera' && det !== 'error'
  const sub =
    t.status === 'paused'
      ? 'Paused'
      : t.mode === 'short_break'
        ? 'Short break'
        : t.mode === 'long_break'
          ? 'Long break'
          : activeTask(lf)?.name || 'Focus'
  return (
    <div className={root} onContextMenu={onContextMenu}>
      <div className={stopArmed ? 'mini hover' : 'mini'} style={boxStyle(false, scale)} title="Click to open Liquid Focus · drag to move · right-click for light or dark" {...dragPill}>
        <div className="mr">
          <Ring size={38} frac={phaseFrac(t)} stroke={8} />
        </div>
        <div className="tx">
          <b>
            {fmtClock(t.remaining)}
            {watching ? (
              <span
                className={det === 'absent' || det === 'away' ? 'det away' : 'det'}
                title={det === 'absent' || det === 'away' ? 'Looking away' : 'Focus detection is watching'}
              >
                <Icon name="eye" />
              </span>
            ) : null}
          </b>
          <span>{sub}</span>
        </div>
        <div className="mc" {...ownPointer}>
          <button aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume' : 'Pause'} onClick={() => (paused ? lfStart() : lfPause())}>
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
          <button
            aria-label={stopArmed ? 'Press again to stop the session' : 'Stop'}
            title={stopArmed ? 'Press again to stop the session' : 'Stop'}
            className={stopArmed ? 'armed' : undefined}
            onClick={stopTwice}
          >
            {stopArmed ? 'Stop?' : <Icon name="stop" />}
          </button>
        </div>
      </div>
    </div>
  )
}
