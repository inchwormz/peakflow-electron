/**
 * Permission screens for every panel tool (review S1). The words come from
 * shared/mac-permissions.ts through the main process, which knows when a
 * permission was granted before and an update made macOS forget it.
 *
 * - PermissionGuide: numbered steps, each with a drawing of exactly what to
 *   click in System Settings (shared/permission-art.ts), one Open Settings
 *   button, and "All set" once the permission works again. On the set-up page
 *   and the Updates page.
 * - PermissionNotice: the short version inside a tool, with "Show me how"
 *   to the full guide.
 *
 * While a guide is on screen it re-checks every 2 seconds; main also watches
 * after Open Settings and brings the panel back when the permission works.
 */

import { useEffect } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { MacPermission, PermissionStatus } from '@shared/mac-permissions'
import { GUIDE_ALL_SET, GUIDE_RESTART_HINT, GUIDE_WATCHING, PERMISSION_GUIDE_URL, guideCopy, guideView } from '@shared/mac-permissions'
import { permissionArt } from '@shared/permission-art'
import { invoke, isMac, useInvoke, usePanelVisible } from './hooks'
import { Banner, Btn, LinkBtn, Note, openExternal } from './kit'
import { useNav } from './nav'

/** The permission's status on a Mac (refreshed each time the panel opens); always granted elsewhere. */
export function usePermission(kind: MacPermission): PermissionStatus | null {
  return usePermissionLive(kind)[0]
}

/** Status plus a re-check every 2 seconds while the steps are on screen. */
function usePermissionLive(kind: MacPermission): [PermissionStatus | null, () => void] {
  const [s, reload] = useInvoke<PermissionStatus | null>(IPC_INVOKE.APP_PERMISSION_STATUS, kind)
  const visible = usePanelVisible()
  const view = guideView(s)
  useEffect(() => {
    if (!isMac() || !visible || view !== 'steps') return
    const t = setInterval(reload, 2000)
    return () => clearInterval(t)
  }, [visible, view, reload])
  return [isMac() ? s ?? null : null, reload]
}

export function openPermission(kind: MacPermission): void {
  invoke(IPC_INVOKE.APP_OPEN_PERMISSION, kind).catch(() => {})
}

function Art({ step, label }: { step: Parameters<typeof permissionArt>[0]; label: string }): React.JSX.Element {
  // Static, escaped markup from shared/permission-art.ts (no user data)
  return <div className="pg-art" dangerouslySetInnerHTML={{ __html: permissionArt(step, label) }} />
}

function AllSet({ kind }: { kind: MacPermission }): React.JSX.Element {
  return (
    <>
      <Banner icon="check" style={{ marginBottom: 8 }}>
        <b>{GUIDE_ALL_SET(kind)}</b>
      </Banner>
      <div className="pg-row">
        <Note style={{ margin: 0 }}>{GUIDE_RESTART_HINT}</Note>
        <Btn sm onClick={() => invoke(IPC_INVOKE.APP_RESTART).catch(() => {})}>Restart PeakFlow</Btn>
      </div>
    </>
  )
}

/** The steps for one permission, whatever its state (also used on the Updates page). */
export function GuideSteps({ kind, lost }: { kind: MacPermission; lost: boolean }): React.JSX.Element {
  const copy = guideCopy(kind, lost)
  return (
    <ol className="pg-steps">
      {copy.steps.map((st, i) => (
        <li key={st.art}>
          <div className="pg-text">
            <span className="pg-n">{i + 1}</span>
            <span>{st.text}</span>
          </div>
          <Art step={st.art} label={st.text} />
        </li>
      ))}
    </ol>
  )
}

/**
 * The full guide: what happened, Open Settings, the numbered steps with
 * pictures, and "All set" when it works again. Renders nothing when the
 * permission is fine (or off this Mac).
 */
export function PermissionGuide({ kind }: { kind: MacPermission }): React.JSX.Element | null {
  const [s] = usePermissionLive(kind)
  const view = guideView(s)
  if (!s || view === 'none') return null
  if (view === 'all-set') return <div className="pg"><AllSet kind={kind} /></div>
  const copy = guideCopy(kind, s.lost)
  return (
    <div className="pg">
      <div className="pg-title">{copy.title}</div>
      <Note style={{ margin: '4px 0 10px', color: 'var(--text-2)' }}>{copy.intro}</Note>
      <Btn primary block onClick={() => openPermission(kind)}>
        Open Settings
      </Btn>
      <GuideSteps kind={kind} lost={s.lost} />
      <Note style={{ marginTop: 10 }}>{GUIDE_WATCHING}</Note>
      <LinkBtn style={{ marginTop: 6 }} onClick={() => openExternal(PERMISSION_GUIDE_URL)}>
        Show me on the website
      </LinkBtn>
    </div>
  )
}

/**
 * Inside a tool: one line on what's wrong, Show me how (the full guide) and
 * Open Settings. `onlyIfLost`: only after an update made macOS forget it
 * (QuickBoard works without it, so it doesn't ask new customers here).
 */
export function PermissionNotice({ kind, why, onlyIfLost }: { kind: MacPermission; why: string; onlyIfLost?: boolean }): React.JSX.Element | null {
  const [s] = usePermissionLive(kind)
  const nav = useNav()
  const view = guideView(s)
  if (!s || view === 'none') return null
  if (onlyIfLost && view === 'steps' && !s.lost) return null
  if (view === 'all-set') return <div className="pg" style={{ marginBottom: 14 }}><AllSet kind={kind} /></div>
  const copy = guideCopy(kind, s.lost)
  return (
    <div className="pg pg-compact" style={{ marginBottom: 14 }}>
      <Banner icon="shield">
        <b>{copy.title}</b>
        <br />
        {why} {kind === 'accessibility' ? 'Fixing it takes 4 steps in System Settings.' : 'Fixing it takes one step in System Settings.'}
      </Banner>
      <div className="pg-row" style={{ marginTop: 8 }}>
        <Btn style={{ flex: 1 }} onClick={() => nav.go('app/setup')}>
          Show me how
        </Btn>
        <Btn primary style={{ flex: 1 }} onClick={() => openPermission(kind)}>
          Open Settings
        </Btn>
      </div>
    </div>
  )
}
