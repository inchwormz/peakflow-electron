/**
 * LiquidFocus Service — Pomodoro timer state management.
 *
 * The timer runs in the main process so it continues even if the
 * renderer window is closed. Tasks and session data are persisted
 * via electron-store.
 *
 * Direct port of Python LiquidFocusApp timer + task + stats logic
 * from liquid_focus_v2.py.
 */

import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { ToolId } from '@shared/tool-ids'
import { IPC_SEND } from '@shared/ipc-types'
import { getConfig } from './config-store'
import type { LiquidFocusConfig } from '@shared/config-schemas'

// ─── Types ──────────────────────────────────────────────────────────────────

export type TimerMode = 'work' | 'short_break' | 'long_break'
export type TimerStatus = 'idle' | 'running' | 'paused'

export interface TimerState {
  mode: TimerMode
  status: TimerStatus
  /** Seconds remaining in current phase */
  remaining: number
  /** Total seconds for current phase */
  total: number
  /** Completed pomodoros in current cycle */
  pomodorosCompleted: number
  /** Sessions before long break (from config) */
  sessionsBeforeLong: number
  /** Active task index (-1 = none) */
  activeTaskIndex: number
}

export interface LiquidFocusTask {
  id: string
  name: string
  category: string
  estimated: number
  actual: number
  due: string | null
  done: boolean
  createdAt: number
  todoistId?: string
}

export interface SessionStats {
  /** Timestamps of completed focus sessions (seconds since epoch) */
  timeline: number[]
  /** Total interruptions detected */
  interruptions: number
  /** Daily breakdown for last 7 days: { date: string, count: number }[] */
  dailyBreakdown: { date: string; count: number }[]
  /** Current streak in days */
  streak: number
  /** Sessions completed today */
  today: number
  /** Total sessions all time */
  allTime: number
}

export interface LiquidFocusFullState {
  timer: TimerState
  tasks: LiquidFocusTask[]
  stats: SessionStats
}

// ─── Service ────────────────────────────────────────────────────────────────

class LiquidFocusService {
  private store: Store
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private mode: TimerMode = 'work'
  private status: TimerStatus = 'idle'
  private remaining = 25 * 60
  private total = 25 * 60
  private pomodorosCompleted = 0
  private activeTaskIndex = -1

  constructor() {
    this.store = new Store({ name: 'liquidfocus-data', clearInvalidConfig: true })
    this.initFromConfig()
  }

  /** Load config and set initial timer duration + restore persisted cycle state */
  private initFromConfig(): void {
    const cfg = this.getConfigSafe()
    this.total = cfg.work_duration * 60
    this.remaining = this.total

    // Restore cycle state from persistent store
    this.pomodorosCompleted = (this.store.get('pomodorosCompleted', 0) as number) || 0
    this.activeTaskIndex = (this.store.get('activeTaskIndex', -1) as number) ?? -1
    // Bounds-check against actual tasks
    const tasks = this.getTasks()
    if (this.activeTaskIndex >= tasks.length) {
      this.activeTaskIndex = -1
    }
  }

  private getConfigSafe(): LiquidFocusConfig {
    try {
      return getConfig(ToolId.LiquidFocus) as LiquidFocusConfig
    } catch {
      return {
        work_duration: 25,
        break_duration: 5,
        long_break_duration: 15,
        sessions_before_long: 4,
        alert_sound: true,
        auto_start_breaks: false,
        focus_detection_enabled: false,
        focus_away_threshold_secs: 5,
        todoist_project_filter: '',
        distraction_sites: []
      }
    }
  }

  // ─── Timer ──────────────────────────────────────────────────────────────

  getState(): LiquidFocusFullState {
    return {
      timer: this.getTimerState(),
      tasks: this.getTasks(),
      stats: this.getStats()
    }
  }

  getTimerState(): TimerState {
    const cfg = this.getConfigSafe()
    return {
      mode: this.mode,
      status: this.status,
      remaining: this.remaining,
      total: this.total,
      pomodorosCompleted: this.pomodorosCompleted,
      sessionsBeforeLong: cfg.sessions_before_long,
      activeTaskIndex: this.activeTaskIndex
    }
  }

