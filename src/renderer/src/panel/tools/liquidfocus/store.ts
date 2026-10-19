/**
 * Liquid Focus shared state for the v2 panel and the mini timer window.
 *
 * The timer lives in the main process (src/main/services/liquidfocus.ts) and
 * pushes LIQUIDFOCUS_STATE_CHANGED to every window each second. One small
 * store per renderer keeps the panel's screens, its header status, the
 * Background component and the mini window on the same numbers.
 */

import { useSyncExternalStore } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { LiquidFocusTask, SessionStats, TimerState } from '../../../tools/liquidfocus/LiquidFocus'

export type { LiquidFocusTask, SessionStats, TimerState }

export interface LFState {
  timer: TimerState
  tasks: LiquidFocusTask[]
  stats: SessionStats
  workDurationMinutes: number
}

function createStore<T>(initial: T): { get: () => T; set: (v: T) => void; sub: (l: () => void) => () => void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      listeners.forEach((l) => l())
    },
    sub: (l: () => void) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    }
  }
}

/* ─── timer, tasks, stats ────────────────────────────────────────────────── */

const lfStore = createStore<LFState | null>(null)
let started = false

const call = <T,>(channel: string, ...args: unknown[]): Promise<T> => window.peakflow.invoke(channel, ...args) as Promise<T>

/** Re-read everything from the main process. */
export function refreshLF(): void {
  call<LFState>(IPC_INVOKE.LIQUIDFOCUS_GET_STATE)
    .then((s) => {
      if (s?.timer) lfStore.set(s)
    })
    .catch(() => {})
}

function ensureStarted(): void {
  if (started) return
  started = true
  window.peakflow.on(IPC_SEND.LIQUIDFOCUS_STATE_CHANGED, (data: unknown) => {
    const u = data as Partial<LFState> | null
    if (!u?.timer) return
    const prev = lfStore.get()
    if (!prev) {
      refreshLF()
      return
    }
    lfStore.set({ ...prev, timer: u.timer, tasks: u.tasks ?? prev.tasks, stats: u.stats ?? prev.stats })
  })
  refreshLF()
}

export function useLF(): LFState | null {
  ensureStarted()
  return useSyncExternalStore(lfStore.sub, lfStore.get)
}

/** Task IPC calls return the new list but don't broadcast; patch it in here. */
export function setTasks(tasks: LiquidFocusTask[]): void {
  const prev = lfStore.get()
  if (prev && Array.isArray(tasks)) lfStore.set({ ...prev, tasks })
}

export function patchTimer(timer: TimerState | null | undefined): void {
  const prev = lfStore.get()
  if (prev && timer?.mode) lfStore.set({ ...prev, timer })
}

/* ─── timer actions ──────────────────────────────────────────────────────── */

export const lfStart = (): Promise<void> => call<TimerState>(IPC_INVOKE.LIQUIDFOCUS_START).then(patchTimer).catch(() => {})
export const lfPause = (): Promise<void> => call<TimerState>(IPC_INVOKE.LIQUIDFOCUS_PAUSE).then(patchTimer).catch(() => {})
/** "Stop": the service's reset (back to a fresh focus session, cycle count cleared). */
export const lfStop = (): Promise<void> => call<TimerState>(IPC_INVOKE.LIQUIDFOCUS_RESET).then(patchTimer).catch(() => {})
/** Ends the current phase now (a skipped focus session still counts, as before). */
export const lfSkip = (): Promise<void> => call<TimerState>(IPC_INVOKE.LIQUIDFOCUS_SKIP).then(patchTimer).catch(() => {})
/** "Reset": restart the current phase from its full length. */
export const lfRestart = (): Promise<void> => call<TimerState>(IPC_INVOKE.LIQUIDFOCUS_RESTART_PHASE).then(patchTimer).catch(() => {})

export const setMini = (open: boolean, card = false): void => {
  call(IPC_INVOKE.LIQUIDFOCUS_SET_MINI, open ? { open: true, card } : { open: false }).catch(() => {})
}

/** Start (or resume) the timer, hide the panel and show the mini timer. */
export async function startAndMinimise(nav: { hide: () => void }): Promise<void> {
  await lfStart()
  nav.hide()
  setMini(true)
}

