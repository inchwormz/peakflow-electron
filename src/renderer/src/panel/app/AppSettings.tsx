/**
 * PeakFlow-wide settings, opened from the bottom of the switcher:
 * plan and trial, licence key, tools, keyboard shortcuts, launch at login,
 * updates, the Chrome extension, Share & Earn, help and Quit.
 *
 * v2 trial (John, 19 Oct 2026): one 30-day trial for every tool, starting
 * by itself on first launch (security/trial.ts). These pages show it and
 * call the existing licence activation; there is no "start trial" step.
 * Prototype routes: app, app/licence, app/licence-key, app/tools,
 * app/hotkeys, app/updates, app/extension, app/share, app/help.
 */

import { useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { EXTENSION_ENABLED } from '@shared/tool-ids'
import type { AccessStatus, LicenseActivationResult } from '@shared/ipc-types'
import type { LauncherSettings } from '@shared/launcher/types'
import type { PanelToolId, RouteTable } from '../types'
import { invoke, isMac, useInvoke, useIpcEvent, formatAccelerator, builtInKey, ALTGR_NOTE } from '../hooks'
import type { MacPermission, PermissionStatus } from '@shared/mac-permissions'
import type { UpdateProgress } from '@shared/update-offer'
import { GuideSteps, PermissionGuide, openPermission } from '../permission'
import { AFTER_UPDATE_TITLE, guideView } from '@shared/mac-permissions'
import { SWITCH_ACCELS as SWITCH } from '@shared/global-keys'
import { Banner, Btn, Grp, Hero, Gap, Note, Primary, Rec, Row, Toggle, V, openExternal } from '../kit'
import { Icon } from '../icons'
import { useNav } from '../nav'
import { TOOL_MODULES } from '../tools'

const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'
const SITE_URL = 'https://getpeakflow.pro'
const SUPPORT_MAIL = 'mailto:contact@getpeakflow.pro?subject=PeakFlow%20help'
/* Same share links as the current Share & Earn screen (components/sharing/ShareAndEarn.tsx). */
const SHARE_LINKS: Array<[string, string]> = [
  ['Post on X', 'https://twitter.com/intent/tweet?text=I%27ve%20been%20using%20FocusDim%20from%20%40PeakFlow%20to%20dim%20everything%20except%20my%20active%20window.%20Actually%20helps%20me%20focus.%20Free%20trial%2C%20no%20sign-up%3A%20getpeakflow.pro&url=https%3A%2F%2Fgetpeakflow.pro'],
  ['Post on LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fgetpeakflow.pro'],
  ['Post on Reddit', 'https://reddit.com/submit?url=https%3A%2F%2Fgetpeakflow.pro&title=PeakFlow%20%E2%80%94%20Windows%20productivity%20suite%20with%20tools%20I%20haven%27t%20seen%20elsewhere']
]
const SHARE_MAIL = 'mailto:contact@getpeakflow.pro?subject=PeakFlow%20Share%20%26%20Earn&body=Hi!%20I%20shared%20PeakFlow%20on%20%5Bplatform%5D.%20I%27d%20like%20%5Btool%20name%5D%20for%20free.%20Screenshot%20attached.'

interface AppInfo {
  version: string
  platform: string
  arch: string
  isDev: boolean
}

function planText(a: AccessStatus | undefined): string {
  if (!a) return ''
  if (a.isLicensed) return a.isSuiteLicense ? 'Pro' : 'Licensed'
  if (!a.allowed) return 'Trial ended'
  return `Trial: ${a.daysRemaining} ${a.daysRemaining === 1 ? 'day' : 'days'} left`
}

const Ext = (): React.JSX.Element => <Icon name="ext" className="go" />

/**
 * Plan choices: John's v2 prices (19 Oct 2026): Pro $2.99 a month, own one
 * tool $9.99, all four $29.99. No annual price yet (still open), so none shown.
 *
 * TODO(pricing): the Lemon Squeezy products for these v2 prices don't exist
 * yet. Until they do, every option opens the existing pricing page
 * (CHECKOUT_URL); point each button at its own checkout and add the new
 * product IDs to product-map.json once the products are created.
 */
export function PlanOptions({ toolName }: { toolName?: string }): React.JSX.Element {
  const open = (): void => openExternal(CHECKOUT_URL)
  return (
    <>
      <div className="plans">
        <button className="plan-opt" onClick={open}>
          <span className="pt">Pro</span>
          <span className="pp">$2.99<small> / month</small></span>
          <span className="pd">{isMac() ? 'Every tool, on two Macs' : 'Every tool, on two PCs'}</span>
        </button>
        <button className="plan-opt" onClick={open}>
          <span className="pt">Own it</span>
          <span className="pp">$9.99<small> once</small></span>
          <span className="pd">{toolName ? `${toolName}, yours to keep` : 'One tool, yours to keep'}</span>
        </button>
      </div>
      <button className="plan-more" onClick={open}>
        <span>Own every tool</span>
        <span className="pp">$29.99 once</span>
      </button>
    </>
  )
}

/* ─── app ────────────────────────────────────────────────────────────────── */

function Home(): React.JSX.Element {
  const [access] = useInvoke<AccessStatus>(IPC_INVOKE.SECURITY_CHECK_ACCESS)
  const [autoStart, , setAutoStart] = useInvoke<boolean>(IPC_INVOKE.APP_GET_AUTO_START)
  const [info] = useInvoke<AppInfo>(IPC_INVOKE.APP_GET_INFO)
  return (
    <>
      <Grp>
        <Row label="Plan" icon="key" value={planText(access)} go="app/licence" />
        <Row label="Tools" icon="focusdim" go="app/tools" />
        <Row label="Keyboard shortcuts" icon="keyboard" go="app/hotkeys" />
      </Grp>
      <Grp>
        <Row
          label="Launch at login"
          icon="power"
          sub={info?.isDev ? 'Not available in a test build' : undefined}
          right={
            <Toggle
              label="Launch at login"
              checked={!!autoStart}
              disabled={info?.isDev}
              onChange={() => invoke<boolean>(IPC_INVOKE.APP_SET_AUTO_START, !autoStart).then((v) => setAutoStart(!!v)).catch(() => {})}
            />
          }
        />
        <Row label="Updates" icon="refresh" value={info ? `v${info.version}` : ''} go="app/updates" />
        {isMac() ? <Row label="Set up on this Mac" icon="shield" go="app/setup" /> : null}
      </Grp>
      <Grp>
        {EXTENSION_ENABLED ? <Row label="Chrome extension" icon="puzzle" go="app/extension" /> : null}
        <Row label="Share & Earn" icon="gift" value="Get a tool free" go="app/share" />
        <Row label="Help and bug reports" icon="bug" go="app/help" />
      </Grp>
      <Grp>
        <Row label="Quit PeakFlow" icon="x" value="⌘Q" onClick={() => invoke(IPC_INVOKE.APP_QUIT).catch(() => {})} />
      </Grp>
    </>
  )
}

/* ─── plan and licence ───────────────────────────────────────────────────── */

function Licence(): React.JSX.Element {
  const [access] = useInvoke<AccessStatus>(IPC_INVOKE.SECURITY_CHECK_ACCESS)
  const [trial] = useInvoke<{ daysRemaining: number; trialDays: number }>(IPC_INVOKE.SECURITY_GET_TRIAL_STATUS)
  if (!access || !trial) return <div style={{ height: 160 }} />
  if (access.isLicensed) {
    return (
      <>
        <Hero icon="key" title={access.isSuiteLicense ? 'PeakFlow Pro' : 'Licensed'}>
          {access.isSuiteLicense ? 'Every tool is unlocked on this Mac.' : 'Your licence covers the tools you bought.'}
        </Hero>
        <Gap />
        <Grp>
          <Row label="Manage your purchase" right={<Ext />} onClick={() => openExternal(SITE_URL)} />
          <Row label="Enter another licence key" go="app/licence-key" />
        </Grp>
      </>
    )
  }
  if (!access.allowed) {
    return (
      <>
        <Hero icon="clock" title="Your trial has ended">Your settings are safe. Pick a plan to keep using PeakFlow.</Hero>
        <Gap />
        <PlanOptions />
        <Grp style={{ marginTop: 14 }}>
          <Row label="Enter a licence key" go="app/licence-key" />
        </Grp>
      </>
    )
  }
  const left = Math.max(0, trial.daysRemaining)
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Trial</div>
      <Note style={{ margin: '2px 0 10px' }}>
        {left} of {trial.trialDays} days left · started when you first opened PeakFlow
      </Note>
      <div className="bar">
        <i style={{ width: `${Math.min(100, (left / Math.max(1, trial.trialDays)) * 100)}%` }} />
      </div>
      <Gap h={16} />
      <PlanOptions />
      <Grp style={{ marginTop: 14 }}>
        <Row label="Enter a licence key" go="app/licence-key" />
      </Grp>
    </>
  )
}

