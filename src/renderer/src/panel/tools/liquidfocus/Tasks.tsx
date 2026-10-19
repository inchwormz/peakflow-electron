/**
 * Liquid Focus tasks: add (with #tag category, pomodoro estimate and due),
 * grouped by category, tick to complete (also ticks it off in Todoist),
 * click to focus on it, right-click to delete, collapsible Completed list.
 * Behaviour follows the old TaskList.tsx / LiquidFocus.tsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import { invoke, useInvoke } from '../../hooks'
import { Btn, Empty, Grp, LinkBtn, Note, Row, V } from '../../kit'
import { Icon } from '../../icons'
import { useNav } from '../../nav'
import { importFromTodoist, pickTaskAndStart, setTasks, useImporting, useLF, type LiquidFocusTask } from './store'

function useTodoistConnected(): boolean {
  const [s] = useInvoke<{ connected: boolean }>(IPC_INVOKE.TODOIST_GET_STATUS)
  return !!s?.connected
}

async function runImport(toast: (m: string) => void): Promise<void> {
  const n = await importFromTodoist()
  if (n === null) toast('Todoist isn’t connected')
  else if (n === 0) toast('No new tasks in Todoist')
  else toast(`Imported ${n} task${n === 1 ? '' : 's'} from Todoist`)
}

/** Header right: "Import from Todoist" when connected, "Importing…" while it runs. */
export function TasksRight(): React.JSX.Element | null {
  const nav = useNav()
  const connected = useTodoistConnected()
  const importing = useImporting()
  if (importing) return <span className="v">Importing…</span>
  if (!connected) return null
  return <LinkBtn onClick={() => runImport(nav.toast)}>Import from Todoist</LinkBtn>
}

