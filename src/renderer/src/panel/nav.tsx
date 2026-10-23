/**
 * Panel navigation, toasts and confirm dialogs, shared through React context.
 */

import { createContext, useContext } from 'react'
import type { DialogSpec, RouteParams } from './types'

export interface NavApi {
  /** Current route path, e.g. 'quickboard/settings/general'. */
  route: string
  params: RouteParams
  go: (route: string) => void
  /** Go to the current page's back route (or the tool's main screen). */
  back: () => void
  /** Hide the panel (it stays alive in the background). */
  hide: () => void
  /** Show a short black-on-white toast at the bottom of the panel. */
  toast: (msg: string) => void
  /** Show a centred confirm dialog; resolves with the clicked button's value, or null on Esc. */
  confirm: (spec: DialogSpec) => Promise<string | null>
}

export const NavContext = createContext<NavApi | null>(null)

export function useNav(): NavApi {
  const nav = useContext(NavContext)
  if (!nav) throw new Error('useNav outside the panel')
  return nav
}

/** Match 'quickboard/edit/abc' against keys like 'quickboard/edit/:id'. */
export function matchRoute<T>(table: Record<string, T>, path: string): { key: string; def: T; params: RouteParams } | null {
  if (table[path]) return { key: path, def: table[path], params: {} }
  const parts = path.split('/')
  for (const key of Object.keys(table)) {
    if (!key.includes(':')) continue
    const kp = key.split('/')
    if (kp.length !== parts.length) continue
    const params: RouteParams = {}
    let ok = true
    for (let i = 0; i < kp.length; i++) {
      if (kp[i].startsWith(':')) params[kp[i].slice(1)] = decodeURIComponent(parts[i])
      else if (kp[i] !== parts[i]) {
        ok = false
        break
      }
    }
    if (ok) return { key, def: table[key], params }
  }
  return null
}