function LicenceKey(): React.JSX.Element {
  const nav = useNav()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LicenseActivationResult | null>(null)
  const activate = (): void => {
    if (!key.trim() || busy) return
    setBusy(true)
    setResult(null)
    invoke<LicenseActivationResult>(IPC_INVOKE.SECURITY_ACTIVATE_LICENSE, key.trim())
      .then((r) => {
        setResult(r)
        if (r.success) nav.toast('Activated')
      })
      .catch(() => setResult({ success: false, message: 'Couldn’t reach the licence server. Check your connection.' }))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <input
        className="text-in"
        placeholder="PF-XXXX-XXXX-XXXX"
        aria-label="Licence key"
        value={key}
        autoFocus
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && activate()}
      />
      {result ? (
        <Note style={{ marginTop: 6, color: 'var(--text)' }}>
          {result.success ? (
            <>
              <Icon name="check" style={{ width: 12, height: 12, verticalAlign: -2 }} /> {result.message || 'Activated.'}
            </>
          ) : (
            result.message || 'That key isn’t valid. Check for typos, or find it in your receipt email.'
          )}
        </Note>
      ) : null}
      <Gap h={10} />
      <Primary onClick={activate} disabled={busy || !key.trim()}>
        {busy ? 'Checking…' : 'Activate'}
      </Primary>
      <Note style={{ marginTop: 10 }}>Your key is in the email from PeakFlow after you buy.</Note>
    </>
  )
}