  start(): TimerState {
    if (this.status === 'running') return this.getTimerState()

    this.status = 'running'
    this.tickInterval = setInterval(() => this.tick(), 1000)
    this.broadcastState()
    return this.getTimerState()
  }

  pause(): TimerState {
    if (this.status !== 'running') return this.getTimerState()

    this.status = 'paused'
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
    this.broadcastState()
    return this.getTimerState()
  }

  reset(): TimerState {
    this.stopTicking()
    this.status = 'idle'
    this.mode = 'work'
    this.pomodorosCompleted = 0
    this.store.set('pomodorosCompleted', 0)
    const cfg = this.getConfigSafe()
    this.total = cfg.work_duration * 60
    this.remaining = this.total
    this.broadcastState()
    return this.getTimerState()
  }

  skip(): TimerState {
    this.stopTicking()
    this.finishPhase()
    return this.getTimerState()
  }

  /** Reload durations from config. Called when settings change. */
  refreshConfig(): void {
    const cfg = this.getConfigSafe()
    // Only update durations if the timer is idle (not mid-session)
    if (this.status === 'idle') {
      if (this.mode === 'work') {
        this.total = cfg.work_duration * 60
        this.remaining = this.total
      } else if (this.mode === 'short_break') {
        this.total = cfg.break_duration * 60
        this.remaining = this.total
      } else if (this.mode === 'long_break') {
        this.total = cfg.long_break_duration * 60
        this.remaining = this.total
      }
      this.broadcastState()
    }
  }

  setActiveTask(index: number): void {
    this.activeTaskIndex = index
    this.store.set('activeTaskIndex', index)
    this.broadcastState()
  }

  private tick(): void {
    this.remaining--
    if (this.remaining <= 0) {
      this.remaining = 0
      this.finishPhase()
    } else {
      this.broadcastState()
    }
  }

  private finishPhase(): void {
    this.stopTicking()
    this.status = 'idle'

    if (this.mode === 'work') {
      // Completed a focus session
      this.pomodorosCompleted++
      this.store.set('pomodorosCompleted', this.pomodorosCompleted)
      this.recordSession()

      // Update active task
      const tasks = this.getTasks()
      if (this.activeTaskIndex >= 0 && this.activeTaskIndex < tasks.length) {
        tasks[this.activeTaskIndex].actual++
        this.saveTasks(tasks)
      }

      // Determine break type
      const cfg = this.getConfigSafe()
      const interval = Math.max(1, cfg.sessions_before_long)
      if (this.pomodorosCompleted % interval === 0) {
        this.mode = 'long_break'
        this.total = cfg.long_break_duration * 60
      } else {
        this.mode = 'short_break'
        this.total = cfg.break_duration * 60
      }
      this.remaining = this.total

      // Play sound notification
      this.notifyPhaseComplete('work')

      // Auto-start breaks if enabled
      if (cfg.auto_start_breaks) {
        this.start()
      }
    } else {
      // Break is over, back to work
      const cfg = this.getConfigSafe()
      this.mode = 'work'
      this.total = cfg.work_duration * 60
      this.remaining = this.total
      this.notifyPhaseComplete('break')

      // Auto-start next work session if auto-start is enabled
      if (cfg.auto_start_breaks) {
        this.start()
      }
    }

    this.broadcastState()
  }

