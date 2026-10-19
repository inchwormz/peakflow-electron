/**
 * Small hooks the panel's tool screens share: IPC calls, push events,
 * tool config, panel visibility and real app icons.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { AppIconQuery } from '@shared/ipc-types'
import type { ToolId } from '@shared/tool-ids'

export function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return window.peakflow.invoke(channel, ...args) as Promise<T>
}

// One IPC listener per channel, shared by every component that subscribes
// (a screen can hold a dozen useInvoke hooks, each watching panel visibility)
const subscribers = new Map<string, { cbs: Set<(...a: unknown[]) => void>; off: () => void }>()

function subscribe(channel: string, cb: (...a: unknown[]) => void): () => void {
  let entry = subscribers.get(channel)
  if (!entry) {
    const cbs = new Set<(...a: unknown[]) => void>()
    entry = { cbs, off: window.peakflow.on(channel, (...a: unknown[]) => cbs.forEach((f) => f(...a))) }
    subscribers.set(channel, entry)
  }
  entry.cbs.add(cb)
  return () => {
    const e = subscribers.get(channel)
    if (!e) return
    e.cbs.delete(cb)
    if (e.cbs.size === 0) {
      e.off()
      subscribers.delete(channel)
    }
  }
}

/** Subscribe to a main → renderer push channel for the component's lifetime. */
export function useIpcEvent(channel: string, cb: (...args: unknown[]) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => subscribe(channel, (...a: unknown[]) => ref.current(...a)), [channel])
}

/** True while the panel is on screen. Tools use it to refresh when it opens. */
export function usePanelVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useIpcEvent(IPC_SEND.PANEL_VISIBILITY, (v) => setVisible(!!v))
  return visible
}

/**
 * Invoke a channel once on mount (and again on `reload()` / when the panel
 * re-opens). Returns undefined until the first answer arrives.
 */
export function useInvoke<T>(channel: string, ...args: unknown[]): [T | undefined, () => void, (v: T) => void] {
  const [data, setData] = useState<T | undefined>(undefined)
  const visible = usePanelVisible()
  const key = JSON.stringify(args)
  const load = useCallback(() => {
    invoke<T>(channel, ...(JSON.parse(key) as unknown[]))
      .then((v) => setData(v))
      .catch((err) => console.warn(`[Panel] ${channel} failed:`, err))
  }, [channel, key])
  useEffect(() => {
    if (visible) load()
  }, [load, visible])
  return [data, load, setData]
}

/**
 * A tool's config (src/shared/config-schemas.ts) with an optimistic setter
 * that persists through CONFIG_SET.
 */
export function useToolConfig<T extends object>(tool: ToolId): [T | null, <K extends keyof T>(key: K, value: T[K]) => void, () => void] {
  const [cfg, setCfg] = useState<T | null>(null)
  const visible = usePanelVisible()
  const load = useCallback(() => {
    invoke<T | null>(IPC_INVOKE.CONFIG_GET, { tool })
      .then((c) => setCfg(c))
      .catch(() => {})
  }, [tool])
  useEffect(() => {
    if (visible) load()
  }, [load, visible])
  const set = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setCfg((prev) => (prev ? { ...prev, [key]: value } : prev))
      invoke(IPC_INVOKE.CONFIG_SET, { tool, key: key as string, value }).catch(() => load())
    },
    [tool, load]
  )
  return [cfg, set, load]
}

const iconCache = new Map<string, string | null>()
const iconWaiters = new Map<string, Promise<string | null>>()

/** A real app icon from the OS (data URL), or null while loading / when there is none. */
export function useAppIcon(q: AppIconQuery | null | undefined): string | null {
  const key = q ? JSON.stringify([q.bundleId ?? '', q.name ?? '', q.path ?? '', q.url ?? '']) : ''
  const [src, setSrc] = useState<string | null>(() => (key ? iconCache.get(key) ?? null : null))
  useEffect(() => {
    if (!key || !q) {
      setSrc(null)
      return
    }
    if (iconCache.has(key)) {
      setSrc(iconCache.get(key) ?? null)
      return
    }
    let alive = true
    let p = iconWaiters.get(key)
    if (!p) {
      p = invoke<string | null>(IPC_INVOKE.APP_GET_ICON, q).catch(() => null)
      iconWaiters.set(key, p)
    }
    p.then((v) => {
      iconCache.set(key, v)
      iconWaiters.delete(key)
      if (alive) setSrc(v)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return src
}

export const isMac = (): boolean => window.peakflow.platform === 'darwin'

/** 'CommandOrControl+Shift+V' → '⌘⇧V' on macOS, 'Ctrl+Shift+V' elsewhere. */
export function formatAccelerator(accel: string): string {
  if (!accel) return ''
  const parts = accel.split('+').map((p) => p.trim())
  if (!isMac()) {
    return parts
      .map((p) => {
        const l = p.toLowerCase()
        if (l === 'commandorcontrol' || l === 'cmdorctrl' || l === 'control' || l === 'ctrl') return 'Ctrl'
        if (l === 'alt' || l === 'option') return 'Alt'
        return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
      })
      .join('+')
  }
  const order = ['⌃', '⌥', '⇧', '⌘']
  const mods: string[] = []
  let key = ''
  for (const p of parts) {
    const l = p.toLowerCase()
    if (l === 'commandorcontrol' || l === 'cmdorctrl' || l === 'command' || l === 'cmd' || l === 'meta' || l === 'super') mods.push('⌘')
    else if (l === 'control' || l === 'ctrl') mods.push('⌃')
    else if (l === 'alt' || l === 'option') mods.push('⌥')
    else if (l === 'shift') mods.push('⇧')
    else if (l === 'up') key = '↑'
    else if (l === 'down') key = '↓'
    else if (l === 'left') key = '←'
    else if (l === 'right') key = '→'
    else if (l === 'space') key = 'Space'
    else key = p.length === 1 ? p.toUpperCase() : p
  }
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return mods.join('') + key
}

/** Minutes/seconds as 25:00. */
export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
