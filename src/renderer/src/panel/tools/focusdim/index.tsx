/**
 * FocusDim in the v2 panel: main screen, settings, excluded apps, shortcuts
 * and displays. Wired to the existing FocusDim service (focusdim:* IPC);
 * behaviour is unchanged, only the UI is new.
 * Prototype routes: focusdim, focusdim/settings, focusdim/excluded(/add),
 * focusdim/shortcuts, focusdim/displays.
 */

import { useCallback, useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { PanelToolModule } from '../../types'
import { invoke, useIpcEvent, useInvoke, formatAccelerator, isMac } from '../../hooks'
import { AppIcon, Banner, Btn, Empty, Grp, IconBtn, Note, Rec, Row, Seg, SliderRow, TextTabs, Toggle } from '../../kit'
import { useNav } from '../../nav'

interface FocusDimState {
  enabled: boolean
  opacity: number
  dimColor: string
  showBorder: boolean
  fadeDuration: number
  peekDuration: number
  peeking: boolean
  hotkey: string
  autoRevealDesktop: boolean
  highlightMode: 'active' | 'app' | 'all'
  dragEscape: boolean
  raiseAppWindows: boolean
  excludedApps: Array<{ exe: string; name: string }>
}

interface DisplayInfo {
  id: number
  label: string
  disabled: boolean
}

const PRESETS: Array<[number, string]> = [
  [30, 'Light'],
  [50, 'Medium'],
  [70, 'Heavy'],
  [85, 'Max']
]
const COLOURS = [
  { hex: '#000000', label: 'Black' },
  { hex: '#1a0a2e', label: 'Purple' },
  { hex: '#0a1628', label: 'Blue' },
  { hex: '#151515', label: 'Grey' }
]
/** Fixed in hotkeys.ts (not editable in the current app either). */
const FIXED_KEYS = { up: 'Control+Alt+Up', down: 'Control+Alt+Down', peek: 'Control+Alt+`' }

/** FocusDim stores 'ctrl+shift+d'; the main process maps ctrl/cmd → CommandOrControl. */
function configToAccel(hotkey: string): string {
  return hotkey
    .split('+')
    .map((p) => {
      const l = p.trim().toLowerCase()
      if (l === 'ctrl' || l === 'control' || l === 'cmd' || l === 'command') return 'CommandOrControl'
      return l.charAt(0).toUpperCase() + l.slice(1)
    })
    .join('+')
}
function accelToConfig(accel: string): string {
  return accel
    .split('+')
    .map((p) => {
      const l = p.toLowerCase()
      if (l === 'commandorcontrol' || l === 'control') return 'ctrl'
      if (l === 'super') return 'meta'
      return l
    })
    .join('+')
}

/* ─── shared state ───────────────────────────────────────────────────────── */

function useFocusDim(): [FocusDimState | null, (patch: Partial<FocusDimState>) => void] {
  const [state, setState] = useState<FocusDimState | null>(null)
  const [initial] = useInvoke<FocusDimState>(IPC_INVOKE.FOCUSDIM_GET_STATE)
  useEffect(() => {
    if (initial) setState(initial)
  }, [initial])
  useIpcEvent(IPC_SEND.FOCUSDIM_STATE_CHANGED, (s) => setState(s as FocusDimState))
  const patch = useCallback((p: Partial<FocusDimState>) => setState((prev) => (prev ? { ...prev, ...p } : prev)), [])
  return [state, patch]
}

function useStatus(): string {
  const [s] = useFocusDim()
  if (!s) return ''
  return s.enabled ? `On · ${Math.round(s.opacity * 100)}%` : 'Off'
}

/* ─── main screen ────────────────────────────────────────────────────────── */

function Main(): React.JSX.Element {
  const [s, patch] = useFocusDim()
  const [axOk] = useAccessibility()
  if (!s) return <div style={{ height: 200 }} />
  const pct = Math.round(s.opacity * 100)
  const setPct = (v: number): void => {
    patch({ opacity: v / 100 })
    invoke(IPC_INVOKE.FOCUSDIM_SET_OPACITY, v / 100).catch(() => {})
  }
  return (
    <>
      {!axOk ? (
        <>
          <Banner icon="shield">
            <b>Needs Accessibility access</b>
            <br />
            FocusDim uses it to see which window you’re in.
          </Banner>
          <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => invoke(IPC_INVOKE.APP_OPEN_ACCESSIBILITY).catch(() => {})}>
            Open System Settings
          </Btn>
        </>
      ) : null}
      <Grp>
        <Row
          label="Dim other windows"
          right={
            <Toggle
              label="Dim other windows"
              checked={s.enabled}
              onChange={() => invoke<FocusDimState>(IPC_INVOKE.FOCUSDIM_TOGGLE).then((n) => n && patch(n)).catch(() => {})}
            />
          }
        />
      </Grp>
      <div className="blk" style={{ marginTop: 6 }}>
        <Seg
          value={s.highlightMode}
          options={[
            ['active', 'Active window'],
            ['app', 'App windows'],
            ['all', 'All windows']
          ]}
          onChange={(m) => {
            patch({ highlightMode: m })
            invoke(IPC_INVOKE.FOCUSDIM_SET_HIGHLIGHT_MODE, m).catch(() => {})
          }}
        />
      </div>
      {s.highlightMode !== 'active' ? (
        <Grp style={{ marginTop: 8 }}>
          <Row
            label="Bring the app's windows forward"
            sub="When you switch apps, all its open windows come to the front"
            right={
              <Toggle
                label="Bring the app's windows forward"
                checked={s.raiseAppWindows}
                onChange={(v) => {
                  patch({ raiseAppWindows: v })
                  invoke(IPC_INVOKE.CONFIG_SET, { tool: 'focusdim', key: 'raise_app_windows', value: v }).catch(() => {})
                }}
              />
            }
          />
        </Grp>
      ) : null}
      <Grp style={{ marginTop: 8 }}>
        <SliderRow label="Intensity" value={pct} min={10} max={90} format={(v) => `${v}%`} onCommit={setPct} />
      </Grp>
      <TextTabs style={{ margin: 0, padding: 0 }} value={PRESETS.find(([n]) => n === pct)?.[0] ?? -1} options={PRESETS} onChange={setPct} />
      <Note style={{ marginTop: 16 }}>
        Turn on or off with <b>{formatAccelerator(configToAccel(s.hotkey))}</b>. Press <b>{formatAccelerator(FIXED_KEYS.peek)}</b> to peek.
      </Note>
    </>
  )
}