  private stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
  }

  private notifyPhaseComplete(phase: 'work' | 'break'): void {
    const cfg = this.getConfigSafe()
    if (!cfg.alert_sound) return

    // Send notification to renderer to play sound
    // (Audio API is only available in renderer context)
    this.broadcast(IPC_SEND.LIQUIDFOCUS_PHASE_COMPLETE, phase)
  }

  private recordSession(): void {
    const timeline: number[] = this.store.get('timeline', []) as number[]
    timeline.push(Math.floor(Date.now() / 1000))
    this.store.set('timeline', timeline)
  }

  // ─── Tasks ──────────────────────────────────────────────────────────────

  getTasks(): LiquidFocusTask[] {
    return (this.store.get('tasks', []) as LiquidFocusTask[])
  }

  addTask(task: Omit<LiquidFocusTask, 'id' | 'createdAt'>): LiquidFocusTask[] {
    const tasks = this.getTasks()
    const newTask: LiquidFocusTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now()
    }
    tasks.push(newTask)
    this.saveTasks(tasks)

    // Auto-select if first task
    if (tasks.filter((t) => !t.done).length === 1) {
      this.activeTaskIndex = tasks.length - 1
      this.store.set('activeTaskIndex', this.activeTaskIndex)
    }

    return tasks
  }

  updateTask(taskId: string, updates: Partial<LiquidFocusTask>): LiquidFocusTask[] {
    const tasks = this.getTasks()
    const idx = tasks.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], ...updates }
      this.saveTasks(tasks)
    }
    return tasks
  }

  deleteTask(taskId: string): LiquidFocusTask[] {
    const tasks = this.getTasks()
    const idx = tasks.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      tasks.splice(idx, 1)
      // Adjust active task index
      if (this.activeTaskIndex === idx) {
        this.activeTaskIndex = -1
      } else if (this.activeTaskIndex > idx) {
        this.activeTaskIndex--
      }
      this.store.set('activeTaskIndex', this.activeTaskIndex)
      this.saveTasks(tasks)
    }
    return tasks
  }

  private saveTasks(tasks: LiquidFocusTask[]): void {
    this.store.set('tasks', tasks)
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats(): SessionStats {
    const timeline: number[] = this.store.get('timeline', []) as number[]
    const interruptions: number = this.store.get('interruptions', 0) as number

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayTs = Math.floor(todayStart.getTime() / 1000)

    // Today count
    const today = timeline.filter((ts) => ts >= todayTs).length

    // Daily breakdown (last 7 days)
    const dailyBreakdown: { date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const dayStart = Math.floor(d.getTime() / 1000)
      const dayEnd = dayStart + 86400
      const count = timeline.filter((ts) => ts >= dayStart && ts < dayEnd).length
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dailyBreakdown.push({ date: dateStr, count })
    }

    // Streak
    let streak = 0
    const daySet = new Set<string>()
    for (const ts of timeline) {
      const d = new Date(ts * 1000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      daySet.add(key)
    }

    const checkDate = new Date(now)
    checkDate.setHours(0, 0, 0, 0)
    // If no sessions today yet, start streak check from yesterday
    const todayKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`
    if (!daySet.has(todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1)
    }
    for (let i = 0; i < 366; i++) {
      const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`
      if (daySet.has(key)) {
        streak++
      } else {
        break
      }
      checkDate.setDate(checkDate.getDate() - 1)
    }

    return {
      timeline,
      interruptions,
      dailyBreakdown,
      streak,
      today,
      allTime: timeline.length
    }
  }

  /**
   * Record a focus interruption detected by the webcam FocusDetector.
   * Increments the persistent interruption counter and broadcasts updated stats.
   */
  recordInterruption(): void {
    const current: number = this.store.get('interruptions', 0) as number
    this.store.set('interruptions', current + 1)
    console.log(`[LiquidFocus] Interruption recorded (total: ${current + 1})`)
    this.broadcastState()
  }

  // ─── Broadcasting ───────────────────────────────────────────────────────

  private broadcastState(): void {
    this.broadcast(IPC_SEND.LIQUIDFOCUS_STATE_CHANGED, {
      timer: this.getTimerState(),
      tasks: this.getTasks(),
      stats: this.getStats()
    })
  }

  private broadcast(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send(channel, data)
        } catch {
          // Window may be closing
        }
      }
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  destroy(): void {
    this.stopTicking()
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let service: LiquidFocusService | null = null

export function initLiquidFocus(): void {
  if (service) return
  service = new LiquidFocusService()
  console.log('[PeakFlow] LiquidFocus service initialized')
}

export function getLiquidFocusService(): LiquidFocusService {
  if (!service) {
    service = new LiquidFocusService()
  }
  return service
}

export function destroyLiquidFocus(): void {
  if (service) {
    service.destroy()
    service = null
    console.log('[PeakFlow] LiquidFocus service destroyed')
  }
}
