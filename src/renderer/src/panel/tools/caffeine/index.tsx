/**
 * Caffeine in the v2 panel: keep the computer awake for a while or until
 * turned off. Free (no trial or licence screen). The logic lives in
 * services/caffeine.ts; this page only shows its state and calls caffeine:*.
 * The menu-bar menu has the same toggle (right-click the PeakFlow icon).
 */

import { useCallback, useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { CAFFEINE_DURATIONS, caffeineMinutesLeft, formatCaffeineLeft, type CaffeineState } from '@shared/caffeine'
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

function useCaffeine(): [CaffeineState | null, (s: CaffeineState) => void] {
  const [state, setState] = useState<CaffeineState | null>(null)
  const [initial] = useInvoke<CaffeineState>(IPC_INVOKE.CAFFEINE_GET_STATE)
  useEffect(() => {
    if (initial) setState(initial)
  }, [initial])
  useIpcEvent(IPC_SEND.CAFFEINE_STATE_CHANGED, (s) => setState(s as CaffeineState))
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
  const [s] = useCaffeine()
  const now = useNow(!!s?.active && s.endsAt != null)
  if (!s) return ''
  if (!s.active) return 'Off'
  const left = caffeineMinutesLeft(s, now)
  return left == null ? 'On' : `${formatCaffeineLeft(left)} left`
}

function useActions(set: (s: CaffeineState) => void): {
  start: (m: number | null) => void
  stop: () => void
  prefs: (p: { keepScreenOn?: boolean; defaultMinutes?: number | null }) => void
} {
  const nav = useNav()
  const run = useCallback(
    (p: Promise<CaffeineState>) => p.then((n) => n && set(n)).catch(() => nav.toast('Couldn’t change Caffeine')),
    [set, nav]
  )
  return {
    start: (m) => void run(invoke<CaffeineState>(IPC_INVOKE.CAFFEINE_START, m)),
    stop: () => void run(invoke<CaffeineState>(IPC_INVOKE.CAFFEINE_STOP)),
    prefs: (p) => void run(invoke<CaffeineState>(IPC_INVOKE.CAFFEINE_SET_PREFS, p))
  }
}

/* ─── main screen ────────────────────────────────────────────────────────── */

function Main(): React.JSX.Element {
  const [s, set] = useCaffeine()
  const { start, stop, prefs } = useActions(set)
  const now = useNow(!!s?.active && s.endsAt != null)
  if (!s) return <div style={{ height: 200 }} />

  const left = caffeineMinutesLeft(s, now)
  const title = s.active ? `Your ${device()} is staying awake` : `Your ${device()} can sleep as usual`
  const line = !s.active
    ? 'Turn on Caffeine to stop it going to sleep while you’re away.'
    : left == null
      ? 'Until you turn it off.'
      : `For another ${formatCaffeineLeft(left)}${s.keepScreenOn ? '' : '. The screen can still turn off'}.`
  // The tab that's lit: the running session's length, or what Turn on will start
  const selected = keyOf(s.active ? s.minutes : s.defaultMinutes)

  return (
    <>
      <Hero icon="coffee" title={title}>{line}</Hero>
      <Grp style={{ marginTop: 14 }}>
        <Row
          label="Keep awake"
          right={<Toggle label="Keep awake" checked={s.active} onChange={(v) => (v ? start(s.defaultMinutes) : stop())} />}
        />
      </Grp>
      <TextTabs
        value={selected}
        options={CAFFEINE_DURATIONS.map((d) => [keyOf(d.minutes), TAB_LABELS[keyOf(d.minutes)]] as [string, string])}
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
        Caffeine is free. It’s also in the menu-bar menu: right-click the PeakFlow icon.
      </Note>
    </>
  )
}

/* ─── settings ───────────────────────────────────────────────────────────── */

function Settings(): React.JSX.Element {
  const [s, set] = useCaffeine()
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
              options={CAFFEINE_DURATIONS.map((d) => [keyOf(d.minutes), d.label] as [string, string])}
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
        Caffeine turns itself off when PeakFlow quits, and it starts off each time PeakFlow opens.
      </Note>
    </>
  )
}

export const caffeineTool: PanelToolModule = {
  id: 'caffeine',
  name: 'Caffeine',
  desc: 'Keep your Mac awake',
  icon: 'coffee',
  ungated: true,
  useStatus,
  routes: {
    caffeine: { kind: 'tool', tool: 'caffeine', view: Main },
    'caffeine/settings': { kind: 'sub', back: 'caffeine', title: 'Caffeine settings', view: Settings }
  }
}
