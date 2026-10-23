/**
 * QuickBoard Workflows and Forms: list, edit, start/fill, delete.
 * Wired to CLIPBOARD_*_WORKFLOW* and CLIPBOARD_*_FORM_* (services
 * clipboard-workflows.ts / clipboard-forms.ts). Starting one hides the panel;
 * the user then presses the paste-next shortcut for each step.
 */

import { useEffect, useState } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { RouteParams } from '../../types'
import { invoke, useInvoke, formatAccelerator } from '../../hooks'
import { Btn, Empty, Grp, IconBtn, Note, Row, V } from '../../kit'
import { useNav, type NavApi } from '../../nav'
import { QUEUE_NEXT_KEY, setQB, type FormProfile, type PasteStatus, type Workflow } from './store'

const Ai = (): React.JSX.Element => <span className="pro" style={{ marginLeft: 6 }}>AI</span>

function startSequence(nav: NavApi, channel: string, id: string, kind: 'workflow' | 'form'): void {
  invoke<{ active: boolean; current: number; total: number; label: string }>(channel, id)
    .then((r) => {
      if (!r?.active) {
        nav.toast(kind === 'form' ? 'This form has no fields' : 'This workflow has no steps')
        return
      }
      const paste: PasteStatus = { kind, ...r }
      setQB({ paste })
      nav.hide()
    })
    .catch(() => nav.toast('Couldn’t start'))
}

async function confirmDelete(nav: NavApi, icon: 'zap' | 'form', name: string): Promise<boolean> {
  const v = await nav.confirm({
    icon,
    title: `Delete “${name}”?`,
    body: 'This can’t be undone.',
    buttons: [
      { label: 'Delete', value: 'delete', primary: true },
      { label: 'Cancel', value: 'cancel' }
    ]
  })
  return v === 'delete'
}

/* ─── Workflows ──────────────────────────────────────────────────────────── */

export function Workflows(): React.JSX.Element {
  const nav = useNav()
  const [list, , setList] = useInvoke<Workflow[]>(IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS)
  if (!list) return <div style={{ height: 160 }} />
  const add = (
    <Grp>
      <Row label="New workflow" icon="plus" go="quickboard/workflows/edit/new" />
    </Grp>
  )
  if (!list.length)
    return (
      <>
        <Empty icon="zap" title="No workflows yet">Create one, or let AI setup make some for you.</Empty>
        {add}
      </>
    )
  return (
    <>
      <Note style={{ marginBottom: 8 }}>Paste several things in order. Start one, then press {formatAccelerator(QUEUE_NEXT_KEY)} for each step.</Note>
      <Grp>
        {list.map((w) => (
          <Row
            key={w.id}
            label={<>{w.name}{w.isAiGenerated ? <Ai /> : null}</>}
            right={
              <>
                <span className="hk" style={{ display: 'inline-flex', gap: 2 }}>
                  <IconBtn icon="pencil" label="Edit" onClick={() => nav.go(`quickboard/workflows/edit/${encodeURIComponent(w.id)}`)} />
                  <IconBtn
                    icon="trash"
                    label="Delete"
                    onClick={async () => {
                      if (!(await confirmDelete(nav, 'zap', w.name))) return
                      invoke<Workflow[]>(IPC_INVOKE.CLIPBOARD_DELETE_WORKFLOW, w.id).then((l) => Array.isArray(l) && setList(l)).catch(() => {})
                    }}
                  />
                </span>
                <V>{w.items.length} {w.items.length === 1 ? 'step' : 'steps'}</V>
                <Btn sm onClick={() => startSequence(nav, IPC_INVOKE.CLIPBOARD_START_WORKFLOW, w.id, 'workflow')}>Start</Btn>
              </>
            }
          />
        ))}
      </Grp>
      {add}
    </>
  )
}

export function EditWorkflow({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const isNew = params.id === 'new'
  const [list] = useInvoke<Workflow[]>(IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS)
  const [draft, setDraft] = useState<Workflow | null>(null)
  useEffect(() => {
    if (draft || !list) return
    const found = list.find((w) => w.id === params.id)
    setDraft(found ? structuredClone(found) : { id: '', name: '', description: '', items: [{ label: '', text: '' }], isAiGenerated: false })
  }, [list, draft, params.id])
  if (!draft) return <div style={{ height: 200 }} />
  const setItem = (i: number, patch: Partial<Workflow['items'][number]>): void =>
    setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) })
  const save = (): void => {
    const items = draft.items.filter((it) => it.text.trim()).map((it, i) => ({ label: it.label.trim() || `Step ${i + 1}`, text: it.text }))
    if (!draft.name.trim()) return nav.toast('Give the workflow a name')
    if (!items.length) return nav.toast('Add at least one step')
    invoke(IPC_INVOKE.CLIPBOARD_SAVE_WORKFLOW, {
      ...(isNew ? {} : { id: draft.id }),
      name: draft.name.trim(),
      description: draft.description.trim(),
      items,
      isAiGenerated: draft.isAiGenerated
    })
      .then(() => {
        nav.go('quickboard/workflows')
        nav.toast('Saved')
      })
      .catch(() => nav.toast('Couldn’t save'))
  }
  return (
    <>
      <input className="text-in" aria-label="Workflow name" placeholder="Workflow name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input className="text-in" style={{ marginTop: 6 }} placeholder="Description (optional)" aria-label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      {draft.items.map((it, i) => (
        <div key={i}>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <span className="v" style={{ width: 14 }}>{i + 1}</span>
            <input className="text-in" style={{ height: 28 }} placeholder="Step name" aria-label={`Step ${i + 1} name`} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} />
            <IconBtn icon="x" label="Remove step" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })} />
          </div>
          <textarea className="text-in" rows={2} style={{ margin: '6px 0 0 22px', width: 'calc(100% - 22px)' }} placeholder="Text to paste" aria-label={`Step ${i + 1} text`} value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} />
        </div>
      ))}
      <Grp style={{ marginTop: 10 }}>
        <Row label="Add step" icon="plus" onClick={() => setDraft({ ...draft, items: [...draft.items, { label: '', text: '' }] })} />
      </Grp>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Btn onClick={() => nav.go('quickboard/workflows')}>Cancel</Btn>
        <Btn primary onClick={save}>Save</Btn>
      </div>
    </>
  )
}

