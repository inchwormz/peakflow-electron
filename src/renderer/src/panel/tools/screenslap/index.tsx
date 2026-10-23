/**
 * ScreenSlap in the v2 panel: next meeting, later today, all of today,
 * calendar connect and settings. Wired to the existing calendar:* and
 * screenslap:* IPC; behaviour is unchanged, only the UI is new.
 * Prototype routes: screenslap (+ connect, connect-error, empty, alerting,
 * syncing states), screenslap/today, screenslap/settings.
 */

import { useCallback, useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import type { ScreenSlapConfig } from '@shared/config-schemas'
import type { PanelToolModule } from '../../types'
import { invoke, useIpcEvent, useInvoke, useToolConfig } from '../../hooks'
import { AppIcon, Banner, Btn, Empty, Grp, Hero, LinkBtn, Note, NumIn, Picker, Primary, Row, Toggle, V } from '../../kit'
import { useNav } from '../../nav'
import {
  appName,
  fmtAgo,
  fmtDuration,
  fmtGap,
  fmtRange,
  isToday,
  type CalendarEvent,
  type CalendarStatus,
  type ScreenSlapState
} from './format'

/* ─── shared state ───────────────────────────────────────────────────────── */

interface SlapData {
  status: CalendarStatus | undefined
  events: CalendarEvent[]
  state: ScreenSlapState | undefined
  now: number
}

/** Re-render every `ms` so countdowns stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function useScreenSlap(): SlapData {
  const [status, , setStatus] = useInvoke<CalendarStatus>(IPC_INVOKE.CALENDAR_GET_STATUS)
  const [events, , setEvents] = useInvoke<CalendarEvent[]>(IPC_INVOKE.CALENDAR_GET_EVENTS)
  const [state, , setState] = useInvoke<ScreenSlapState>(IPC_INVOKE.SCREENSLAP_GET_STATE)
  useIpcEvent(IPC_SEND.CALENDAR_STATUS_CHANGED, (s) => setStatus(s as CalendarStatus))
  useIpcEvent(IPC_SEND.CALENDAR_EVENTS_UPDATED, (e) => setEvents((e as CalendarEvent[]) ?? []))
  useIpcEvent(IPC_SEND.SCREENSLAP_STATE_CHANGED, (s) => setState(s as ScreenSlapState))
  const now = useNow(15_000)
  return { status, events: events ?? [], state, now }
}

/** Today's events in time order, and the next one still to come (or running). */
function useToday(d: SlapData): { today: CalendarEvent[]; next: CalendarEvent | null; later: CalendarEvent[] } {
  const today = d.events
    .filter((e) => isToday(e, new Date(d.now)))
    .sort((a, b) => (a.allDay === b.allDay ? new Date(a.startTime).getTime() - new Date(b.startTime).getTime() : a.allDay ? -1 : 1))
  const timed = today.filter((e) => !e.allDay && new Date(e.endTime).getTime() > d.now)
  return { today, next: timed[0] ?? null, later: timed.slice(1) }
}

/** The link didn't load: connected, never fetched, and the fetch failed. */
const linkFailed = (s: CalendarStatus | undefined): boolean => !!s?.connected && !!s.error && !s.lastFetched

function useStatus(): string {
  const d = useScreenSlap()
  const { next } = useToday(d)
  if (!d.status) return ''
  if (!d.status.connected || linkFailed(d.status)) return 'Not connected'
  if (d.state?.activeAlert) return 'Alert on screen'
  if (!next) return 'No more meetings'
  const ms = new Date(next.startTime).getTime() - d.now
  return ms <= 0 ? 'Meeting now' : `Next in ${fmtGap(ms)}`
}

const count = (n: number): string => `${n} event${n === 1 ? '' : 's'}`
const INTERVALS: Array<[number, string]> = [
  [5, '5 min'],
  [10, '10 min'],
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 hour']
]
const CHECKS: Array<[number, string]> = [
  [15, '15 s'],
  [30, '30 s'],
  [60, '60 s']
]
const intervalLabel = (m: number): string => INTERVALS.find(([v]) => v === m)?.[1] ?? `${m} min`
const LINK_FAILED = 'That link didn’t work. Use the secret address in iCal format.'

/* ─── pieces ─────────────────────────────────────────────────────────────── */

function Ev({ e, now }: { e: CalendarEvent; now: number }): React.JSX.Element {
  const past = new Date(e.endTime).getTime() <= now
  return (
    <div className={past ? 'ev past' : 'ev'}>
      <span className="tm">{e.allDay ? 'All day' : fmtRange(e.startTime, e.endTime)}</span>
      <span className="n" title={e.summary}>{e.summary}</span>
      {e.meetingLink ? <AppIcon q={{ url: e.meetingLink }} size={16} /> : null}
      {e.allDay ? null : <span className="d">{fmtDuration(e.durationMinutes)}</span>}
    </div>
  )
}

function SyncLine({ status }: { status: CalendarStatus }): React.JSX.Element {
  const [cfg] = useToolConfig<ScreenSlapConfig>(ToolId.ScreenSlap)
  const [syncing, setSyncing] = useState(false)
  const every = cfg ? ` · every ${intervalLabel(cfg.fetch_interval_minutes)}` : ''
  const text = syncing
    ? 'Syncing…'
    : status.error
      ? 'Couldn’t sync your calendar'
      : status.lastFetched
        ? `Synced ${fmtAgo(status.lastFetched)}${every}`
        : 'Not synced yet'
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
      <span title={!syncing && status.error ? status.error : undefined}>{text}</span>
      <LinkBtn
        onClick={() => {
          if (syncing) return
          setSyncing(true)
          invoke(IPC_INVOKE.CALENDAR_FETCH_NOW)
            .catch(() => {})
            .finally(() => setSyncing(false))
        }}
      >
        Sync now
      </LinkBtn>
    </div>
  )
}