/** Click a task: make it active, then the Start flow (the old handleSelectTask). */
export async function pickTaskAndStart(nav: { hide: () => void }, index: number): Promise<void> {
  await call(IPC_INVOKE.LIQUIDFOCUS_SET_ACTIVE_TASK, index).catch(() => {})
  await startAndMinimise(nav)
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

export function activeTask(s: LFState | null): LiquidFocusTask | null {
  if (!s) return null
  const i = s.timer.activeTaskIndex
  return i >= 0 && i < s.tasks.length ? s.tasks[i] : null
}

export const modeLabel = (t: TimerState): string =>
  t.mode === 'work' ? 'FOCUS' : t.mode === 'short_break' ? 'SHORT BREAK' : 'LONG BREAK'

export const isActive = (t: TimerState | undefined): boolean => !!t && (t.status === 'running' || t.status === 'paused')

/** Fraction of the current phase done (0 while idle). */
export const phaseFrac = (t: TimerState): number => (isActive(t) && t.total > 0 ? 1 - t.remaining / t.total : 0)

/** Filled session dots in the current cycle. */
export function cycleDots(t: TimerState): boolean[] {
  const n = Math.max(1, Math.min(12, t.sessionsBeforeLong || 4))
  const done = t.pomodorosCompleted % n
  return Array.from({ length: n }, (_, i) => i < done)
}

/* ─── focus detector (runs in the panel's Background) ────────────────────── */

export type DetectorStatus = 'off' | 'loading' | 'focused' | 'away' | 'no-camera' | 'error'

export interface DetectorState {
  status: DetectorStatus
  /** Away episodes this session (each one is recorded as an interruption). */
  distractions: number
  /** The last camera attempt failed with no camera / no access. */
  noCamera: boolean
}

export const detectorStore = createStore<DetectorState>({ status: 'off', distractions: 0, noCamera: false })

export function useDetector(): DetectorState {
  return useSyncExternalStore(detectorStore.sub, detectorStore.get)
}

export function detectorLabel(d: DetectorState): string {
  const n = d.distractions
  const tail = n > 0 ? ` · ${n} distraction${n === 1 ? '' : 's'}` : ''
  switch (d.status) {
    case 'loading':
      return 'Starting…'
    case 'focused':
      return `Focused${tail}`
    case 'away':
      return `Looking away${tail}`
    case 'no-camera':
      return 'No camera'
    case 'error':
      return 'Camera error'
    default:
      return ''
  }
}

/* ─── Todoist import (shared by the Tasks page and its header link) ──────── */

export const importStore = createStore<boolean>(false)
export const useImporting = (): boolean => useSyncExternalStore(importStore.sub, importStore.get)

interface TodoistTaskLite {
  id: string
  content: string
  dueDate: string | null
}

/**
 * Import open Todoist tasks that aren't already here (as the old TaskList did:
 * project filter from config, category "Todoist", 1 pomodoro). Returns the
 * number added, or null when Todoist isn't connected.
 */
export async function importFromTodoist(): Promise<number | null> {
  if (importStore.get()) return 0
  importStore.set(true)
  try {
    const status = await call<{ connected: boolean }>(IPC_INVOKE.TODOIST_GET_STATUS)
    if (!status?.connected) return null
    const cfg = await call<{ todoist_project_filter?: string } | null>(IPC_INVOKE.CONFIG_GET, { tool: 'liquidfocus' })
    const list = await call<TodoistTaskLite[]>(IPC_INVOKE.TODOIST_GET_TASKS, cfg?.todoist_project_filter || undefined)
    const have = new Set((lfStore.get()?.tasks ?? []).filter((t) => t.todoistId).map((t) => t.todoistId))
    let added = 0
    for (const tt of list ?? []) {
      if (have.has(tt.id)) continue
      have.add(tt.id)
      const tasks = await call<LiquidFocusTask[]>(IPC_INVOKE.LIQUIDFOCUS_ADD_TASK, {
        name: tt.content,
        category: 'Todoist',
        estimated: 1,
        actual: 0,
        due: tt.dueDate || null,
        done: false,
        todoistId: tt.id
      })
      setTasks(tasks)
      added++
    }
    return added
  } catch (err) {
    console.warn('[LiquidFocus] Todoist import failed:', err)
    return 0
  } finally {
    importStore.set(false)
  }
}
