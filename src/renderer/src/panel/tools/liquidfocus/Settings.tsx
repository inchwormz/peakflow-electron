/**
 * Liquid Focus settings: durations, sounds and focus detection, blocked
 * sites (config.distraction_sites, read by the PeakFlow Focus Chrome
 * extension) and Todoist. Settings persist through CONFIG_SET.
 */

import { useEffect, useState } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import { ToolId, TODOIST_ENABLED } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'
import { invoke, useInvoke, useToolConfig } from '../../hooks'
import { Banner, Btn, Gap, Grp, Hero, LinkBtn, Note, NumIn, Picker, Primary, Row, Toggle } from '../../kit'
import { Icon } from '../../icons'
import { useNav } from '../../nav'
import { useDetector } from './store'

type Cfg = LiquidFocusConfig
const useCfg = (): ReturnType<typeof useToolConfig<Cfg>> => useToolConfig<Cfg>(ToolId.LiquidFocus)

interface TodoistStatus {
  connected: boolean
  error: string | null
}
interface TodoistProject {
  id: string
  name: string
}

/* ─── settings home ──────────────────────────────────────────────────────── */

// Todoist is out of scope for v2 (TODOIST_ENABLED); its status isn't asked for while off
const useTodoistStatus = TODOIST_ENABLED
  ? (): TodoistStatus | undefined => useInvoke<TodoistStatus>(IPC_INVOKE.TODOIST_GET_STATUS)[0]
  : (): TodoistStatus | undefined => undefined

export function Settings(): React.JSX.Element {
  const [cfg] = useCfg()
  const todo = useTodoistStatus()
  if (!cfg) return <div style={{ height: 180 }} />
  const n = cfg.distraction_sites?.length ?? 0
  return (
    <Grp>
      <Row label="Durations" value={`${cfg.work_duration} / ${cfg.break_duration} / ${cfg.long_break_duration} min`} go="liquidfocus/settings/durations" />
      <Row label="Sounds and auto-start" go="liquidfocus/settings/behaviour" />
      <Row label="Focus detection" value={cfg.focus_detection_enabled ? 'On' : 'Off'} go="liquidfocus/settings/behaviour" />
      <Row label="Blocked sites" value={`${n} ${n === 1 ? 'site' : 'sites'}`} go="liquidfocus/settings/sites" />
      {TODOIST_ENABLED ? (
        <Row label="Todoist" value={todo ? (todo.connected ? 'Connected' : 'Not connected') : ''} go="liquidfocus/settings/todoist" />
      ) : null}
    </Grp>
  )
}

/* ─── durations ──────────────────────────────────────────────────────────── */

export function Durations(): React.JSX.Element {
  const [cfg, set] = useCfg()
  if (!cfg) return <div style={{ height: 180 }} />
  return (
    <>
      <Grp>
        <Row label="Focus session" right={<NumIn label="Focus session" value={cfg.work_duration} min={1} max={180} unit="min" onCommit={(v) => set('work_duration', v)} />} />
        <Row label="Short break" right={<NumIn label="Short break" value={cfg.break_duration} min={1} max={60} unit="min" onCommit={(v) => set('break_duration', v)} />} />
        <Row label="Long break" right={<NumIn label="Long break" value={cfg.long_break_duration} min={1} max={120} unit="min" onCommit={(v) => set('long_break_duration', v)} />} />
        <Row
          label="Long break after"
          right={<NumIn label="Long break after" value={cfg.sessions_before_long} min={1} max={12} unit="sessions" onCommit={(v) => set('sessions_before_long', v)} />}
        />
      </Grp>
      <Note style={{ marginTop: 10 }}>Changes apply the next time the timer is stopped.</Note>
    </>
  )
}

/* ─── sounds and detection ───────────────────────────────────────────────── */

function useCameraDenied(): boolean {
  const det = useDetector()
  const [hasCamera, setHasCamera] = useState(false)
  useEffect(() => {
    if (!det.noCamera) return
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setHasCamera(d.some((x) => x.kind === 'videoinput')))
      .catch(() => {})
  }, [det.noCamera])
  // "No camera" with a camera attached means access was refused
  return det.noCamera && hasCamera
}

export function Behaviour(): React.JSX.Element {
  const [cfg, set] = useCfg()
  const denied = useCameraDenied()
  if (!cfg) return <div style={{ height: 180 }} />
  return (
    <>
      {denied && cfg.focus_detection_enabled ? (
        <Banner icon="camera" style={{ marginBottom: 12 }}>
          <b>Camera access is off</b>
          <br />
          Turn it on in System Settings to use focus detection.
        </Banner>
      ) : null}
      <Grp>
        <Row label="Sound when a session ends" right={<Toggle label="Sound when a session ends" checked={cfg.alert_sound} onChange={(v) => set('alert_sound', v)} />} />
        <Row
          label="Start the next session automatically"
          right={<Toggle label="Start the next session automatically" checked={cfg.auto_start_breaks} onChange={(v) => set('auto_start_breaks', v)} />}
        />
      </Grp>
      <Grp>
        <Row
          label="Focus detection"
          sub="Uses your camera to notice when you look away"
          right={<Toggle label="Focus detection" checked={cfg.focus_detection_enabled} onChange={(v) => set('focus_detection_enabled', v)} />}
        />
        {cfg.focus_detection_enabled ? (
          <Row
            label="Count as away after"
            right={<NumIn label="Count as away after" value={cfg.focus_away_threshold_secs} min={1} max={120} unit="s" onCommit={(v) => set('focus_away_threshold_secs', v)} />}
          />
        ) : null}
      </Grp>
      <Note style={{ marginTop: 10 }}>Runs on your Mac. No video is stored or sent anywhere.</Note>
    </>
  )
}

