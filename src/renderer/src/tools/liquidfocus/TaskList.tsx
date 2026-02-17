/**
 * TaskList — Task CRUD with pomodoro estimates.
 *
 * Matches LiquidFocus_Redesign.html .tasks-body exactly:
 *   - Task input: bg rgba(255,255,255,0.05), border rgba(255,255,255,0.1), radius 12px
 *   - Task rows: hover bg #111, radius 10px
 *   - Active task: border-left 3px solid #fff
 *   - Checkbox: 16x16 circle, border 1.5px solid #2a2a2a
 *   - Progress bar: 28px wide, 2px tall, green fill
 *   - Category labels: 8px uppercase, rgba(255,255,255,0.4)
 *   - Completed section: collapsible with toggle
 */

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { DS, type LiquidFocusTask } from './LiquidFocus'
import { IPC_INVOKE } from '@shared/ipc-types'

interface TaskListProps {
  tasks: LiquidFocusTask[]
  activeTaskIndex: number
  onAdd: (task: Omit<LiquidFocusTask, 'id' | 'createdAt'>) => void
  onUpdate: (taskId: string, updates: Partial<LiquidFocusTask>) => void
  onDelete: (taskId: string) => void
  onSelect: (index: number) => void
  onBack: () => void
  onShowSettings: () => void
}

