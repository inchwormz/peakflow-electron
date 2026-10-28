/**
 * Shared types for the v2 one-app panel.
 *
 * Routes are plain strings like 'quickboard' or 'quickboard/settings/general'
 * (the same paths the approved prototype uses). A route key may contain
 * ':params', e.g. 'quickboard/edit/:id'.
 */

import type { ComponentType, ReactNode } from 'react'
import type { IconName } from './icons'

export type PanelToolId = 'focusdim' | 'liquidfocus' | 'screenslap' | 'quickboard' | 'snapgrid' | 'dictation' | 'caffeine'

export type RouteParams = Record<string, string>

/** A tool's main screen: the header shows the switcher and the tool's status. */
export interface ToolRoute {
  kind: 'tool'
  tool: PanelToolId
  view: ComponentType<{ params: RouteParams }>
  /** Use the tight padding (6px 8px) for edge-to-edge lists. */
  flush?: boolean
}

/** A drill-in page: the header shows a back arrow and a title. */
export interface SubRoute {
  kind: 'sub'
  /** Route the back arrow goes to. */
  back: string
  title: string | ((params: RouteParams) => string)
  view: ComponentType<{ params: RouteParams }>
  /** Small grey text or a link on the right of the header. */
  right?: ComponentType<{ params: RouteParams }>
  flush?: boolean
}

export type RouteDef = ToolRoute | SubRoute
export type RouteTable = Record<string, RouteDef>

export interface PanelToolModule {
  id: PanelToolId
  name: string
  desc: string
  icon: IconName
  /** Hook (always called): the plain grey status text for the header and switcher, e.g. 'On · 60%'. */
  useStatus: () => string
  /** Must include the main route `<id>` and `<id>/settings`. */
  routes: RouteTable
  /** No trial or licence screen (Dictation keeps the free launcher's access rule). */
  ungated?: boolean
  /** Optional always-mounted component (sounds, camera detector) that lives while the panel is hidden. */
  Background?: ComponentType
}

export interface DialogButton {
  label: string
  value: string
  primary?: boolean
}

export interface DialogSpec {
  icon?: IconName
  title: string
  body?: ReactNode
  buttons: DialogButton[]
}