/* ─── tools ──────────────────────────────────────────────────────────────── */

function ToolRow({ id }: { id: PanelToolId }): React.JSX.Element {
  const m = TOOL_MODULES.find((t) => t.id === id)!
  const [state] = useInvoke<{ installed: boolean; daysRemaining: number }>(IPC_INVOKE.TOOL_GET_INSTALL_STATE, id)
  return (
    <Row
      label={m.name}
      sub={m.desc}
      icon={m.icon}
      right={
        // Every tool is on from first launch (one shared 30-day trial): no Turn on button
        state === undefined ? null : <V>{state.installed ? 'On' : 'Starting…'}</V>
      }
    />
  )
}

function Tools(): React.JSX.Element {
  return (
    <>
      <Grp>
        {TOOL_MODULES.map((m) => (
          <ToolRow key={m.id} id={m.id} />
        ))}
      </Grp>
      <Note style={{ marginTop: 10 }}>Turning a tool on starts it and its shortcut straight away.</Note>
    </>
  )
}

/* ─── keyboard shortcuts ─────────────────────────────────────────────────── */

function Hotkeys(): React.JSX.Element {
  const [registered] = useInvoke<Array<{ accelerator: string; label: string }>>(IPC_INVOKE.HOTKEY_GET_REGISTERED)
  const has = (accel: string): boolean => !registered || registered.some((r) => r.accelerator.toLowerCase() === accel.toLowerCase())
  const taken = (accel: string): string | undefined => (has(accel) ? undefined : 'Not active: another app may use it')
  // The launcher keeps its own shortcut (changed from the launcher's settings)
  const [launcher] = useInvoke<LauncherSettings>(IPC_INVOKE.LAUNCHER_SETTINGS)
  return (
    <>
      <Note style={{ marginBottom: 2 }}>PeakFlow</Note>
      <Grp>
        {TOOL_MODULES.map((m, i) => (
          builtInKey(SWITCH[i]) ? (
            <Row key={m.id} label={`Open ${m.name}`} sub={taken(SWITCH[i])} right={<Rec value={SWITCH[i]} />} />
          ) : (
            <Row key={m.id} label={`Open ${m.name}`} value="No shortcut" />
          )
        ))}
        {launcher && (
          <Row
            label="Open the launcher"
            sub={launcher.hotkeyRegistered ? undefined : 'Not active: another app may use it'}
            right={<Rec value={launcher.hotkey} />}
          />
        )}
      </Grp>
      <Note style={{ margin: '14px 0 2px' }}>Tools</Note>
      <Grp>
        <Row label="FocusDim on or off" go="focusdim/shortcuts" />
        <Row label="FocusDim brighter / darker" value={`${formatAccelerator('Control+Alt+Up')} ${formatAccelerator('Control+Alt+Down')}`} />
        {builtInKey('Control+Alt+`') ? <Row label="FocusDim peek" right={<Rec value="Control+Alt+`" />} /> : null}
        <Row label="Open QuickBoard" right={<Rec value="CommandOrControl+Shift+V" />} />
        <Row
          label="Paste next / cancel"
          sub="Only while you paste a list. The rest of the time other apps keep these keys."
          value={`${formatAccelerator('CommandOrControl+Shift+N')} ${formatAccelerator('CommandOrControl+Shift+Q')}`}
        />
        <Row label="SnapGrid layouts" go="snapgrid/shortcuts" />
      </Grp>
      <Note style={{ marginTop: 10 }}>
        FocusDim’s on/off shortcut can be changed in its settings. The others are fixed for now.
        {isMac() ? null : <> {ALTGR_NOTE}</>}
      </Note>
    </>
  )
}