export function TaskList({
  tasks,
  activeTaskIndex,
  onAdd,
  onUpdate,
  onDelete,
  onSelect,
  onBack,
  onShowSettings
}: TaskListProps): React.JSX.Element {
  const [taskName, setTaskName] = useState('')
  const [estimated, setEstimated] = useState('1')
  const [due, setDue] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Add task ──────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    let name = taskName.trim()
    if (!name) return

    // Parse category from #tag
    let category = 'General'
    const tagMatch = name.match(/#(\w+)/)
    if (tagMatch) {
      category = tagMatch[1].charAt(0).toUpperCase() + tagMatch[1].slice(1)
      name = name.replace(tagMatch[0], '').trim()
    }

    const est = parseInt(estimated) || 1
    const dueDate = due.trim() || null

    onAdd({
      name,
      category,
      estimated: est,
      actual: 0,
      due: dueDate,
      done: false
    })

    setTaskName('')
    setEstimated('1')
    setDue('')
    inputRef.current?.focus()
  }, [taskName, estimated, due, onAdd])

  // ── Import from Todoist ──────────────────────────────────────────────

  const handleImportTodoist = useCallback(async () => {
    setImporting(true)
    try {
      // Check if Todoist is connected
      const status = (await window.peakflow.invoke(IPC_INVOKE.TODOIST_GET_STATUS)) as {
        connected: boolean
      }
      if (!status.connected) {
        setImporting(false)
        return
      }

      // Get project filter from config
      const cfg = (await window.peakflow.invoke(IPC_INVOKE.CONFIG_GET, {
        tool: 'liquidfocus'
      })) as { todoist_project_filter?: string } | null
      const projectFilter = cfg?.todoist_project_filter || undefined

      // Fetch tasks from Todoist
      const todoistTasks = (await window.peakflow.invoke(
        IPC_INVOKE.TODOIST_GET_TASKS,
        projectFilter
      )) as {
        id: string
        content: string
        due: { date: string; string: string } | null
        priority: number
      }[]

      // Get existing todoist IDs to avoid duplicates
      const existingTodoistIds = new Set(tasks.filter((t) => t.todoistId).map((t) => t.todoistId))

      // Import each task that isn't already imported
      for (const tt of todoistTasks) {
        if (existingTodoistIds.has(tt.id)) continue

        await onAdd({
          name: tt.content,
          category: 'Todoist',
          estimated: 1,
          actual: 0,
          due: tt.due?.date || null,
          done: false,
          todoistId: tt.id
        })
      }
    } catch (err) {
      console.warn('[TaskList] Todoist import failed:', err)
    }
    setImporting(false)
  }, [tasks, onAdd])

  // ── Group tasks by category ───────────────────────────────────────────

  const { activeTasks, completedTasks } = useMemo(() => {
    const active: { task: LiquidFocusTask; index: number }[] = []
    const completed: LiquidFocusTask[] = []

    tasks.forEach((t, i) => {
      if (t.done) {
        completed.push(t)
      } else {
        active.push({ task: t, index: i })
      }
    })

    return { activeTasks: active, completedTasks: completed }
  }, [tasks])

  const groupedTasks = useMemo(() => {
    const groups: Record<string, { task: LiquidFocusTask; index: number }[]> = {}
    for (const item of activeTasks) {
      const cat = item.task.category || 'General'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    return groups
  }, [activeTasks])

  // ── Styles ────────────────────────────────────────────────────────────

  const navBar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 0',
    flexShrink: 0
  }

  const inputArea: CSSProperties = {
    padding: '12px 24px 14px',
    display: 'flex',
    gap: 6,
    alignItems: 'center'
  }

  const inputStyle: CSSProperties = {
    flex: 1,
    background: DS.borderInputBg,
    border: `1px solid ${DS.borderInput}`,
    borderRadius: 12,
    padding: '10px 12px',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontSize: 13,
    color: DS.white,
    outline: 'none'
  }

  const metaInput: CSSProperties = {
    width: 36,
    textAlign: 'center',
    background: DS.borderInputBg,
    border: `1px solid ${DS.borderInput}`,
    borderRadius: 10,
    padding: '10px 2px',
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    outline: 'none'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Nav bar */}
      <div style={navBar}>
        <div style={{ display: 'flex', gap: 8 }}>
          <NavBtn onClick={onBack}>&#9664;</NavBtn>
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: DS.white,
            letterSpacing: 0.5
          }}
        >
          Tasks
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <TodoistImportBtn onClick={handleImportTodoist} importing={importing} />
          <NavBtn onClick={onShowSettings}>&#9881;</NavBtn>
        </div>
      </div>

      {/* Task input area */}
      <div style={inputArea}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Add a task..."
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          style={inputStyle}
        />
        <input
          type="text"
          value={estimated}
          onChange={(e) => setEstimated(e.target.value)}
          title="Estimated pomodoros"
          style={metaInput}
        />
        <input
          type="text"
          placeholder="Due"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          style={{ ...metaInput, width: 50 }}
        />
        <button
          onClick={handleAdd}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: 'none',
            background: DS.white,
            color: DS.bg,
            fontSize: 18,
            cursor: 'pointer',
            flexShrink: 0,
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s'
          }}
        >
          +
        </button>
      </div>

      {/* Task list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 24px 16px',
          scrollbarWidth: 'thin',
          scrollbarColor: `${DS.elevated} transparent`
        }}
      >
        {activeTasks.length === 0 && completedTasks.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, opacity: 0.06, marginBottom: 8 }}>~</div>
            <div style={{ fontSize: 12, color: DS.textLabel }}>No tasks yet</div>
          </div>
        ) : (
          <>
            {/* Active tasks by category */}
            {Object.entries(groupedTasks).map(([category, items]) => (
              <div key={category}>
                <div
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    letterSpacing: 2.5,
                    textTransform: 'uppercase',
                    color: DS.textLabel,
                    margin: '12px 0 4px'
                  }}
                >
                  {category}
                </div>
                {items.map(({ task, index }) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isActive={index === activeTaskIndex}
                    onSelect={() => onSelect(index)}
                    onComplete={() => onUpdate(task.id, { done: true })}
                    onDelete={() => onDelete(task.id)}
                  />
                ))}
              </div>
            ))}

            {/* Completed section */}
            {completedTasks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 0',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    color: DS.textLabel,
                    border: 'none',
                    background: 'none',
                    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
                  }}
                >
                  <span>{showCompleted ? '\u25BC' : '\u25B6'}</span>
                  Completed ({completedTasks.length})
                </button>
                {showCompleted &&
                  completedTasks.map((task) => (
                    <div
                      key={task.id}
                      style={{
                        padding: '6px 10px',
                        fontSize: 12,
                        color: DS.textLabel,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                    >
                      <span style={{ color: DS.green, fontSize: 10 }}>&#10003;</span>
                      <span style={{ textDecoration: 'line-through' }}>{task.name}</span>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TaskRow({
  task,
  isActive,
  onSelect,
  onComplete,
  onDelete
}: {
  task: LiquidFocusTask
  isActive: boolean
  onSelect: () => void
  onComplete: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [chkHovered, setChkHovered] = useState(false)

  const pct = Math.min(100, ((task.actual || 0) / Math.max(task.estimated || 1, 1)) * 100)

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 10px',
    borderRadius: 10,
    cursor: 'pointer',
    marginBottom: 1,
    transition: 'background 0.15s',
    background: isActive || hovered ? DS.surface : 'transparent',
    borderLeft: isActive ? `3px solid ${DS.white}` : '3px solid transparent',
    position: 'relative'
  }

  return (
    <div
      style={rowStyle}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        onDelete()
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onComplete()
        }}
        onMouseEnter={() => setChkHovered(true)}
        onMouseLeave={() => setChkHovered(false)}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `1.5px solid ${isActive ? DS.white : chkHovered ? DS.green : '#2a2a2a'}`,
          background: 'transparent',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: chkHovered ? 8 : 0,
          color: chkHovered ? DS.green : 'transparent',
          transition: 'all 0.2s',
          padding: 0
        }}
      >
        &#10003;
      </button>

      {/* Task body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: isActive ? '#ddd' : DS.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {task.name}
        </div>
        {task.due && (
          <div
            style={{
              fontSize: 9,
              color: DS.textLabel,
              marginTop: 2
            }}
          >
            {task.due}
          </div>
        )}
      </div>

      {/* Progress */}
      <div
        style={{
          fontSize: 10,
          color: DS.textLabel,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0
        }}
      >
        <div
          style={{
            width: 28,
            height: 2,
            background: DS.elevated,
            borderRadius: 1,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: DS.green,
              borderRadius: 1
            }}
          />
        </div>
        {task.actual}/{task.estimated}
      </div>
    </div>
  )
}

function TodoistImportBtn({
  onClick,
  importing
}: {
  onClick: () => void
  importing: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [status, setStatus] = useState<{ connected: boolean }>({ connected: false })

  // Check if Todoist is connected
  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.TODOIST_GET_STATUS)
      .then((s) => setStatus(s as { connected: boolean }))
      .catch(() => {})
  }, [])

  // Don't render if not connected
  if (!status.connected) return <></>

  return (
    <button
      onClick={onClick}
      disabled={importing}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Import from Todoist"
      style={{
        height: 32,
        paddingInline: 10,
        borderRadius: 16,
        border: `1px solid ${hovered ? DS.green : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? 'rgba(74,224,138,0.1)' : 'transparent',
        color: importing ? DS.textLabel : DS.green,
        cursor: importing ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.5,
        transition: 'all 0.2s',
        fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
        padding: '0 10px',
        opacity: importing ? 0.5 : 1
      }}
    >
      {importing ? '...' : '↓ Todoist'}
    </button>
  )
}

function NavBtn({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1px solid ${hovered ? '#444' : 'rgba(255,255,255,0.15)'}`,
        background: hovered ? DS.elevated : 'transparent',
        color: DS.white,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        transition: 'all 0.2s',
        fontFamily: 'inherit',
        padding: 0
      }}
    >
      {children}
    </button>
  )
}
