/**
 * Guarana in the v2 panel: keep the computer awake for a while or until
 * turned off. Free (no trial or licence screen). The logic lives in
 * services/guarana.ts; this page only shows its state and calls guarana:*.
 * The menu-bar menu has the same toggle (right-click the PeakFlow icon).
 */

import { useCallback, useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { GUARANA_DURATIONS, guaranaMinutesLeft, formatGuaranaLeft, type GuaranaState } from '@shared/guarana'
import type { PanelToolModule } from '../../types'
import { invoke, isMac, useIpcEvent, useInvoke } from '../../hooks'
import { Grp, Hero, Note, Picker, Row, TextTabs, Toggle } from '../../kit'
import { useNav } from '../../nav'

/** Short labels for the duration tabs on the main screen. */
const TAB_LABELS: Record<string, string> = { '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', null: '∞' }
const keyOf = (m: number | null): string => (m == null ? 'null' : String(m))
const minutesOf = (k: string): number | null => (k === 'null' ? null : Number(k))

const device = (): string => (isMac() ? 'Mac' : 'computer')

/* ─── shared state ───────────────────────────────────────────────────────── */

function useGuarana(): [GuaranaState | null, (s: GuaranaState) => void] {
  const [state, setState] = useState<GuaranaState | null>(null)
  const [initial] = useInvoke<GuaranaState>(IPC_INVOKE.GUARANA_GET_STATE)
  useEffect(() => {
    if (initial) setState(initial)
  }, [initial])
  useIpcEvent(IPC_SEND.GUARANA_STATE_CHANGED, (s) => setState(s as GuaranaState))
  return [state, setState]
}

/** Re-render once a second while a timed session runs, so the countdown moves. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  return now
}

function useStatus(): string {
  const [s] = useGuarana()
  const now = useNow(!!s?.active && s.endsAt != null)
  if (!s) return ''
  if (!s.active) return 'Off'
  const left = guaranaMinutesLeft(s, now)
  return left == null ? 'On' : `${formatGuaranaLeft(left)} left`
}

function useActions(set: (s: GuaranaState) => void): {
  start: (m: number | null) => void
  stop: () => void
  prefs: (p: { keepScreenOn?: boolean; defaultMinutes?: number | null }) => void
} {
  const nav = useNav()
  const run = useCallback(
    (p: Promise<GuaranaState>) => p.then((n) => n && set(n)).catch(() => nav.toast('Couldn’t change Guarana')),
    [set, nav]
  )
  return {
    start: (m) => void run(invoke<GuaranaState>(IPC_INVOKE.GUARANA_START, m)),
    stop: () => void run(invoke<GuaranaState>(IPC_INVOKE.GUARANA_STOP)),
    prefs: (p) => void run(invoke<GuaranaState>(IPC_INVOKE.GUARANA_SET_PREFS, p))
  }
}

/* ─── main screen ────────────────────────────────────────────────────────── */

function Main(): React.JSX.Element {
  const [s, set] = useGuarana()
  const { start, stop, prefs } = useActions(set)
  const now = useNow(!!s?.active && s.endsAt != null)
  if (!s) return <div style={{ height: 200 }} />

  const left = guaranaMinutesLeft(s, now)
  const title = s.active ? `Your ${device()} is staying awake` : `Your ${device()} can sleep as usual`
  const line = !s.active
    ? 'Turn on Guarana to stop it going to sleep while you’re away.'
    : left == null
      ? 'Until you turn it off.'
      : `For another ${formatGuaranaLeft(left)}${s.keepScreenOn ? '' : '. The screen can still turn off'}.`
  // The tab that's lit: the running session's length, or what Turn on will start
  const selected = keyOf(s.active ? s.minutes : s.defaultMinutes)

  return (
    <>
      <Hero icon="guarana" title={title}>{line}</Hero>
      <Grp style={{ marginTop: 14 }}>
        <Row
          label="Keep awake"
          right={<Toggle label="Keep awake" checked={s.active} onChange={(v) => (v ? start(s.defaultMinutes) : stop())} />}
        />
      </Grp>
      <TextTabs
        value={selected}
        options={GUARANA_DURATIONS.map((d) => [keyOf(d.minutes), TAB_LABELS[keyOf(d.minutes)]] as [string, string])}
        onChange={(k) => {
          const m = minutesOf(k)
          // Picking a length saves it for next time, and restarts a running session with it
          prefs({ defaultMinutes: m })
          if (s.active) start(m)
        }}
      />
      <Grp style={{ marginTop: 8 }}>
        <Row
          label="Keep the screen on"
          sub={s.keepScreenOn ? 'The screen stays lit too' : `The screen can turn off, your ${device()} keeps running`}
          right={<Toggle label="Keep the screen on" checked={s.keepScreenOn} onChange={(v) => prefs({ keepScreenOn: v })} />}
        />
      </Grp>
      <Note style={{ marginTop: 10 }}>
        {isMac() ? 'Closing a MacBook’s lid still puts it to sleep. ' : ''}
        Guarana is free. It’s also in the menu-bar menu: right-click the PeakFlow icon.
      </Note>
    </>
  )
}

/* ─── settings ───────────────────────────────────────────────────────────── */

function Settings(): React.JSX.Element {
  const [s, set] = useGuarana()
  const { prefs } = useActions(set)
  if (!s) return <div style={{ height: 160 }} />
  return (
    <>
      <Grp>
        <Row
          label="Turn on for"
          sub="What Keep awake starts with, here and in the menu bar"
          right={
            <Picker
              label="Turn on for"
              value={keyOf(s.defaultMinutes)}
              options={GUARANA_DURATIONS.map((d) => [keyOf(d.minutes), d.label] as [string, string])}
              onChange={(k) => prefs({ defaultMinutes: minutesOf(k) })}
            />
          }
        />
        <Row
          label="Keep the screen on"
          sub={`Off lets the screen turn off while your ${device()} keeps running`}
          right={<Toggle label="Keep the screen on" checked={s.keepScreenOn} onChange={(v) => prefs({ keepScreenOn: v })} />}
        />
      </Grp>
      <Note style={{ marginTop: 10 }}>
        Guarana turns itself off when PeakFlow quits, and it starts off each time PeakFlow opens.
      </Note>
    </>
  )
}

export const guaranaTool: PanelToolModule = {
  id: 'guarana',
  name: 'Guarana',
  desc: 'Keep your Mac awake',
  icon: 'guarana',
  ungated: true,
  useStatus,
  routes: {
    guarana: { kind: 'tool', tool: 'guarana', view: Main },
    'guarana/settings': { kind: 'sub', back: 'guarana', title: 'Guarana settings', view: Settings }
  }
}