/* ─── updates ────────────────────────────────────────────────────────────── */

/** Mac download progress and errors (review S12); Windows downloads in the background as before. */
function UpdateProgressView(): React.JSX.Element | null {
  const [initial] = useInvoke<UpdateProgress>(IPC_INVOKE.APP_UPDATE_STATUS)
  const [live, setLive] = useState<UpdateProgress | null>(null)
  useIpcEvent(IPC_SEND.APP_UPDATE_PROGRESS, (p) => setLive(p as UpdateProgress))
  const p = live ?? initial
  if (!p || p.state === 'idle') return null
  const v = p.version ? ` ${p.version}` : ''
  if (p.state === 'error') {
    return (
      <Banner icon="info" style={{ marginBottom: 12 }}>
        <b>The download of PeakFlow{v} stopped</b>
        <br />
        {p.message ? `${p.message}. ` : ''}Check your connection and try again, or download it from getpeakflow.pro.
      </Banner>
    )
  }
  if (p.state === 'downloaded') {
    return (
      <>
        <Note style={{ marginBottom: 12, color: 'var(--text)' }}>PeakFlow{v} has downloaded. Follow the steps in the window that opened.</Note>
        <AfterUpdate />
      </>
    )
  }
  const pct = typeof p.percent === 'number' ? p.percent : null
  return (
    <div style={{ marginBottom: 12 }}>
      <Note style={{ margin: '0 0 6px', color: 'var(--text)' }}>Downloading PeakFlow{v}{pct !== null ? `: ${pct}%` : '…'}</Note>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <i style={{ width: `${pct ?? 5}%` }} />
      </div>
      <Gap h={14} />
      <AfterUpdate />
    </div>
  )
}

/**
 * On a Mac, while an update downloads or waits to be installed: the
 * Accessibility steps, before macOS forgets PeakFlow (John, 24 Oct 2026).
 */
function AfterUpdate(): React.JSX.Element | null {
  if (!isMac()) return null
  return (
    <div className="pg" style={{ marginBottom: 14 }}>
      <div className="pg-head">{AFTER_UPDATE_TITLE}</div>
      <Note style={{ margin: 0 }}>If a tool stops working after the update, macOS has forgotten PeakFlow. These steps fix it.</Note>
      <GuideSteps kind="accessibility" lost />
    </div>
  )
}

