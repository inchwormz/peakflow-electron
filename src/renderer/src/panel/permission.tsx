/**
 * One permission notice for every panel screen (review S1). The words come
 * from shared/mac-permissions.ts through the main process, which knows when a
 * permission was granted before and an update made macOS forget it.
 */

import { IPC_INVOKE } from '@shared/ipc-types'
import type { MacPermission, PermissionStatus } from '@shared/mac-permissions'
import { PERMISSION_LABEL } from '@shared/mac-permissions'
import { invoke, isMac, useInvoke } from './hooks'
import { Banner, Btn } from './kit'

/** The permission's status on a Mac (refreshed each time the panel opens); always granted elsewhere. */
export function usePermission(kind: MacPermission): PermissionStatus | null {
  const [s] = useInvoke<PermissionStatus | null>(IPC_INVOKE.APP_PERMISSION_STATUS, kind)
  if (!isMac()) return null
  return s ?? null
}

export function openPermission(kind: MacPermission): void {
  invoke(IPC_INVOKE.APP_OPEN_PERMISSION, kind).catch(() => {})
}

/** Shown when a tool needs a permission it doesn't have: why, the fix, and a button to the pane. */
export function PermissionNotice({ kind, why }: { kind: MacPermission; why: string }): React.JSX.Element | null {
  const s = usePermission(kind)
  if (!s || s.granted) return null
  return (
    <>
      <Banner icon="shield">
        <b>{s.lost ? `macOS forgot PeakFlow’s ${PERMISSION_LABEL[kind]} access` : `Needs ${PERMISSION_LABEL[kind]} access`}</b>
        <br />
        {why} {s.advice}
      </Banner>
      <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => openPermission(kind)}>
        Open System Settings
      </Btn>
    </>
  )
}