/** macOS Accessibility permission (always true elsewhere). */
function useAccessibility(): [boolean] {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    if (!isMac()) return
    invoke<boolean>(IPC_INVOKE.APP_CHECK_ACCESSIBILITY).then((v) => setOk(v !== false)).catch(() => setOk(true))
  }, [])
  return [ok]
}

/* ─── settings ───────────────────────────────────────────────────────────── */

function Settings(): React.JSX.Element {
  const [s, patch] = useFocusDim()
  const [autoStart, , setAutoStart] = useInvoke<boolean>(IPC_INVOKE.APP_GET_AUTO_START)
  const [displays] = useInvoke<DisplayInfo[]>(IPC_INVOKE.FOCUSDIM_GET_DISPLAYS)
  const [hex, setHex] = useState('')
  useEffect(() => {
    if (s) setHex(s.dimColor)
  }, [s?.dimColor])
  if (!s) return <div style={{ height: 300 }} />
  const setColour = (c: string): void => {
    patch({ dimColor: c })
    invoke(IPC_INVOKE.FOCUSDIM_SET_COLOR, c).catch(() => {})
  }
  const setCfg = (key: string, value: unknown, p: Partial<FocusDimState>): void => {
    patch(p)
    invoke(IPC_INVOKE.CONFIG_SET, { tool: 'focusdim', key, value }).catch(() => {})
  }
  const onCount = displays ? displays.filter((d) => !d.disabled).length : 0
  return (
    <>
      <Grp>
        <Row
          label="Dim colour"
          right={COLOURS.map((c) => (
            <button key={c.hex} className="swatch" style={{ background: c.hex }} aria-pressed={s.dimColor.toLowerCase() === c.hex} aria-label={c.label} title={c.label} onClick={() => setColour(c.hex)} />
          ))}
        />
        <Row
          label="Custom colour"
          right={
            <input
              className="num-in"
              style={{ width: 84, textAlign: 'left' }}
              aria-label="Custom colour"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={() => (/^#[0-9a-fA-F]{6}$/.test(hex) ? setColour(hex.toLowerCase()) : setHex(s.dimColor))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          }
        />
        <Row
          label="Border around the active window"
          right={<Toggle label="Border" checked={s.showBorder} onChange={(v) => { patch({ showBorder: v }); invoke(IPC_INVOKE.FOCUSDIM_SET_BORDER, v).catch(() => {}) }} />}
        />
      </Grp>
      <Grp>
        <SliderRow
          label="Fade speed"
          value={s.fadeDuration}
          min={0}
          max={5000}
          step={100}
          format={(v) => (v === 0 ? 'Instant' : `${v} ms`)}
          onCommit={(v) => { patch({ fadeDuration: v }); invoke(IPC_INVOKE.FOCUSDIM_SET_FADE_DURATION, v).catch(() => {}) }}
        />
        <SliderRow
          label="Peek lasts"
          value={s.peekDuration}
          min={1}
          max={10}
          format={(v) => `${v} s`}
          onCommit={(v) => { patch({ peekDuration: v }); invoke(IPC_INVOKE.FOCUSDIM_SET_PEEK_DURATION, v).catch(() => {}) }}
        />
      </Grp>
      <Grp>
        <Row label="Hide when the desktop is focused" right={<Toggle label="Hide when the desktop is focused" checked={s.autoRevealDesktop} onChange={(v) => setCfg('auto_reveal_desktop', v, { autoRevealDesktop: v })} />} />
        <Row label="Fade while dragging a window" right={<Toggle label="Fade while dragging a window" checked={s.dragEscape} onChange={(v) => setCfg('drag_escape', v, { dragEscape: v })} />} />
        <Row
          label="Launch PeakFlow at login"
          sub="Applies to all tools"
          right={
            <Toggle
              label="Launch PeakFlow at login"
              checked={!!autoStart}
              onChange={() => invoke<boolean>(IPC_INVOKE.APP_SET_AUTO_START, !autoStart).then((v) => setAutoStart(!!v)).catch(() => {})}
            />
          }
        />
      </Grp>
      <Grp>
        <Row label="Excluded apps" value={s.excludedApps.length || 'None'} go="focusdim/excluded" />
        <Row label="Shortcuts" go="focusdim/shortcuts" />
        {displays && displays.length >= 2 ? <Row label="Displays" value={`${onCount} on`} go="focusdim/displays" /> : null}
      </Grp>
    </>
  )
}

/* ─── excluded apps ──────────────────────────────────────────────────────── */

function Excluded(): React.JSX.Element {
  const [s, patch] = useFocusDim()
  if (!s) return <div style={{ height: 120 }} />
  return (
    <>
      <Note style={{ marginBottom: 8 }}>These apps are never dimmed.</Note>
      {s.excludedApps.length ? (
        <Grp>
          {s.excludedApps.map((a) => (
            <Row
              key={a.exe}
              label={a.name}
              icon={<AppIcon q={{ bundleId: a.exe, name: a.name }} size={16} />}
              right={
                <IconBtn
                  icon="x"
                  label={`Remove ${a.name}`}
                  onClick={() => {
                    patch({ excludedApps: s.excludedApps.filter((x) => x.exe !== a.exe) })
                    invoke(IPC_INVOKE.FOCUSDIM_REMOVE_EXCLUDED_APP, a.exe).catch(() => {})
                  }}
                />
              }
            />
          ))}
        </Grp>
      ) : (
        <Empty icon="focusdim" title="No excluded apps">Every app gets dimmed.</Empty>
      )}
      <Grp>
        <Row label="Add an app" icon="plus" go="focusdim/excluded/add" />
      </Grp>
    </>
  )
}

function AddExcluded(): React.JSX.Element {
  const nav = useNav()
  const [apps, setApps] = useState<Array<{ exe: string; name: string }> | null>(null)
  useEffect(() => {
    // The macOS helper answers asynchronously: the first call primes its cache
    let alive = true
    const load = (n: number): void => {
      invoke<Array<{ exe: string; name: string }>>(IPC_INVOKE.FOCUSDIM_GET_RUNNING_APPS)
        .then((list) => {
          if (!alive) return
          if ((list?.length ?? 0) === 0 && n < 4) setTimeout(() => load(n + 1), 400)
          else setApps(list ?? [])
        })
        .catch(() => alive && setApps([]))
    }
    load(0)
    return () => {
      alive = false
    }
  }, [])
  if (!apps) return <Note>Looking for running apps…</Note>
  if (!apps.length) return <Empty icon="search" title="No running apps found">Open the app you want to exclude, then try again.</Empty>
  return (
    <>
      <Note style={{ marginBottom: 8 }}>Apps running now</Note>
      <Grp>
        {apps.map((a) => (
          <Row
            key={a.exe}
            label={a.name}
            icon={<AppIcon q={{ bundleId: a.exe, name: a.name }} size={16} />}
            onClick={() => {
              invoke(IPC_INVOKE.FOCUSDIM_ADD_EXCLUDED_APP, a.exe, a.name)
                .then(() => nav.go('focusdim/excluded'))
                .catch(() => {})
            }}
          />
        ))}
      </Grp>
    </>
  )
}

/* ─── shortcuts ──────────────────────────────────────────────────────────── */

function Shortcuts(): React.JSX.Element {
  const [s, patch] = useFocusDim()
  const nav = useNav()
  if (!s) return <div style={{ height: 160 }} />
  return (
    <>
      <Grp>
        <Row
          label="Turn dimming on or off"
          right={
            <Rec
              value={configToAccel(s.hotkey)}
              onRecord={(accel) => {
                const cfg = accelToConfig(accel)
                invoke<boolean>(IPC_INVOKE.FOCUSDIM_SET_HOTKEY, cfg)
                  .then((ok) => {
                    if (ok) {
                      patch({ hotkey: cfg })
                      nav.toast(`Shortcut set to ${formatAccelerator(configToAccel(cfg))}`)
                    } else nav.toast(`Couldn’t set ${formatAccelerator(accel)}: another app uses it`)
                  })
                  .catch(() => {})
              }}
            />
          }
        />
        <Row label="Increase intensity" right={<Rec value={FIXED_KEYS.up} />} />
        <Row label="Decrease intensity" right={<Rec value={FIXED_KEYS.down} />} />
        <Row label="Peek (show everything)" right={<Rec value={FIXED_KEYS.peek} />} />
      </Grp>
      <Note style={{ marginTop: 10 }}>Click a shortcut, then press the new keys. It needs ⌘, ⌥, ⌃ or ⇧. Press Esc to cancel. The intensity and peek keys are fixed for now.</Note>
    </>
  )
}

/* ─── displays ───────────────────────────────────────────────────────────── */

function Displays(): React.JSX.Element {
  const [displays, , setDisplays] = useInvoke<DisplayInfo[]>(IPC_INVOKE.FOCUSDIM_GET_DISPLAYS)
  if (!displays) return <div style={{ height: 100 }} />
  return (
    <>
      <Grp>
        {displays.map((d) => (
          <Row
            key={d.id}
            label={d.label}
            icon="monitor"
            right={
              <Toggle
                label={d.label}
                checked={!d.disabled}
                onChange={(on) => {
                  const next = displays.map((x) => (x.id === d.id ? { ...x, disabled: !on } : x))
                  setDisplays(next)
                  invoke(IPC_INVOKE.FOCUSDIM_SET_DISABLED_DISPLAYS, next.filter((x) => x.disabled).map((x) => x.id)).catch(() => {})
                }}
              />
            }
          />
        ))}
      </Grp>
      <Note style={{ marginTop: 10 }}>Shown when two or more displays are connected.</Note>
    </>
  )
}

export const focusdimTool: PanelToolModule = {
  id: 'focusdim',
  name: 'FocusDim',
  desc: 'Dim everything except the window you’re using',
  icon: 'focusdim',
  useStatus,
  routes: {
    focusdim: { kind: 'tool', tool: 'focusdim', view: Main },
    'focusdim/settings': { kind: 'sub', back: 'focusdim', title: 'FocusDim settings', view: Settings },
    'focusdim/excluded': { kind: 'sub', back: 'focusdim/settings', title: 'Excluded apps', view: Excluded },
    'focusdim/excluded/add': { kind: 'sub', back: 'focusdim/excluded', title: 'Add an app', view: AddExcluded },
    'focusdim/shortcuts': { kind: 'sub', back: 'focusdim/settings', title: 'Shortcuts', view: Shortcuts },
    'focusdim/displays': { kind: 'sub', back: 'focusdim/settings', title: 'Displays', view: Displays }
  }
}