function Updates(): React.JSX.Element {
  const [info] = useInvoke<AppInfo>(IPC_INVOKE.APP_GET_INFO)
  const [checking, setChecking] = useState(false)
  const arch = info?.arch === 'arm64' ? 'Apple silicon' : info?.arch === 'x64' ? 'Intel' : info?.arch
  return (
    <>
      <Hero icon="logo" title={info ? `PeakFlow ${info.version}` : 'PeakFlow'}>
        {isMac() ? 'PeakFlow checks for updates and asks before it downloads one.' : 'Updates download in the background. PeakFlow tells you when one is ready.'}
      </Hero>
      <Gap />
      <UpdateProgressView />
      <Btn
        block
        disabled={checking}
        onClick={() => {
          setChecking(true)
          invoke(IPC_INVOKE.APP_CHECK_UPDATES)
            .catch(() => {})
            .finally(() => setChecking(false))
        }}
      >
        {checking ? 'Checking…' : 'Check for updates'}
      </Btn>
      <Grp style={{ marginTop: 14 }}>
        <Row label="Version" value={info ? `${info.version}${info.platform === 'darwin' ? ` (Mac, ${arch})` : ''}${info.isDev ? ' · test build' : ''}` : ''} />
      </Grp>
    </>
  )
}

/* ─── extension, share, help ─────────────────────────────────────────────── */

function Extension(): React.JSX.Element {
  return (
    <>
      <Hero icon="puzzle" title="PeakFlow Focus for Chrome">Blocks distracting sites while a Liquid Focus session runs. You choose the sites in Liquid Focus.</Hero>
      <Gap />
      <Grp>
        <Row label="Blocked sites" go="liquidfocus/settings/sites" />
        <Row label="Get the extension" right={<Ext />} onClick={() => openExternal(SITE_URL)} />
      </Grp>
    </>
  )
}

function Share(): React.JSX.Element {
  return (
    <>
      <Hero icon="gift" title="Share PeakFlow, get a tool free">Post about PeakFlow, send us a screenshot, and pick any tool to keep.</Hero>
      <Gap h={12} />
      <Grp>
        {SHARE_LINKS.map(([l, url]) => (
          <Row key={l} label={l} right={<Ext />} onClick={() => openExternal(url)} />
        ))}
      </Grp>
      <Gap h={12} />
      <Primary onClick={() => openExternal(SHARE_MAIL)}>Send your screenshot</Primary>
    </>
  )
}

function Help(): React.JSX.Element {
  const nav = useNav()
  return (
    <>
      <Grp>
        <Row label="Send a bug report" icon="bug" right={<Ext />} onClick={() => invoke(IPC_INVOKE.BUGREPORT_SEND_EMAIL).catch(() => {})} />
        <Row
          label="Copy a bug report"
          icon="file"
          onClick={() =>
            invoke(IPC_INVOKE.BUGREPORT_COPY_TO_CLIPBOARD)
              .then(() => nav.toast('Bug report copied'))
              .catch(() => {})
          }
        />
        <Row label="Open the log file" icon="log" right={<Ext />} onClick={() => invoke(IPC_INVOKE.BUGREPORT_REVEAL_LOG).catch(() => {})} />
        <Row label="Email support" icon="mail" right={<Ext />} onClick={() => openExternal(SUPPORT_MAIL)} />
        <Row label="getpeakflow.pro" icon="globe" right={<Ext />} onClick={() => openExternal(SITE_URL)} />
      </Grp>
      <Note style={{ marginTop: 12 }}>Bug reports include your settings and recent log lines. No clipboard contents.</Note>
    </>
  )
}

/* ─── set up on a Mac (review S13) ───────────────────────────────────────── */

interface SetupInfo {
  location: 'applications' | 'downloads' | 'disk-image' | 'elsewhere'
  permissions: PermissionStatus[]
}

