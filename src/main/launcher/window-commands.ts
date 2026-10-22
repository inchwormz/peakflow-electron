/**
 * Window commands ("left half", "next screen" …) are SnapGrid's job. The
 * launcher lists them only once a handler is registered, so nothing broken
 * shows before SnapGrid is in the build. After the merge SnapGrid registers:
 *
 *   setWindowCommandHandler((key) => getSnapGridService().applyLayout(key as SnapLayoutKey))
 *
 * The keys match SnapGrid's SnapLayoutKey; the promise resolves to the short
 * message SnapGrid shows (e.g. "Click the window you want to move first").
 */

import type { LauncherItem } from '@shared/launcher/types'

type Handler = (key: string) => Promise<string>
let handler: Handler | null = null

export function setWindowCommandHandler(fn: Handler | null): void {
  handler = fn
}

const LAYOUTS: Array<[string, string, string[]?]> = [
  ['left', 'Left half', ['snap left', 'split']],
  ['right', 'Right half', ['snap right', 'split']],
  ['top', 'Top half'],
  ['bottom', 'Bottom half'],
  ['fill', 'Maximise', ['fill screen', 'maximize', 'full screen', 'fullscreen']],
  ['centre', 'Centre window', ['center']],
  ['next', 'Move to next screen', ['next display', 'other monitor']],
  ['t1', 'Left third'],
  ['t2', 'Centre third', ['center third']],
  ['t3', 'Right third'],
  ['tt1', 'Left two-thirds'],
  ['tt2', 'Right two-thirds'],
  ['tl', 'Top left quarter'],
  ['tr', 'Top right quarter'],
  ['bl', 'Bottom left quarter'],
  ['br', 'Bottom right quarter']
]

export function windowItems(): LauncherItem[] {
  if (!handler) return []
  return LAYOUTS.map(([key, title, keywords]) => ({
    id: `window:${key}`,
    kind: 'window' as const,
    title,
    subtitle: 'Move the window you were in',
    keywords: ['window', 'snap', ...(keywords ?? [])],
    glyph: 'window' as const,
    tag: 'SnapGrid'
  }))
}

export async function runWindowCommand(id: string): Promise<string | null> {
  const key = id.replace(/^window:/, '')
  if (!handler || !LAYOUTS.some((l) => l[0] === key)) return null
  return handler(key)
}