/* ─── blocked sites ──────────────────────────────────────────────────────── */

/** Suggestions (the old site list plus the defaults) so a site switched off stays in the list. */
const KNOWN_SITES = [
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'tiktok.com',
  'netflix.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'twitch.tv',
  'pinterest.com',
  'amazon.com',
  'discord.com'
]

function cleanSite(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]
  return s.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null
}

export function Sites(): React.JSX.Element {
  const nav = useNav()
  const [cfg, set] = useCfg()
  const [text, setText] = useState('')
  // Sites added or switched off on this visit stay visible until you leave
  const [seen, setSeen] = useState<string[]>([])
  if (!cfg) return <div style={{ height: 180 }} />
  const blocked = cfg.distraction_sites ?? []
  const list = [...new Set([...blocked, ...KNOWN_SITES, ...seen])]
  const toggle = (site: string, on: boolean): void => {
    if (!seen.includes(site)) setSeen((s) => [...s, site])
    set('distraction_sites', on ? [...new Set([...blocked, site])] : blocked.filter((x) => x !== site))
  }
  const add = (): void => {
    const site = cleanSite(text)
    if (!site) {
      nav.toast('Type a site, e.g. news.ycombinator.com')
      return
    }
    toggle(site, true)
    setText('')
  }
  return (
    <>
      <Banner style={{ marginBottom: 12 }} action={<LinkBtn onClick={() => nav.go('app/extension')}>Get it</LinkBtn>}>
        Blocking needs the <b>PeakFlow Focus</b> extension for Chrome.
      </Banner>
      <Grp>
        {list.map((s) => (
          <Row key={s} label={s} right={<Toggle label={s} checked={blocked.includes(s)} onChange={(v) => toggle(s, v)} />} />
        ))}
      </Grp>
      <div className="field-wrap" style={{ marginTop: 10 }}>
        <Icon name="plus" />
        <input
          className="field"
          placeholder="Add a site, e.g. news.ycombinator.com"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
      </div>
    </>
  )
}

/* ─── Todoist ────────────────────────────────────────────────────────────── */

type Phase = 'idle' | 'connecting' | 'error'

export function Todoist(): React.JSX.Element {
  const nav = useNav()
  const [cfg, set] = useCfg()
  const [status, reload, setStatus] = useInvoke<TodoistStatus>(IPC_INVOKE.TODOIST_GET_STATUS)
  const [projects, setProjects] = useState<TodoistProject[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const connected = !!status?.connected

  useEffect(() => {
    if (!connected) return
    invoke<TodoistProject[]>(IPC_INVOKE.TODOIST_GET_PROJECTS)
      .then((p) => setProjects(Array.isArray(p) ? p : []))
      .catch(() => {})
  }, [connected])

  const connect = async (): Promise<void> => {
    setPhase('connecting')
    try {
      const r = await invoke<TodoistStatus>(IPC_INVOKE.TODOIST_AUTHENTICATE)
      setStatus(r)
      if (r.connected) {
        setPhase('idle')
        nav.toast('Todoist connected')
      } else if (r.error === 'Window closed before auth completed' || r.error === 'Authentication already in progress') {
        setPhase((p) => (p === 'connecting' ? 'idle' : p))
      } else setPhase('error')
    } catch {
      setPhase('error')
    }
  }

  const disconnect = async (): Promise<void> => {
    const r = await invoke<TodoistStatus>(IPC_INVOKE.TODOIST_DISCONNECT).catch(() => null)
    if (r) setStatus(r)
    else reload()
    setProjects([])
    set('todoist_project_filter', '')
  }

  if (phase === 'connecting') {
    return (
      <>
        <Hero icon="refresh" title="Connecting…">
          Finish signing in to Todoist in the window that opened.
        </Hero>
        <Gap />
        <Btn block onClick={() => setPhase('idle')}>
          Cancel
        </Btn>
      </>
    )
  }
  if (phase === 'error') {
    return (
      <>
        <Hero icon="info" title="Couldn’t connect to Todoist">
          Authentication failed. Try again, and allow PeakFlow when Todoist asks.
        </Hero>
        <Gap />
        <Primary onClick={connect}>Try again</Primary>
      </>
    )
  }
  if (!status) return <div style={{ height: 180 }} />
  if (!connected) {
    return (
      <>
        <Hero icon="check" title="Connect Todoist">
          Bring your Todoist tasks into Liquid Focus. Tasks you finish here are ticked off there too.
        </Hero>
        {status.error ? <Note style={{ textAlign: 'center', marginTop: 4 }}>{status.error}</Note> : null}
        <Gap />
        <Primary onClick={connect}>Connect Todoist</Primary>
      </>
    )
  }
  const filter = cfg?.todoist_project_filter ?? ''
  const options: Array<[string, string]> = [['', 'All projects'], ...projects.map((p): [string, string] => [p.id, p.name])]
  if (filter && !projects.some((p) => p.id === filter)) options.push([filter, 'Saved project'])
  return (
    <>
      <Grp>
        <Row
          label="Todoist"
          sub="Connected"
          icon="check"
          right={
            <Btn sm onClick={disconnect}>
              Disconnect
            </Btn>
          }
        />
        <Row
          label="Import tasks from"
          right={<Picker label="Import tasks from" value={filter} options={options} onChange={(v) => set('todoist_project_filter', v)} />}
        />
      </Grp>
      <Note style={{ marginTop: 10 }}>Finishing a Todoist task here also finishes it in Todoist.</Note>
    </>
  )
}
