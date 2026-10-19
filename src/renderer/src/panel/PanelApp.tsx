/**
 * PeakFlow v2: the one-app panel.
 *
 * One small dark panel drops down from the menu-bar icon. The header holds a
 * switcher for the four tools (⌥⌘1–4); Settings and Quit sit at the bottom of
 * the switcher. Settings and other secondary pages drill in inside the same
 * panel with a back arrow. Design source: the approved prototype in
 * ~/Work/peakflow/artifacts/2026-10-19-app-redesign/full (direction C, monochrome).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './panel.css'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { AccessStatus } from '@shared/ipc-types'
import { Icon } from './icons'
import { NavContext, matchRoute, type NavApi } from './nav'
import { invoke, useIpcEvent, useInvoke, formatAccelerator } from './hooks'
import { Btn, Hero, LinkBtn, Primary, Grp, Row, Gap, openExternal } from './kit'
import { TOOL_MODULES, TOOL_BY_ID } from './tools'
import { APP_ROUTES } from './app/AppSettings'
import type { DialogSpec, PanelToolId, RouteDef, RouteTable } from './types'

const ALL_ROUTES: RouteTable = Object.assign({}, ...TOOL_MODULES.map((m) => m.routes), APP_ROUTES)
const LAST_KEY = 'pf.panel.last-tool'
const SWITCH_KEYS = ['Alt+CommandOrControl+1', 'Alt+CommandOrControl+2', 'Alt+CommandOrControl+3', 'Alt+CommandOrControl+4']
export const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

function readLast(): PanelToolId {
  try {
    const v = localStorage.getItem(LAST_KEY)
    if (v && TOOL_BY_ID[v as PanelToolId]) return v as PanelToolId
  } catch { /* storage unavailable */ }
  return 'focusdim'
}

function toolOf(route: string): PanelToolId | null {
  const head = route.split('/')[0] as PanelToolId
  return TOOL_BY_ID[head] ? head : null
}

