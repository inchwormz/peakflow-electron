/**
 * LiquidFocus — Main component with nav and view switching.
 *
 * Dark cinematic design system (NOT neo-brutalist):
 *   - #0a0a0a background, Be Vietnam Pro font
 *   - Green (#4ae08a) / Blue (#5eb8ff) accents
 *   - Glassmorphism card with ambient glow
 *
 * Views: Timer (default), Tasks, Stats, Settings
 *
 * Timer state lives in main process; this component subscribes
 * to IPC_SEND.LIQUIDFOCUS_STATE_CHANGED for real-time updates.
 */

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { TitleBar } from '../../components/layout/TitleBar'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import { TimerView } from './TimerView'
import { TaskList } from './TaskList'
import { StatsView } from './StatsView'
import { SettingsView } from './SettingsView'

// ─── Design Tokens ──────────────────────────────────────────────────────────

export const DS = {
  bg: '#0a0a0a',
  bgCard: 'rgba(10, 10, 10, 0.5)',
  surface: '#111111',
  surface2: '#141414',
  elevated: '#1a1a1a',
  border: '#1a1a1a',
  borderLight: '#222222',
  borderInput: 'rgba(255, 255, 255, 0.1)',
  borderInputBg: 'rgba(255, 255, 255, 0.05)',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.6)',
  textDim: 'rgba(255, 255, 255, 0.5)',
  textLabel: 'rgba(255, 255, 255, 0.4)',
  textGhost: '#222222',
  accent: '#ffe17c',
  blue: '#5eb8ff',
  red: '#f05858',
  orange: '#FF7043',
  amber: '#eab308',
  white: '#ffffff'
} as const

// ─── Shared Types ───────────────────────────────────────────────────────────

export type ViewName = 'timer' | 'tasks' | 'stats' | 'settings'

export interface TimerState {
  mode: 'work' | 'short_break' | 'long_break'
  status: 'idle' | 'running' | 'paused'
  remaining: number
  total: number
  pomodorosCompleted: number
  sessionsBeforeLong: number
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
  timeline: number[]
  interruptions: number
  dailyBreakdown: { date: string; count: number }[]
  streak: number
  today: number
  allTime: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LiquidFocus(): React.JSX.Element {
  const [view, setView] = useState<ViewName>('timer')
  const [timer, setTimer] = useState<TimerState>({
    mode: 'work',
    status: 'idle',
    remaining: 25 * 60,
    total: 25 * 60,
    pomodorosCompleted: 0,
    sessionsBeforeLong: 4,
    activeTaskIndex: -1
  })
  const [tasks, setTasks] = useState<LiquidFocusTask[]>([])
  const [stats, setStats] = useState<SessionStats>({
    timeline: [],
    interruptions: 0,
    dailyBreakdown: [],
    streak: 0,
    today: 0,
    allTime: 0
  })
  const [workDurationMinutes, setWorkDurationMinutes] = useState(25)
  const [focusDetectionEnabled, setFocusDetectionEnabled] = useState(false)
  const [focusAwayThresholdSecs, setFocusAwayThresholdSecs] = useState(5)

  // ── Load initial state from main ──────────────────────────────────────

  const loadState = useCallback(async () => {
    try {
      const state = (await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_GET_STATE)) as {
        timer: TimerState
        tasks: LiquidFocusTask[]
        stats: SessionStats
        workDurationMinutes?: number
      }
      if (state) {
        setTimer(state.timer)
        setTasks(state.tasks)
        setStats(state.stats)
        if (state.workDurationMinutes) setWorkDurationMinutes(state.workDurationMinutes)
      }
    } catch (err) {
      console.warn('[LiquidFocus] Failed to load state:', err)
    }
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  // ── Load focus detection config ─────────────────────────────────────

  const loadFocusConfig = useCallback(() => {
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.LiquidFocus })
      .then((cfg) => {
        if (cfg && typeof cfg === 'object') {
          const c = cfg as Record<string, unknown>
          if (typeof c.focus_detection_enabled === 'boolean') {
            setFocusDetectionEnabled(c.focus_detection_enabled)
          }
          if (typeof c.focus_away_threshold_secs === 'number') {
            setFocusAwayThresholdSecs(c.focus_away_threshold_secs)
          }
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadFocusConfig()
  }, [loadFocusConfig])

  // Reload config when returning from settings
  useEffect(() => {
    if (view === 'timer') {
      loadFocusConfig()
    }
  }, [view, loadFocusConfig])

  // ── Subscribe to state changes from main process ──────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.LIQUIDFOCUS_STATE_CHANGED,
      (data: unknown) => {
        const update = data as { timer: TimerState; tasks?: LiquidFocusTask[]; stats: SessionStats }
        if (update?.timer) setTimer(update.timer)
        if (update?.tasks) setTasks(update.tasks)
        if (update?.stats) setStats(update.stats)
      }
    )
    return unsub
  }, [])

