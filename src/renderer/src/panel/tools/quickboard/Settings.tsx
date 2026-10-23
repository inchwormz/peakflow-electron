/**
 * QuickBoard settings: General, Transforms (pipelines), Shortcuts,
 * Import and export, AI. Config persists through useToolConfig (CONFIG_SET).
 * Left out on purpose (no backend): encrypt history, trigger rules, tag
 * shortcuts and editable QuickBoard shortcuts.
 */

import { useEffect, useState } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { QuickBoardConfig } from '@shared/config-schemas'
import { ToolId } from '@shared/tool-ids'
import type { RouteParams } from '../../types'
import { invoke, useInvoke, useToolConfig } from '../../hooks'
import { Btn, Empty, Grp, IconBtn, Note, NumIn, Picker, Rec, Row, Toggle } from '../../kit'
import { useNav } from '../../nav'
import { aiAccessNote, type AiAccess } from './ai-run'
import { applySteps, clipText, setQB, STEP_NAME, useQB, OPEN_KEY, QUEUE_CANCEL_KEY, QUEUE_NEXT_KEY, WIZARD_START, type Clip, type Pipeline, type TransformStep } from './store'

type Transforms = { pipelines: Pipeline[]; available: TransformStep[] }
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

export function SettingsRoot(): React.JSX.Element {
  const [t] = useInvoke<Transforms>(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS)
  return (
    <Grp>
      <Row label="General" go="quickboard/settings/general" />
      <Row label="Transforms" value={t ? (t.pipelines.length ? plural(t.pipelines.length, 'pipeline') : 'None') : undefined} go="quickboard/settings/transforms" />
      <Row label="Shortcuts" go="quickboard/settings/hotkeys" />
      <Row label="Import and export" go="quickboard/settings/data" />
      <Row label="AI" go="quickboard/settings/ai" />
    </Grp>
  )
}

/* ─── General ────────────────────────────────────────────────────────────── */

const EXPIRY: Array<[string, string]> = [
  ['1', '1 hour'],
  ['24', '24 hours'],
  ['168', '7 days'],
  ['720', '30 days'],
  ['never', 'Never']
]

export function General(): React.JSX.Element {
  const nav = useNav()
  const [cfg, set] = useToolConfig<QuickBoardConfig>(ToolId.QuickBoard)
  const s = useQB()
  if (!cfg) return <div style={{ height: 260 }} />
  const expiry = !cfg.auto_expire || cfg.max_age_hours <= 0 ? 'never' : String(cfg.max_age_hours)
  const options = EXPIRY.some(([v]) => v === expiry) ? EXPIRY : [...EXPIRY, [expiry, `${expiry} hours`] as [string, string]]
  const unpinned = (s.history ?? []).filter((c) => !c.pinned).length
  const clear = async (): Promise<void> => {
    const v = await nav.confirm({
      icon: 'quickboard',
      title: `Clear ${plural(unpinned, 'clip')}?`,
      body: 'Pinned clips are kept. This can’t be undone.',
      buttons: [
        { label: 'Clear all', value: 'clear', primary: true },
        { label: 'Cancel', value: 'cancel' }
      ]
    })
    if (v !== 'clear') return
    invoke<Clip[]>(IPC_INVOKE.CLIPBOARD_CLEAR_HISTORY)
      .then((h) => {
        if (Array.isArray(h)) setQB({ history: h })
        nav.toast('History cleared')
      })
      .catch(() => nav.toast('Couldn’t clear the history'))
  }
  return (
    <>
      <Grp>
        <Row label="Keep up to" right={<NumIn label="Keep up to" value={cfg.max_entries} min={10} max={2000} width={56} unit="clips" onCommit={(v) => set('max_entries', v)} />} />
        <Row
          label="Clear unpinned clips after"
          right={
            <Picker
              label="Clear unpinned clips after"
              value={expiry}
              options={options}
              onChange={(v) => {
                if (v === 'never') set('auto_expire', false)
                else {
                  set('max_age_hours', Number(v))
                  set('auto_expire', true)
                }
              }}
            />
          }
        />
        <Row label="Paste as plain text" right={<Toggle label="Paste as plain text" checked={cfg.plain_text_mode} onChange={(v) => set('plain_text_mode', v)} />} />
        <Row label="Open QuickBoard" right={<Rec value={OPEN_KEY} />} />
      </Grp>
      <Grp>
        <Row label="Show page titles for links" right={<Toggle label="Show page titles for links" checked={!!cfg.link_previews} onChange={(v) => set('link_previews', v)} />} />
      </Grp>
      <Note style={{ marginTop: 10 }}>To get a title, QuickBoard opens the link when it appears in your list. Opening a link can use up a one-time sign-in link, and the site sees your internet address. Links to this computer or your own network are never opened.</Note>
      <Note style={{ marginTop: 10 }}>QuickBoard skips anything that looks like a password, API key or card number, and ignores password managers and banking apps.</Note>
      <Grp>
        <Row label="Clear all history" icon="trash" tone="danger" onClick={unpinned ? () => void clear() : () => nav.toast('No unpinned clips to clear')} />
      </Grp>
    </>
  )
}