function AddTask(): React.JSX.Element {
  const [name, setName] = useState('')
  const [est, setEst] = useState('1')
  const [due, setDue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const add = async (): Promise<void> => {
    let n = name.trim()
    if (!n) {
      inputRef.current?.focus()
      return
    }
    let category = 'General'
    const tag = n.match(/#(\w+)/)
    if (tag) {
      category = tag[1].charAt(0).toUpperCase() + tag[1].slice(1)
      n = n.replace(tag[0], '').replace(/\s{2,}/g, ' ').trim()
    }
    if (!n) return
    const estimated = Math.max(1, Math.min(99, parseInt(est, 10) || 1))
    try {
      const tasks = await invoke<LiquidFocusTask[]>(IPC_INVOKE.LIQUIDFOCUS_ADD_TASK, {
        name: n.slice(0, 200),
        category: category.slice(0, 40),
        estimated,
        actual: 0,
        due: due.trim().slice(0, 30) || null,
        done: false
      })
      setTasks(tasks)
    } catch {
      return
    }
    setName('')
    setEst('1')
    setDue('')
    inputRef.current?.focus()
  }
  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') add()
  }
  return (
    <>
      <div className="field-wrap" style={{ marginBottom: 6 }}>
        <Icon name="plus" />
        <input
          ref={inputRef}
          className="field"
          placeholder="Add a task, #tag for a category"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
        />
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-3)' }}>
        <span>Pomodoros</span>
        <input
          className="num-in"
          inputMode="numeric"
          value={est}
          style={{ width: 36 }}
          aria-label="Estimated pomodoros"
          onChange={(e) => setEst(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onKeyDown={onEnter}
        />
        <span style={{ marginLeft: 8 }}>Due</span>
        <input
          className="num-in"
          value={due}
          style={{ width: 84, textAlign: 'left' }}
          placeholder="e.g. Fri"
          aria-label="Due"
          onChange={(e) => setDue(e.target.value)}
          onKeyDown={onEnter}
        />
        <span style={{ flex: 1 }} />
        <Btn sm onClick={add}>
          Add
        </Btn>
      </div>
    </>
  )
}

export function Tasks(): React.JSX.Element {
  const nav = useNav()
  const lf = useLF()
  const connected = useTodoistConnected()
  const [showDone, setShowDone] = useState(false)

  // As before: the first visit while Todoist is connected and nothing is imported yet pulls tasks in
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !lf || !connected) return
    autoRan.current = true
    if (!lf.tasks.some((t) => t.todoistId)) importFromTodoist().catch(() => {})
  }, [lf, connected])

  const tasks = useMemo(() => lf?.tasks ?? [], [lf?.tasks])
  const { groups, done } = useMemo(() => {
    const g = new Map<string, Array<{ t: LiquidFocusTask; i: number }>>()
    const d: Array<{ t: LiquidFocusTask; i: number }> = []
    tasks.forEach((t, i) => {
      if (t.done) d.push({ t, i })
      else {
        const c = t.category || 'General'
        if (!g.has(c)) g.set(c, [])
        g.get(c)!.push({ t, i })
      }
    })
    return { groups: [...g.entries()], done: d }
  }, [tasks])

  if (!lf) return <div style={{ height: 200 }} />
  const activeIdx = lf.timer.activeTaskIndex

  const complete = async (t: LiquidFocusTask, value: boolean): Promise<void> => {
    try {
      const next = await invoke<LiquidFocusTask[]>(IPC_INVOKE.LIQUIDFOCUS_UPDATE_TASK, t.id, { done: value })
      setTasks(next)
    } catch {
      return
    }
    if (value) {
      nav.toast('Done — nice')
      if (t.todoistId) invoke(IPC_INVOKE.TODOIST_COMPLETE_TASK, t.todoistId).catch((err) => console.warn('[LiquidFocus] Todoist sync failed:', err))
    }
  }

  const remove = async (t: LiquidFocusTask): Promise<void> => {
    const v = await nav.confirm({
      icon: 'trash',
      title: `Delete “${t.name}”?`,
      body: 'This can’t be undone.',
      buttons: [
        { label: 'Delete', value: 'delete', primary: true },
        { label: 'Cancel', value: 'cancel' }
      ]
    })
    if (v !== 'delete') return
    invoke<LiquidFocusTask[]>(IPC_INVOKE.LIQUIDFOCUS_DELETE_TASK, t.id).then(setTasks).catch(() => {})
  }

  if (tasks.length === 0) {
    return (
      <>
        <AddTask />
        <Empty icon="check" title="No tasks yet">
          Add one above. Type #work to file it under Work.
        </Empty>
      </>
    )
  }

  return (
    <>
      <AddTask />
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <Note style={{ margin: '10px 0 2px' }}>{cat}</Note>
          <Grp>
            {items.map(({ t, i }) => {
              const on = i === activeIdx
              return (
                <Row
                  key={t.id}
                  icon={
                    <button
                      className="check"
                      aria-label="Complete"
                      onClick={(e) => {
                        e.stopPropagation()
                        complete(t, true)
                      }}
                    />
                  }
                  label={
                    <span style={on ? { fontWeight: 600 } : undefined}>
                      {t.name}
                      {t.todoistId && t.category !== 'Todoist' ? (
                        <>
                          {' '}
                          <span className="pro" style={{ fontWeight: 600 }}>
                            TODOIST
                          </span>
                        </>
                      ) : null}
                    </span>
                  }
                  right={
                    <>
                      {t.due ? <V>{t.due}</V> : null}
                      <span className="v" style={{ width: 28, textAlign: 'right' }}>
                        {t.actual}/{t.estimated}
                      </span>
                    </>
                  }
                  style={on ? { boxShadow: 'inset 2px 0 0 var(--text)', paddingLeft: 8 } : undefined}
                  onClick={() => pickTaskAndStart(nav, i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    remove(t)
                  }}
                />
              )
            })}
          </Grp>
        </div>
      ))}
      {done.length > 0 ? (
        <Grp style={{ marginTop: 12 }}>
          <Row
            label={`Completed (${done.length})`}
            tone="muted"
            right={<Icon name={showDone ? 'chev' : 'chevR'} className="go" />}
            onClick={() => setShowDone((v) => !v)}
          />
          {showDone
            ? done.map(({ t }) => (
                <Row
                  key={t.id}
                  tone="muted"
                  icon={
                    <button
                      className="check on"
                      aria-label="Mark as not done"
                      onClick={(e) => {
                        e.stopPropagation()
                        complete(t, false)
                      }}
                    >
                      <Icon name="check" />
                    </button>
                  }
                  label={<s>{t.name}</s>}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    remove(t)
                  }}
                />
              ))
            : null}
        </Grp>
      ) : null}
      <Note style={{ marginTop: 10 }}>Click a task to start focusing on it. Right-click to delete.</Note>
    </>
  )
}