  // ── Subscribe to phase complete for sound alerts ──────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.LIQUIDFOCUS_PHASE_COMPLETE,
      (phase: unknown) => {
        playPhaseSound(phase as string)
        // Re-fetch tasks after a work session completes (task.actual may have changed)
        if (phase === 'work') {
          window.peakflow
            .invoke(IPC_INVOKE.LIQUIDFOCUS_GET_TASKS)
            .then((t) => setTasks(t as LiquidFocusTask[]))
            .catch(() => {})
        }
      }
    )
    return unsub
  }, [])

  // ── Timer controls ────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    const result = (await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_START)) as TimerState
    setTimer(result)
  }, [])

  const handlePause = useCallback(async () => {
    const result = (await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_PAUSE)) as TimerState
    setTimer(result)
  }, [])

  const handleReset = useCallback(async () => {
    const result = (await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_RESET)) as TimerState
    setTimer(result)
  }, [])

  const handleSkip = useCallback(async () => {
    const result = (await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_SKIP)) as TimerState
    setTimer(result)
  }, [])

  const handleToggle = useCallback(() => {
    if (timer.status === 'running') {
      handlePause()
    } else {
      handleStart()
    }
  }, [timer.status, handlePause, handleStart])

  // ── Task operations ───────────────────────────────────────────────────

  const handleAddTask = useCallback(
    async (task: Omit<LiquidFocusTask, 'id' | 'createdAt'>) => {
      const result = (await window.peakflow.invoke(
        IPC_INVOKE.LIQUIDFOCUS_ADD_TASK,
        task
      )) as LiquidFocusTask[]
      setTasks(result)
    },
    []
  )

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: Partial<LiquidFocusTask>) => {
      const result = (await window.peakflow.invoke(
        IPC_INVOKE.LIQUIDFOCUS_UPDATE_TASK,
        taskId,
        updates
      )) as LiquidFocusTask[]
      setTasks(result)

      // Sync completion to Todoist if task has a todoistId
      if (updates.done === true) {
        const task = tasks.find((t) => t.id === taskId)
        if (task?.todoistId) {
          window.peakflow
            .invoke(IPC_INVOKE.TODOIST_COMPLETE_TASK, task.todoistId)
            .catch((err) => console.warn('[LiquidFocus] Todoist sync failed:', err))
        }
      }
    },
    [tasks]
  )

  const handleDeleteTask = useCallback(async (taskId: string) => {
    const result = (await window.peakflow.invoke(
      IPC_INVOKE.LIQUIDFOCUS_DELETE_TASK,
      taskId
    )) as LiquidFocusTask[]
    setTasks(result)
  }, [])

  const handleSelectTask = useCallback(async (index: number) => {
    await window.peakflow.invoke(IPC_INVOKE.LIQUIDFOCUS_SET_ACTIVE_TASK, index)
    setTimer((prev) => ({ ...prev, activeTaskIndex: index }))
    // Auto-start timer (no-op if already running)
    handleStart()
    // Navigate to timer view so user sees countdown with task name
    setView('timer')
  }, [handleStart])

  // ── Render ────────────────────────────────────────────────────────────

  const containerStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: DS.bg,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    color: DS.textPrimary,
    position: 'relative',
    overflow: 'hidden'
  }

  const ambientStyle: CSSProperties = {
    position: 'absolute',
    width: 500,
    height: 500,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${timer.mode === 'work' ? 'rgba(255,112,67,0.15)' : 'rgba(255,225,124,0.12)'} 0%, transparent 70%)`,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: 0
  }

  const contentStyle: CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    zIndex: 1,
    overflow: 'hidden'
  }

  return (
    <>
      <TitleBar title="LiquidFocus" />
      <div style={containerStyle}>
        <div style={ambientStyle} />
        <div style={contentStyle}>
          {view === 'timer' && (
            <TimerView
              timer={timer}
              stats={stats}
              focusDetectionEnabled={focusDetectionEnabled}
              focusAwayThresholdSecs={focusAwayThresholdSecs}
              activeTaskName={
                timer.activeTaskIndex >= 0 && timer.activeTaskIndex < tasks.length
                  ? tasks[timer.activeTaskIndex].name
                  : null
              }
              onToggle={handleToggle}
              onReset={handleReset}
              onSkip={handleSkip}
              onShowTasks={() => setView('tasks')}
              onShowStats={() => setView('stats')}
              onShowSettings={() => setView('settings')}
            />
          )}
          {view === 'tasks' && (
            <TaskList
              tasks={tasks}
              activeTaskIndex={timer.activeTaskIndex}
              onAdd={handleAddTask}
              onUpdate={handleUpdateTask}
              onDelete={handleDeleteTask}
              onSelect={handleSelectTask}
              onBack={() => setView('timer')}
              onShowSettings={() => setView('settings')}
            />
          )}
          {view === 'stats' && (
            <StatsView stats={stats} workDurationMinutes={workDurationMinutes} onBack={() => setView('timer')} />
          )}
          {view === 'settings' && (
            <SettingsView onBack={() => setView('timer')} onShowTasks={() => setView('tasks')} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── Sound Helpers ──────────────────────────────────────────────────────────

function playPhaseSound(phase: string): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'

    if (phase === 'work') {
      // Descending tone for work complete
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3)
    } else {
      // Ascending tone for break complete
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3)
    }

    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
    // Close the AudioContext after the sound finishes to avoid hitting Chromium's limit
    osc.onended = () => ctx.close()
  } catch {
    // Audio API may not be available
  }
}