const RUNS_FROM: Record<Exclude<SetupInfo['location'], 'applications'>, string> = {
  downloads: 'your Downloads folder',
  'disk-image': 'the disk image you downloaded',
  elsewhere: 'a folder outside Applications'
}

const PERMISSION_ROWS: Array<{ kind: MacPermission; label: string; sub: string }> = [
  { kind: 'accessibility', label: 'Accessibility', sub: 'Lets QuickBoard paste for you, FocusDim follow your window, SnapGrid move windows and snippets expand.' },
  { kind: 'microphone', label: 'Microphone', sub: 'Only for Dictation. macOS asks the first time you use it.' },
  { kind: 'camera', label: 'Camera', sub: 'Only for Liquid Focus, to notice when you look away. macOS asks the first time you turn it on.' }
]

function Setup(): React.JSX.Element {
  const nav = useNav()
  const [info] = useInvoke<SetupInfo>(IPC_INVOKE.APP_SETUP_INFO)
  const [moving, setMoving] = useState(false)
  if (!info) return <div style={{ height: 220 }} />
  const status = (k: MacPermission): PermissionStatus | undefined => info.permissions.find((p) => p.kind === k)
  const guides = info.permissions.filter((p) => guideView(p) !== 'none')
  return (
    <>
      {info.location !== 'applications' ? (
        <>
          <Banner icon="download">
            <b>Move PeakFlow to Applications</b>
            <br />
            It’s running from {RUNS_FROM[info.location]}. Updates and permissions work properly only when PeakFlow is in Applications.
          </Banner>
          <Btn
            primary
            block
            disabled={moving}
            style={{ marginTop: 12, marginBottom: 14 }}
            onClick={() => {
              setMoving(true)
              invoke<boolean>(IPC_INVOKE.APP_MOVE_TO_APPLICATIONS)
                .then((ok) => {
                  if (!ok) nav.toast('Couldn’t move it. Drag PeakFlow into Applications yourself.')
                })
                .catch(() => {})
                .finally(() => setMoving(false))
            }}
          >
            {moving ? 'Moving…' : 'Move to Applications'}
          </Btn>
        </>
      ) : null}
      {/* The step-by-step guide for each permission that's off (or just came back) */}
      {guides.map((p) => (
        <div key={p.kind} style={{ marginBottom: 16 }}>
          <PermissionGuide kind={p.kind} />
        </div>
      ))}
      <Grp>
        {PERMISSION_ROWS.map((r) => {
          const s = status(r.kind)
          const right = !s ? null : s.granted ? <V>On</V> : s.undecided ? <V>Asks when needed</V> : <Btn sm onClick={() => openPermission(r.kind)}>Open</Btn>
          return <Row key={r.kind} label={r.label} sub={r.sub} right={right} />
        })}
      </Grp>
      <Gap h={16} />
      <Primary onClick={() => nav.back()}>Done</Primary>
    </>
  )
}

/** `back: '__last'` returns to the tool that was open before. */
export const APP_ROUTES: RouteTable = {
  app: { kind: 'sub', back: '__last', title: 'PeakFlow settings', view: Home },
  'app/licence': { kind: 'sub', back: 'app', title: 'Plan', view: Licence },
  'app/licence-key': { kind: 'sub', back: 'app/licence', title: 'Licence key', view: LicenceKey },
  'app/tools': { kind: 'sub', back: 'app', title: 'Tools', view: Tools },
  'app/hotkeys': { kind: 'sub', back: 'app', title: 'Keyboard shortcuts', view: Hotkeys },
  'app/updates': { kind: 'sub', back: 'app', title: 'Updates', view: Updates },
  'app/setup': { kind: 'sub', back: '__last', title: 'Set up on your Mac', view: Setup },
  ...(EXTENSION_ENABLED ? { 'app/extension': { kind: 'sub' as const, back: 'app', title: 'Chrome extension', view: Extension } } : {}),
  'app/share': { kind: 'sub', back: 'app', title: 'Share & Earn', view: Share },
  'app/help': { kind: 'sub', back: 'app', title: 'Help', view: Help }
}