/* ─── connect ────────────────────────────────────────────────────────────── */

function Connect({ initialError, onDone }: { initialError?: string; onDone?: () => void }): React.JSX.Element {
  const nav = useNav()
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | undefined>(initialError)
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  useEffect(() => setErr(initialError), [initialError])
  const connect = (): void => {
    const v = url.trim()
    if (!v) return setErr('Paste your calendar’s iCal link first.')
    try {
      const u = new URL(v.replace(/^webcal:\/\//i, 'https://'))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
    } catch {
      return setErr('That isn’t a web link. It should start with https:// or webcal://.')
    }
    setBusy(true)
    setErr(undefined)
    invoke<CalendarStatus>(IPC_INVOKE.CALENDAR_SET_ICAL_URL, v)
      .then(async (s) => {
        if (s?.connected) {
          // Start the alert loop (it skips starting while nothing is connected)
          await invoke(IPC_INVOKE.SCREENSLAP_START).catch(() => {})
          setUrl('')
          nav.toast('Calendar connected')
          onDone?.()
        } else setErr(s?.error ?? LINK_FAILED)
      })
      .catch(() => setErr('Couldn’t connect. Try again.'))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <Hero icon="cal" title="Connect your calendar">
        ScreenSlap reads your calendar’s private iCal link and fills your screen just before each meeting.
      </Hero>
      <input
        className="text-in"
        style={{ marginTop: 16 }}
        placeholder="Paste iCal link (https:// or webcal://)"
        aria-label="iCal link"
        value={url}
        spellCheck={false}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && connect()}
      />
      {err ? <Note style={{ marginTop: 6, color: 'var(--text)' }}>{err}</Note> : null}
      <div style={{ height: 10 }} />
      <Primary onClick={connect} disabled={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </Primary>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <LinkBtn onClick={() => setHelp((h) => !h)}>Where do I find this link?</LinkBtn>
      </div>
      {help ? (
        <Note style={{ marginTop: 10 }}>
          <b>Google Calendar:</b> Settings › your calendar › Integrate calendar › Secret address in iCal format.
          <br />
          <b>Outlook:</b> Settings › Calendar › Shared calendars › Publish › ICS link.
        </Note>
      ) : null}
    </>
  )
}

/* ─── main screen ────────────────────────────────────────────────────────── */

function Main(): React.JSX.Element {
  const d = useScreenSlap()
  const { today, next, later } = useToday(d)
  const nav = useNav()
  if (!d.status) return <div style={{ height: 200 }} />
  if (!d.status.connected) return <Connect />
  if (linkFailed(d.status)) return <Connect initialError={LINK_FAILED} />

  const alert = d.state?.activeAlert
  if (alert) {
    const ms = new Date(alert.startTime).getTime() - d.now
    return (
      <>
        <Banner icon="screenslap">
          <b>Alert is on your screen</b>
          <br />
          {alert.summary} {ms < 60_000 ? 'is starting now' : `starts in ${fmtGap(ms)}`}
        </Banner>
        <div style={{ height: 12 }} />
        <Btn block onClick={() => invoke(IPC_INVOKE.SCREENSLAP_DISMISS).catch(() => {})}>
          Dismiss alert
        </Btn>
      </>
    )
  }

  const allRow = today.length ? (
    <Grp style={{ marginTop: 6 }}>
      <Row label="All of today" value={count(today.length)} go="screenslap/today" />
    </Grp>
  ) : null

  if (!next) {
    return (
      <>
        <Empty icon="cal" title="No more meetings today">ScreenSlap is watching your calendar.</Empty>
        {allRow}
        <SyncLine status={d.status} />
      </>
    )
  }

  const ms = new Date(next.startTime).getTime() - d.now
  const name = appName(next.meetingService)
  return (
    <>
      <div className="next">
        <div className="when">
          {ms > 0 ? (
            <>
              Next · <b>in {fmtGap(ms)}</b>
            </>
          ) : (
            <>
              Now · <b>started {fmtGap(-ms)} ago</b>
            </>
          )}
        </div>
        <h3>{next.summary}</h3>
        <div className="meta">
          {next.meetingLink ? <AppIcon q={{ url: next.meetingLink }} size={14} /> : null}
          <span>
            {next.meetingService ? `${name} · ` : ''}
            {fmtRange(next.startTime, next.endTime)}
          </span>
        </div>
        {next.meetingLink ? (
          <Primary
            onClick={() => {
              invoke(IPC_INVOKE.SCREENSLAP_JOIN_MEETING, next.meetingLink).catch(() => {})
              nav.hide()
            }}
          >
            Join {name}
          </Primary>
        ) : null}
      </div>
      {later.length ? (
        <>
          <Note style={{ margin: '16px 0 2px' }}>Later today</Note>
          <Grp>
            {later.map((e) => (
              <Ev key={e.id} e={e} now={d.now} />
            ))}
          </Grp>
        </>
      ) : null}
      {allRow}
      <SyncLine status={d.status} />
    </>
  )
}

/* ─── today ──────────────────────────────────────────────────────────────── */

function Today(): React.JSX.Element {
  const d = useScreenSlap()
  const { today } = useToday(d)
  if (!d.status) return <div style={{ height: 120 }} />
  if (!today.length) return <Empty icon="cal" title="Nothing scheduled today">Enjoy the quiet.</Empty>
  return (
    <Grp>
      {today.map((e) => (
        <Ev key={e.id} e={e} now={d.now} />
      ))}
    </Grp>
  )
}

function TodayCount(): React.JSX.Element {
  const d = useScreenSlap()
  const { today } = useToday(d)
  return <V>{d.status ? count(today.length) : ''}</V>
}

/* ─── connect page (from settings) ───────────────────────────────────────── */

function ConnectPage(): React.JSX.Element {
  const nav = useNav()
  return <Connect onDone={() => nav.go('screenslap')} />
}

/* ─── settings ───────────────────────────────────────────────────────────── */

interface DisplayInfo {
  id: number
  label: string
}

function Settings(): React.JSX.Element {
  const nav = useNav()
  const [cfg, set] = useToolConfig<ScreenSlapConfig>(ToolId.ScreenSlap)
  const [status, , setStatus] = useInvoke<CalendarStatus>(IPC_INVOKE.CALENDAR_GET_STATUS)
  useIpcEvent(IPC_SEND.CALENDAR_STATUS_CHANGED, (s) => setStatus(s as CalendarStatus))
  // Same list, in screen.getAllDisplays() order, that monitor_index indexes
  const [displays] = useInvoke<DisplayInfo[]>(IPC_INVOKE.FOCUSDIM_GET_DISPLAYS)
  const disconnect = useCallback(() => {
    invoke<CalendarStatus>(IPC_INVOKE.CALENDAR_DISCONNECT)
      .then((s) => {
        if (s) setStatus(s)
        // Stop the alert loop too, so connecting again restarts calendar polling
        return invoke(IPC_INVOKE.SCREENSLAP_STOP)
      })
      .then(() => nav.toast('Calendar disconnected'))
      .catch(() => {})
  }, [nav, setStatus])
  if (!cfg || !status) return <div style={{ height: 300 }} />

  const displayOpts: Array<[number, string]> = [[-1, 'All displays'], ...(displays ?? []).map((d, i): [number, string] => [i, d.label])]
  const monitor = displayOpts.some(([v]) => v === cfg.monitor_index) ? cfg.monitor_index : -1
  const connected = status.connected && !linkFailed(status)
  return (
    <>
      <Grp>
        <Row label="Alert me" right={<NumIn label="Minutes before" value={cfg.alert_minutes_before} min={1} max={30} unit="min before" onCommit={(v) => set('alert_minutes_before', v)} />} />
        <Row label="Alert closes after" right={<NumIn label="Seconds" value={cfg.alert_duration_seconds} min={10} max={300} unit="s" onCommit={(v) => set('alert_duration_seconds', v)} />} />
        <Row label="Play a sound" right={<Toggle label="Play a sound" checked={cfg.alert_sound} onChange={(v) => set('alert_sound', v)} />} />
        <Row label="Show the alert on" right={<Picker label="Show the alert on" value={monitor} options={displayOpts} onChange={(v) => set('monitor_index', v)} />} />
      </Grp>
      <Grp>
        <Row label="Sync calendar every" right={<Picker label="Sync calendar every" value={cfg.fetch_interval_minutes} options={INTERVALS} onChange={(v) => set('fetch_interval_minutes', v)} />} />
        <Row label="Check for alerts every" right={<Picker label="Check for alerts every" value={cfg.alert_check_seconds} options={CHECKS} onChange={(v) => set('alert_check_seconds', v)} />} />
      </Grp>
      <Grp>
        {connected ? (
          <Row label="Calendar feed" sub="Connected · iCal link" right={<Btn sm onClick={disconnect}>Disconnect</Btn>} />
        ) : (
          <Row label="Calendar feed" value="Not connected" go="screenslap/connect" />
        )}
      </Grp>
      <Grp>
        <Row
          label="Send a test alert"
          onClick={() => {
            invoke(IPC_INVOKE.SCREENSLAP_TEST_ALERT).catch(() => {})
            nav.hide()
          }}
        />
      </Grp>
    </>
  )
}

export const screenslapTool: PanelToolModule = {
  id: 'screenslap',
  name: 'ScreenSlap',
  desc: 'Full-screen alerts before meetings',
  icon: 'screenslap',
  useStatus,
  routes: {
    screenslap: { kind: 'tool', tool: 'screenslap', view: Main },
    'screenslap/today': { kind: 'sub', back: 'screenslap', title: 'Today', view: Today, right: TodayCount },
    'screenslap/connect': { kind: 'sub', back: 'screenslap/settings', title: 'Calendar feed', view: ConnectPage },
    'screenslap/settings': { kind: 'sub', back: 'screenslap', title: 'ScreenSlap settings', view: Settings }
  }
}