/* ─── Forms ──────────────────────────────────────────────────────────────── */

export function Forms(): React.JSX.Element {
  const nav = useNav()
  const [list, , setList] = useInvoke<FormProfile[]>(IPC_INVOKE.CLIPBOARD_GET_FORM_PROFILES)
  if (!list) return <div style={{ height: 160 }} />
  const add = (
    <Grp>
      <Row label="New form" icon="plus" go="quickboard/forms/edit/new" />
    </Grp>
  )
  if (!list.length)
    return (
      <>
        <Empty icon="form" title="No forms yet">Create one, or let AI setup make some for you.</Empty>
        {add}
      </>
    )
  return (
    <>
      <Note style={{ marginBottom: 8 }}>Fill a form one field at a time: start, click the first field, then press {formatAccelerator(QUEUE_NEXT_KEY)} after each.</Note>
      <Grp>
        {list.map((f) => (
          <Row
            key={f.id}
            label={<>{f.name}{f.isAiGenerated ? <Ai /> : null}</>}
            sub={f.fields.map((x) => x.label).join(' · ')}
            right={
              <>
                <span className="hk" style={{ display: 'inline-flex', gap: 2 }}>
                  <IconBtn icon="pencil" label="Edit" onClick={() => nav.go(`quickboard/forms/edit/${encodeURIComponent(f.id)}`)} />
                  <IconBtn
                    icon="trash"
                    label="Delete"
                    onClick={async () => {
                      if (!(await confirmDelete(nav, 'form', f.name))) return
                      invoke<FormProfile[]>(IPC_INVOKE.CLIPBOARD_DELETE_FORM_PROFILE, f.id).then((l) => Array.isArray(l) && setList(l)).catch(() => {})
                    }}
                  />
                </span>
                <Btn sm onClick={() => startSequence(nav, IPC_INVOKE.CLIPBOARD_START_FORM_FILL, f.id, 'form')}>Fill</Btn>
              </>
            }
          />
        ))}
      </Grp>
      {add}
    </>
  )
}

export function EditForm({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const isNew = params.id === 'new'
  const [list] = useInvoke<FormProfile[]>(IPC_INVOKE.CLIPBOARD_GET_FORM_PROFILES)
  const [draft, setDraft] = useState<FormProfile | null>(null)
  useEffect(() => {
    if (draft || !list) return
    const found = list.find((f) => f.id === params.id)
    setDraft(found ? structuredClone(found) : { id: '', name: '', fields: [{ label: '', value: '', type: 'text' }], isAiGenerated: false })
  }, [list, draft, params.id])
  if (!draft) return <div style={{ height: 200 }} />
  const setField = (i: number, patch: Partial<FormProfile['fields'][number]>): void =>
    setDraft({ ...draft, fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const save = (): void => {
    const fields = draft.fields.filter((f) => f.label.trim() || f.value.trim()).map((f, i) => ({ ...f, label: f.label.trim() || `Field ${i + 1}` }))
    if (!draft.name.trim()) return nav.toast('Give the form a name')
    if (!fields.length) return nav.toast('Add at least one field')
    invoke(IPC_INVOKE.CLIPBOARD_SAVE_FORM_PROFILE, { ...(isNew ? {} : { id: draft.id }), name: draft.name.trim(), fields, isAiGenerated: draft.isAiGenerated })
      .then(() => {
        nav.go('quickboard/forms')
        nav.toast('Saved')
      })
      .catch(() => nav.toast('Couldn’t save'))
  }
  return (
    <>
      <input className="text-in" placeholder="Form name, e.g. Work signup" aria-label="Form name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      {draft.fields.map((f, i) => (
        <div key={i} className="row" style={{ marginTop: 8, gap: 6 }}>
          <span className="v" style={{ width: 14 }}>{i + 1}</span>
          <input className="text-in" style={{ height: 28, width: 96, flex: 'none' }} placeholder="Label" aria-label={`Field ${i + 1} label`} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
          <input className="text-in" style={{ height: 28 }} placeholder="Value" aria-label={`Field ${i + 1} value`} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} />
          <IconBtn icon="x" label="Remove" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Grp style={{ marginTop: 10 }}>
        <Row label="Add field" icon="plus" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { label: '', value: '', type: 'text' }] })} />
      </Grp>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Btn onClick={() => nav.go('quickboard/forms')}>Cancel</Btn>
        <Btn primary onClick={save}>Save</Btn>
      </div>
    </>
  )
}