export function PanelApp(): React.JSX.Element {
  const [route, setRoute] = useState<string>(() => readLast())
  const [ddOpen, setDdOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ id: number; text: string } | null>(null)
  const [dialog, setDialog] = useState<(DialogSpec & { resolve: (v: string | null) => void }) | null>(null)
  const lastTool = useRef<PanelToolId>(readLast())

  // Every tool's status hook runs all the time (the switcher shows them all)
  const statuses = TOOL_MODULES.map((m) => m.useStatus())

  const match = useMemo(() => matchRoute(ALL_ROUTES, route) ?? matchRoute(ALL_ROUTES, lastTool.current)!, [route])
  const def: RouteDef = match.def
  const currentTool: PanelToolId = def.kind === 'tool' ? def.tool : toolOf(route) ?? lastTool.current

  const go = useCallback((r: string) => {
    setDdOpen(false)
    setRoute(r)
    const t = toolOf(r)
    if (t) {
      lastTool.current = t
      try { localStorage.setItem(LAST_KEY, t) } catch { /* ignore */ }
    }
  }, [])

  const hide = useCallback(() => {
    setDdOpen(false)
    invoke(IPC_INVOKE.PANEL_HIDE).catch(() => {})
  }, [])

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toast = useCallback((text: string) => {
    setToastMsg({ id: Date.now(), text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 1800)
  }, [])

  const confirm = useCallback((spec: DialogSpec) => new Promise<string | null>((resolve) => setDialog({ ...spec, resolve })), [])

  const back = useCallback(() => {
    if (def.kind === 'sub') go(def.back === '__last' ? lastTool.current : def.back)
    else go(currentTool)
  }, [def, go, currentTool])

  const nav: NavApi = useMemo(
    () => ({ route, params: match.params, go, back, hide, toast, confirm }),
    [route, match.params, go, back, hide, toast, confirm]
  )

  // Main asks for a route (tray menu, ⌥⌘1–4, the mini timer)
  useIpcEvent(IPC_SEND.PANEL_NAVIGATE, (r) => {
    if (typeof r === 'string' && matchRoute(ALL_ROUTES, r)) go(r)
  })
  useIpcEvent(IPC_SEND.PANEL_VISIBILITY, (v) => {
    if (!v) setDdOpen(false)
  })

  // Keyboard: ⌥⌘1–4 switch, ⌘, settings, Esc closes the menu / goes back / hides, ⌘Q quits
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, .rec.on')
      if (e.altKey && e.metaKey && /^Digit[1-4]$/.test(e.code)) {
        e.preventDefault()
        go(TOOL_MODULES[Number(e.code.slice(5)) - 1].id)
        return
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        go(`${currentTool}/settings`)
        return
      }
      if (e.metaKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        invoke(IPC_INVOKE.APP_QUIT).catch(() => {})
        return
      }
      if (e.key === 'Escape' && !typing) {
        if (dialog) {
          dialog.resolve(null)
          setDialog(null)
        } else if (ddOpen) setDdOpen(false)
        else if (def.kind === 'sub') back()
        else hide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, back, hide, ddOpen, dialog, def.kind, currentTool])

  // Size the window to the content (the main process caps it at 640px)
  const contentRef = useRef<HTMLDivElement>(null)
  const ddRef = useRef<HTMLDivElement>(null)
  const [needed, setNeeded] = useState(0)
  useLayoutEffect(() => {
    const measure = (): void => {
      const body = contentRef.current?.scrollHeight ?? 0
      const dd = ddOpen ? (ddRef.current?.offsetHeight ?? 0) + 52 : 0
      const dlg = dialog ? 280 : 0
      setNeeded(Math.max(44 + 28 + body, 44 + dd, dlg))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (contentRef.current) ro.observe(contentRef.current)
    if (ddRef.current) ro.observe(ddRef.current)
    return () => ro.disconnect()
  }, [route, ddOpen, dialog])
  useEffect(() => {
    if (needed > 0) invoke(IPC_INVOKE.PANEL_RESIZE, needed).catch(() => {})
  }, [needed])

  const View = def.view
  const title = def.kind === 'sub' ? (typeof def.title === 'function' ? def.title(match.params) : def.title) : ''
  const Right = def.kind === 'sub' ? def.right : undefined
  const gatedTool = toolOf(route)

  return (
    <NavContext.Provider value={nav}>
      <div className="pf" style={{ height: '100vh' }}>
        <section className="panel" aria-label="PeakFlow" style={{ height: '100vh' }}>
          <div className="p-head">
            {def.kind === 'tool' ? (
              <>
                <button className="dd" aria-expanded={ddOpen} aria-haspopup="menu" onClick={() => setDdOpen((v) => !v)}>
                  <span className="ic">
                    <Icon name={TOOL_BY_ID[def.tool].icon} />
                  </span>
                  <span className="pixel">{TOOL_BY_ID[def.tool].name}</span>
                  <Icon name="chev" className="chev" />
                </button>
                <span className="status">{statuses[TOOL_MODULES.findIndex((m) => m.id === def.tool)]}</span>
              </>
            ) : (
              <>
                <button className="back" aria-label="Back" onClick={back}>
                  <Icon name="chevL" />
                </button>
                <span className="p-title">{title}</span>
                <span className="status">{Right ? <Right params={match.params} /> : null}</span>
              </>
            )}
            {ddOpen && def.kind === 'tool' ? (
              <Switcher innerRef={ddRef} current={def.tool} statuses={statuses} onGo={go} onClose={() => setDdOpen(false)} />
            ) : null}
          </div>
          <div
            className={def.flush ? 'p-body flush' : 'p-body'}
            onMouseDown={() => {
              if (ddOpen) setDdOpen(false)
            }}
          >
            <div ref={contentRef}>
              {gatedTool ? (
                <ToolGate tool={gatedTool}>
                  <View params={match.params} />
                </ToolGate>
              ) : (
                <View params={match.params} />
              )}
            </div>
            {toastMsg ? (
              <div key={toastMsg.id} className="toast show">
                {toastMsg.text}
              </div>
            ) : null}
          </div>
          {dialog ? (
            <div className="layer dialog-wrap">
              <div className="dialog" role="dialog" aria-label={dialog.title}>
                {dialog.icon ? (
                  <div className="ai">
                    <Icon name={dialog.icon} />
                  </div>
                ) : null}
                <h4>{dialog.title}</h4>
                {dialog.body ? <p>{dialog.body}</p> : null}
                <div className="btn-col">
                  {dialog.buttons.map((b) => (
                    <Btn
                      key={b.value}
                      primary={b.primary}
                      onClick={() => {
                        dialog.resolve(b.value)
                        setDialog(null)
                      }}
                    >
                      {b.label}
                    </Btn>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
        {TOOL_MODULES.map((m) => (m.Background ? <m.Background key={m.id} /> : null))}
      </div>
    </NavContext.Provider>
  )
}

/* ─── Switcher dropdown ──────────────────────────────────────────────────── */

function Switcher({ innerRef, current, statuses, onGo, onClose }: {
  innerRef: React.RefObject<HTMLDivElement | null>
  current: PanelToolId
  statuses: string[]
  onGo: (r: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [access] = useInvoke<AccessStatus>(IPC_INVOKE.SECURITY_CHECK_ACCESS)
  const trial = !access ? null : access.isLicensed ? (
    <div className="trial-line"><span>{access.isSuiteLicense ? 'PeakFlow Pro' : 'Licensed'}</span></div>
  ) : access.allowed ? (
    <div className="trial-line"><span>Trial: {access.daysRemaining} {access.daysRemaining === 1 ? 'day' : 'days'} left</span></div>
  ) : (
    <div className="trial-line"><span>Trial ended</span><LinkBtn onClick={() => onGo('app/licence')}>See plans</LinkBtn></div>
  )

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const el = innerRef.current
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.dd')) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [innerRef, onClose])

  return (
    <div className="ddm" role="menu" ref={innerRef}>
      {TOOL_MODULES.map((t, i) => (
        <div key={t.id} className={t.id === current ? 'mi sel' : 'mi'} role="menuitem" tabIndex={0} onClick={() => onGo(t.id)} onKeyDown={(e) => e.key === 'Enter' && onGo(t.id)}>
          <span className="ck">{t.id === current ? <Icon name="check" /> : null}</span>
          <span className="ic">
            <Icon name={t.icon} />
          </span>
          {t.name}
          <span className={t.id === 'liquidfocus' && /\d:\d\d/.test(statuses[i]) ? 'st on' : 'st'}>{statuses[i]}</span>
          <kbd style={{ marginLeft: 'auto' }}>{formatAccelerator(SWITCH_KEYS[i])}</kbd>
        </div>
      ))}
      <div className="sep" />
      <div className="mi small" role="menuitem" onClick={() => onGo(`${current}/settings`)}>
        <span className="ck" />
        {TOOL_BY_ID[current].name} settings…
        <kbd style={{ marginLeft: 'auto', display: 'inline-block' }}>⌘,</kbd>
      </div>
      <div className="mi small" role="menuitem" onClick={() => onGo('app')}>
        <span className="ck" />
        PeakFlow settings…
      </div>
      <div className="sep" />
      {trial}
      <div className="mi small" role="menuitem" onClick={() => invoke(IPC_INVOKE.APP_QUIT).catch(() => {})}>
        <span className="ck" />
        Quit PeakFlow
        <kbd style={{ marginLeft: 'auto', display: 'inline-block' }}>⌘Q</kbd>
      </div>
    </div>
  )
}

/* ─── Turn-on and trial-ended screens (existing install + licence logic) ── */

function ToolGate({ tool, children }: { tool: PanelToolId; children: ReactNode }): React.JSX.Element {
  const [install, reloadInstall] = useInvoke<{ installed: boolean; daysRemaining: number }>(IPC_INVOKE.TOOL_GET_INSTALL_STATE, tool)
  const [access, reloadAccess] = useInvoke<AccessStatus>(IPC_INVOKE.SECURITY_CHECK_TOOL_ACCESS, tool)
  useIpcEvent(IPC_SEND.LICENSE_STATUS_CHANGED, () => {
    reloadInstall()
    reloadAccess()
  })
  const m = TOOL_BY_ID[tool]
  if (!install || !access) return <div style={{ height: 120 }} />
  if (!install.installed) {
    return (
      <>
        <Hero icon={m.icon} title={`Turn on ${m.name}`}>{m.desc}.</Hero>
        <Gap />
        <Primary
          onClick={() => {
            invoke(IPC_INVOKE.TOOL_INSTALL, tool)
              .then(() => {
                reloadInstall()
                reloadAccess()
              })
              .catch(() => {})
          }}
        >
          Turn on {m.name}
        </Primary>
      </>
    )
  }
  if (!access.allowed && access.message !== 'tool_not_installed') return <Locked tool={tool} />
  return <>{children}</>
}

function Locked({ tool }: { tool: PanelToolId }): React.JSX.Element {
  const m = TOOL_BY_ID[tool]
  return (
    <>
      <Hero icon="clock" title={`Your ${m.name} trial has ended`}>Your settings are saved. Pick a plan to keep using it.</Hero>
      <Gap h={16} />
      <Primary onClick={() => openExternal(CHECKOUT_URL)}>See plans</Primary>
      <Grp style={{ marginTop: 14 }}>
        <Row label="Enter a licence key" go="app/licence-key" />
      </Grp>
    </>
  )
}