/* ─── Transforms and pipelines ───────────────────────────────────────────── */

export function TransformsPage(): React.JSX.Element {
  const [t] = useInvoke<Transforms>(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS)
  if (!t) return <div style={{ height: 160 }} />
  const add = (
    <Grp>
      <Row label="New pipeline" icon="plus" go="quickboard/settings/pipeline/new" />
    </Grp>
  )
  if (!t.pipelines.length)
    return (
      <>
        <Empty icon="wand" title="No pipelines yet">Chain transforms like Trim → lowercase → URL slug.</Empty>
        {add}
      </>
    )
  return (
    <>
      <Note style={{ marginBottom: 8 }}>Pipelines run several transforms in a row. They show up in Paste as… (right-click a clip).</Note>
      <Grp>
        {t.pipelines.map((p) => (
          <Row key={p.id} label={p.name} value={plural(p.steps.length, 'step')} go={`quickboard/settings/pipeline/${encodeURIComponent(p.id)}`} />
        ))}
      </Grp>
      {add}
    </>
  )
}

export function EditPipeline({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const isNew = params.id === 'new'
  const [t] = useInvoke<Transforms>(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS)
  const s = useQB()
  const [draft, setDraft] = useState<Pipeline | null>(null)
  useEffect(() => {
    if (draft || !t) return
    const found = t.pipelines.find((p) => p.id === params.id)
    setDraft(found ? structuredClone(found) : { id: `pipeline-${Date.now()}`, name: '', steps: [] })
  }, [t, draft, params.id])
  if (!draft || !t) return <div style={{ height: 240 }} />
  const latest = (s.history ?? []).find((c) => c.type === 'text')
  const sample = (latest ? clipText(latest) : '  Hello <b>World</b>  ').replace(/\s+$/, ' ').slice(0, 120)
  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= draft.steps.length) return
    const steps = [...draft.steps]
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    setDraft({ ...draft, steps })
  }
  const save = (): void => {
    if (!draft.name.trim()) return nav.toast('Give the pipeline a name')
    if (!draft.steps.length) return nav.toast('Add at least one step')
    invoke(IPC_INVOKE.CLIPBOARD_SAVE_TRANSFORM, { id: draft.id, name: draft.name.trim(), steps: draft.steps })
      .then(() => {
        nav.go('quickboard/settings/transforms')
        nav.toast('Saved')
      })
      .catch(() => nav.toast('Couldn’t save'))
  }
  const del = async (): Promise<void> => {
    if (isNew) return nav.go('quickboard/settings/transforms')
    const v = await nav.confirm({
      icon: 'wand',
      title: `Delete “${draft.name}”?`,
      body: 'This can’t be undone.',
      buttons: [
        { label: 'Delete', value: 'delete', primary: true },
        { label: 'Cancel', value: 'cancel' }
      ]
    })
    if (v !== 'delete') return
    invoke(IPC_INVOKE.CLIPBOARD_DELETE_TRANSFORM, draft.id)
      .then(() => {
        nav.go('quickboard/settings/transforms')
        nav.toast('Deleted')
      })
      .catch(() => {})
  }
  const show = (x: string): string => (x.length > 80 ? x.slice(0, 80) + '…' : x)
  return (
    <>
      <input className="text-in" placeholder="Pipeline name" aria-label="Pipeline name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      {draft.steps.length ? (
        <Grp style={{ marginTop: 8 }}>
          {draft.steps.map((st, i) => (
            <Row
              key={`${st.type}-${i}`}
              label={
                <>
                  <span className="v" style={{ marginRight: 8 }}>{i + 1}</span>
                  {STEP_NAME[st.type] ?? st.label}
                </>
              }
              right={
                <>
                  <IconBtn icon="up" label="Move up" onClick={() => move(i, -1)} />
                  <IconBtn icon="down" label="Move down" onClick={() => move(i, 1)} />
                  <IconBtn icon="x" label="Remove" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })} />
                </>
              }
            />
          ))}
        </Grp>
      ) : null}
      <Note style={{ margin: '12px 0 6px' }}>Add a step</Note>
      <div className="chips">
        {t.available.map((a) => (
          <button key={a.type} className="chip" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { type: a.type, label: a.label }] })}>
            {STEP_NAME[a.type] ?? a.label}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: '8px 12px', marginTop: 12, fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word' }}>
        <span className="dim">Before</span> {show(sample)}
        <br />
        <span className="dim">After</span>&nbsp;&nbsp; {show(applySteps(draft.steps, sample))}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <Btn onClick={() => void del()}>{isNew ? 'Cancel' : 'Delete'}</Btn>
        <Btn primary onClick={save}>Save</Btn>
      </div>
    </>
  )
}

