/**
 * SnapGrid in the v2 panel: put the last window you used into a half, third
 * or corner, or arrange every window on its screen at once. Hovering a
 * layout shows where the window will go; clicking moves it and closes the
 * panel. Matches the approved prototype (artifacts/2026-10-23-snapgrid).
 * Routes: snapgrid, snapgrid/settings, snapgrid/shortcuts.
 */

import { useCallback, useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { SNAP_LAYOUTS, ARRANGE_LAYOUTS, SNAP_UNDO_ACCEL } from '@shared/snapgrid-layouts'
import type { FracRect, SnapGridState, SnapLayout } from '@shared/snapgrid-layouts'
import type { PanelToolModule } from '../../types'
import { invoke, useIpcEvent, useInvoke, formatAccelerator, isMac, builtInKey, ALTGR_NOTE } from '../../hooks'
import { AppIcon, Btn, Grp, Note, Rec, Row, Toggle } from '../../kit'
import { useNav } from '../../nav'
import { PermissionNotice } from '../../permission'
import './snapgrid.css'

/** formatAccelerator leaves Enter and Backspace as words; macOS menus use symbols. '' when the layout has no key here. */
function keys(accel: string): string {
  const s = formatAccelerator(builtInKey(accel))
  return isMac() ? s.replace('Enter', '↩').replace('Backspace', '⌫') : s
}

function useSnapGrid(): [SnapGridState | null, () => void] {
  const [state, setState] = useState<SnapGridState | null>(null)
  const [initial, reload] = useInvoke<SnapGridState>(IPC_INVOKE.SNAPGRID_GET_STATE)
  useEffect(() => {
    if (initial) setState(initial)
  }, [initial])
  useIpcEvent(IPC_SEND.SNAPGRID_STATE_CHANGED, (s) => setState(s as SnapGridState))
  return [state, reload]
}

function useStatus(): string {
  const [s] = useSnapGrid()
  if (!s) return ''
  const n = s.windows.length
  return n === 1 ? '1 window' : `${n} windows`
}

function cellStyle(r: FracRect): React.CSSProperties {
  return { left: `${r.x * 100 + 4}%`, top: `${r.y * 100 + 6}%`, width: `${r.w * 100 - 8}%`, height: `${r.h * 100 - 12}%` }
}

/** The small screen drawn inside each layout tile. */
function Mini({ layout }: { layout: SnapLayout }): React.JSX.Element {
  if (layout.key === 'next') {
    return (
      <span className="sg-mini">
        <i className="o" style={{ left: '6%', top: '22%', width: '42%', height: '56%' }} />
        <i style={{ left: '52%', top: '22%', width: '42%', height: '56%' }} />
      </span>
    )
  }
  const r = layout.rect ?? { x: 0.2, y: 0.15, w: 0.6, h: 0.7 }
  return (
    <span className="sg-mini">
      <i style={cellStyle(r)} />
    </span>
  )
}

const preview = (kind: 'layout' | 'arrange' | null, key?: string): void => {
  invoke(IPC_INVOKE.SNAPGRID_PREVIEW, kind, key).catch(() => {})
}

/** Hide the preview when keyboard focus leaves the layouts, but not when the
 *  panel itself loses focus (on Windows, showing the preview window does that) */
const leavePreview = (e: React.FocusEvent): void => {
  const next = e.relatedTarget as HTMLElement | null
  if (document.hasFocus() && !next?.closest('.sg-grid, .sg-arr')) preview(null)
}

/* ─── main screen ────────────────────────────────────────────────────────── */

function Main(): React.JSX.Element {
  const [s, reload] = useSnapGrid()
  const nav = useNav()
  const [hover, setHover] = useState<SnapLayout | null>(null)
  // Never leave a preview on screen once the panel goes away
  useIpcEvent(IPC_SEND.PANEL_VISIBILITY, (v) => {
    if (!v) {
      preview(null)
      setHover(null)
    }
  })
  useEffect(() => () => preview(null), [])

  const run = useCallback(
    (channel: string, key?: string): void => {
      preview(null)
      invoke<string>(channel, key)
        .then((msg) => {
          if (msg) nav.toast(msg)
          reload()
        })
        .catch(() => {})
    },
    [nav, reload]
  )

  if (!s) return <div style={{ height: 380 }} />
  const mac = isMac()
  return (
    <>
      <PermissionNotice kind="accessibility" why="SnapGrid uses it to move other apps’ windows." />

      <div className="sg-cap">
        Front window
        {s.target ? (
          <>
            <AppIcon q={s.target.icon} size={13} />
            <span className="nm">{s.target.appName}</span>
          </>
        ) : (
          <span className="nm dim">click a window first</span>
        )}
      </div>
      <div className="sg-grid" onMouseLeave={() => { setHover(null); preview(null) }}>
        {SNAP_LAYOUTS.map((l) => (
          <button
            key={l.key}
            className="sg-tile"
            aria-label={keys(l.accel) ? `${l.name} (${keys(l.accel)})` : l.name}
            onMouseEnter={() => { setHover(l); preview('layout', l.key) }}
            onFocus={() => { setHover(l); preview('layout', l.key) }}
            onBlur={leavePreview}
            onClick={() => run(IPC_INVOKE.SNAPGRID_APPLY, l.key)}
          >
            <Mini layout={l} />
          </button>
        ))}
      </div>
      <div className="sg-hint">
        <span>{hover ? hover.name : 'Hover a layout to see where it goes'}</span>
        {hover && keys(hover.accel) ? <kbd>{keys(hover.accel)}</kbd> : null}
      </div>

      <div className="sg-cap" style={{ marginTop: 14 }}>Arrange all windows</div>
      <div className="sg-arr" onMouseLeave={() => preview(null)}>
        {ARRANGE_LAYOUTS.map((a) => {
          const n = Math.max(1, Math.min(a.max, s.windows.length))
          const rects = a.rects(n)
          return (
            <button
              key={a.key}
              className="sg-atile"
              disabled={!s.windows.length}
              onMouseEnter={() => preview('arrange', a.key)}
              onFocus={() => preview('arrange', a.key)}
              onBlur={leavePreview}
              onClick={() => run(IPC_INVOKE.SNAPGRID_ARRANGE, a.key)}
            >
              <span className="sg-tile">
                <span className="sg-mini">
                  {rects.map((r, i) => (
                    <i key={i} style={cellStyle(r)}>
                      {s.windows[i] ? <AppIcon q={s.windows[i].icon} size={9} /> : null}
                    </i>
                  ))}
                </span>
              </span>
              {a.name}
            </button>
          )
        })}
      </div>

      <Grp style={{ marginTop: 12 }}>
        <Row
          label="Dim the rest"
          sub="FocusDim fades every other window"
          right={
            <Toggle
              label="Dim the rest"
              checked={s.dim}
              onChange={() => invoke(IPC_INVOKE.FOCUSDIM_TOGGLE).then(() => reload()).catch(() => {})}
            />
          }
        />
        {mac ? (
          s.osDrag ? (
            <Row
              label="Snap when dragging to edges"
              sub="macOS already does this. Turn it off there to use SnapGrid’s."
              right={<Btn sm onClick={() => invoke(IPC_INVOKE.SNAPGRID_OPEN_OS_SETTINGS).catch(() => {})}>Settings</Btn>}
            />
          ) : (
            <Row
              label="Snap when dragging to edges"
              right={
                <Toggle
                  label="Snap when dragging to edges"
                  checked={s.dragSnap}
                  onChange={(v) => invoke(IPC_INVOKE.SNAPGRID_SET_DRAG, v).then(() => reload()).catch(() => {})}
                />
              }
            />
          )
        ) : null}
        <Row
          label="Put it back"
          tone={s.canUndo ? undefined : 'muted'}
          value={keys(SNAP_UNDO_ACCEL)}
          onClick={() => run(IPC_INVOKE.SNAPGRID_UNDO)}
        />
      </Grp>
    </>
  )
}

/* ─── settings and shortcuts ─────────────────────────────────────────────── */

function Settings(): React.JSX.Element {
  const [s, reload] = useSnapGrid()
  if (!s) return <div style={{ height: 120 }} />
  return (
    <>
      <Grp>
        {isMac() && !s.osDrag ? (
          <Row
            label="Snap when dragging to edges"
            sub="Edges for halves, corners for quarters, top to fill, bottom for thirds"
            right={<Toggle label="Snap when dragging to edges" checked={s.dragSnap} onChange={(v) => invoke(IPC_INVOKE.SNAPGRID_SET_DRAG, v).then(() => reload()).catch(() => {})} />}
          />
        ) : (
          <Row
            label={isMac() ? 'Dragging to edges is handled by macOS' : 'Dragging to edges is handled by Windows Snap'}
            sub={isMac() ? 'Turn off “Drag windows to screen edges to tile” to use SnapGrid’s, which adds thirds.' : 'SnapGrid adds thirds, two-thirds and the keys below.'}
            right={<Btn sm onClick={() => invoke(IPC_INVOKE.SNAPGRID_OPEN_OS_SETTINGS).catch(() => {})}>Settings</Btn>}
          />
        )}
      </Grp>
      <Grp>
        <Row label="Shortcuts" go="snapgrid/shortcuts" />
      </Grp>
    </>
  )
}

function Shortcuts(): React.JSX.Element {
  const [registered] = useInvoke<Array<{ accelerator: string; label: string }>>(IPC_INVOKE.HOTKEY_GET_REGISTERED)
  const mine = (id: string): boolean => !registered || registered.some((r) => r.label === id)
  const sub = (id: string): string | undefined => (mine(id) ? undefined : 'Not active: another app uses it')
  return (
    <>
      <Grp>
        {SNAP_LAYOUTS.map((l) => (
          builtInKey(l.accel) ? (
            <Row key={l.key} label={l.name} sub={sub(`snapgrid:${l.key}`)} right={<Rec value={l.accel} />} />
          ) : (
            <Row key={l.key} label={l.name} value="No shortcut" />
          )
        ))}
        <Row label="Put it back" sub={sub('snapgrid:undo')} right={<Rec value={SNAP_UNDO_ACCEL} />} />
      </Grp>
      <Note style={{ marginTop: 10 }}>
        These are fixed for now. Top and bottom halves use {isMac() ? '⇧' : 'Shift'} because {isMac() ? '⌃⌥↑ and ⌃⌥↓' : 'Ctrl+Alt+Up and Ctrl+Alt+Down'} change FocusDim’s brightness.
        {isMac() ? null : <> {ALTGR_NOTE}</>}
      </Note>
    </>
  )
}

export const snapgridTool: PanelToolModule = {
  id: 'snapgrid',
  name: 'SnapGrid',
  desc: 'Put any window in a half, third or corner',
  icon: 'snapgrid',
  useStatus,
  routes: {
    snapgrid: { kind: 'tool', tool: 'snapgrid', view: Main },
    'snapgrid/settings': { kind: 'sub', back: 'snapgrid', title: 'SnapGrid settings', view: Settings },
    'snapgrid/shortcuts': { kind: 'sub', back: 'snapgrid/settings', title: 'Shortcuts', view: Shortcuts }
  }
}