/* ─── Shortcuts (fixed in hotkeys.ts) ────────────────────────────────────── */

export function Shortcuts(): React.JSX.Element {
  return (
    <>
      <Grp>
        <Row label="Open QuickBoard" right={<Rec value={OPEN_KEY} />} />
        <Row label="Paste next in a queue" right={<Rec value={QUEUE_NEXT_KEY} />} />
        <Row label="Cancel a queue" right={<Rec value={QUEUE_CANCEL_KEY} />} />
      </Grp>
      <Note style={{ marginTop: 10 }}>These shortcuts are fixed for now. The paste-next and cancel keys also work for workflows and forms.</Note>
      <Grp>
        <Row label="All PeakFlow shortcuts" go="app/hotkeys" />
      </Grp>
    </>
  )
}

/* ─── Import and export (no IPC yet) ─────────────────────────────────────── */

export function ImportExport(): React.JSX.Element {
  const s = useQB()
  const [t] = useInvoke<Transforms>(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS)
  const [wf] = useInvoke<unknown[]>(IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS)
  const stat = (n: number | undefined, l: string): React.JSX.Element => (
    <div>
      <b>{n ?? '–'}</b>
      <span>{l}</span>
    </div>
  )
  return (
    <>
      <div className="statgrid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {stat(s.history?.length, 'Clips')}
        {stat(s.tags.length, 'Tags')}
        {stat(t?.pipelines.length, 'Pipelines')}
        {stat(wf?.length, 'Workflows')}
      </div>
      <Grp>
        <Row label="Export everything" sub="Clips, tags, pipelines, workflows and forms as JSON" right={<Btn sm disabled>Coming soon</Btn>} />
        <Row label="Import from a file" right={<Btn sm disabled>Coming soon</Btn>} />
      </Grp>
      <Note style={{ marginTop: 10 }}>Import and export aren’t ready yet.</Note>
    </>
  )
}

/* ─── AI ─────────────────────────────────────────────────────────────────── */

export function AiSettings(): React.JSX.Element {
  const nav = useNav()
  const [cfg, set] = useToolConfig<QuickBoardConfig>(ToolId.QuickBoard)
  const [access] = useInvoke<AiAccess>(IPC_INVOKE.CLIPBOARD_AI_CHECK_ACCESS)
  if (!cfg) return <div style={{ height: 120 }} />
  return (
    <>
      <Grp>
        <Row
          label="Smart suggestions"
          sub="Sends a short summary of what you copy, never passwords"
          right={<Toggle label="Smart suggestions" checked={cfg.ai_suggestions_enabled !== false} onChange={(v) => set('ai_suggestions_enabled', v)} />}
        />
        <Row label="AI actions in Paste as…" value="Summarize, translate…" />
        <Row
          label="Run setup again"
          onClick={() => {
            setQB({ wizard: WIZARD_START })
            nav.go('quickboard/setup/1')
          }}
          go="quickboard/setup/1"
        />
      </Grp>
      {access ? <Note style={{ marginTop: 10 }}>{access.allowed ? `AI runs on your own ${access.provider}. PeakFlow never sees it.` : aiAccessNote(access.reason)}</Note> : null}
    </>
  )
}
