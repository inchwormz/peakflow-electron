/**
 * QuickBoard pages for one clip: Edit clip, Paste as… (built-in transforms,
 * saved pipelines, AI actions), Translate to, and the AI processing/error page.
 */

import { useEffect, useRef, useState } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { RouteParams } from '../../types'
import { invoke, isMac, useInvoke, usePanelVisible } from '../../hooks'
import { isPrimaryMod, modLabel } from '@shared/mod-key'
import { Btn, Empty, Gap, Grp, Hero, Note, Row } from '../../kit'
import { useNav } from '../../nav'
import { aiAccessNote, createAiRun, type AiAccess, type AiResult } from './ai-run'
import { ConnectAiBtn, needsConnect } from './ConnectAi'
import { applySteps, clipText, setQB, STEP_NAME, useQB, type Clip, type Pipeline, type TransformStep } from './store'

function useClip(id: string): Clip | null | undefined {
  const s = useQB()
  if (s.history === null) return undefined
  return s.history.find((c) => c.id === id) ?? null
}

const Missing = (): React.JSX.Element => <Empty icon="quickboard" title="This clip is gone">It may have expired or been deleted.</Empty>

/* ─── Edit clip ──────────────────────────────────────────────────────────── */

export function EditClip({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const clip = useClip(params.id)
  const [text, setText] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (clip && text === null) {
      setText(clipText(clip))
      setTimeout(() => ref.current?.focus(), 30)
    }
  }, [clip, text])
  if (clip === undefined) return <div style={{ height: 160 }} />
  if (clip === null || clip.type !== 'text') return <Missing />
  const save = (): void => {
    invoke<Clip[]>(IPC_INVOKE.CLIPBOARD_EDIT_ITEM, clip.id, text ?? '')
      .then((h) => {
        if (Array.isArray(h)) setQB({ history: h })
        nav.go('quickboard')
        nav.toast('Saved')
      })
      .catch(() => nav.toast('Couldn’t save the clip'))
  }
  return (
    <>
      <textarea
        ref={ref}
        className="text-in"
        rows={7}
        aria-label="Clip text"
        value={text ?? ''}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            nav.go('quickboard')
          } else if (isPrimaryMod(e, isMac()) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            save()
          }
        }}
      />
      <Note style={{ margin: '6px 0 12px' }}>{modLabel('S', isMac())} to save · Esc to cancel</Note>
      <div className="btn-row">
        <Btn onClick={() => nav.go('quickboard')}>Cancel</Btn>
        <Btn primary onClick={save}>Save</Btn>
      </div>
    </>
  )
}

/* ─── Paste as… ──────────────────────────────────────────────────────────── */

const QUICK: TransformStep['type'][] = ['uppercase', 'lowercase', 'title_case', 'trim', 'remove_newlines', 'strip_html', 'slug']
export const AI_ACTIONS: Array<{ type: string; label: string; doing: string; codeOnly?: boolean }> = [
  { type: 'summarize', label: 'Summarize', doing: 'Summarizing…' },
  { type: 'formal', label: 'Rewrite formally', doing: 'Rewriting…' },
  { type: 'bullets', label: 'Bullet points', doing: 'Making bullet points…' },
  { type: 'grammar', label: 'Fix grammar', doing: 'Fixing grammar…' },
  { type: 'explain_code', label: 'Explain code', doing: 'Explaining the code…', codeOnly: true }
]

const short = (t: string): string => {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > 140 ? one.slice(0, 140) + '…' : one
}

export function PasteAs({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const clip = useClip(params.id)
  const [data] = useInvoke<{ pipelines: Pipeline[]; available: TransformStep[] }>(IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS)
  const [access] = useInvoke<AiAccess>(IPC_INVOKE.CLIPBOARD_AI_CHECK_ACCESS)
  const [hover, setHover] = useState<TransformStep[] | null>(null)
  if (clip === undefined) return <div style={{ height: 200 }} />
  if (clip === null || clip.type !== 'text') return <Missing />
  const src = clipText(clip)
  const paste = (steps: TransformStep[]): void => {
    nav.hide()
    invoke(IPC_INVOKE.CLIPBOARD_PASTE_WITH_TRANSFORM, clip.id, steps).catch(() => {})
    nav.go('quickboard')
  }
  const aiOk = access?.allowed === true
  const id = encodeURIComponent(clip.id)
  return (
    <>
      <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>
        {short(hover ? applySteps(hover, src) : src) || ' '}
      </div>
      <Grp>
        {QUICK.map((t) => {
          const step: TransformStep = { type: t, label: STEP_NAME[t] }
          return (
            <div key={t} onMouseEnter={() => setHover([step])} onMouseLeave={() => setHover(null)}>
              <Row label={STEP_NAME[t]} onClick={() => paste([step])} />
            </div>
          )
        })}
      </Grp>
      {data?.pipelines.length ? (
        <>
          <Note style={{ margin: '14px 0 2px' }}>Your pipelines</Note>
          <Grp>
            {data.pipelines.map((p) => (
              <div key={p.id} onMouseEnter={() => setHover(p.steps)} onMouseLeave={() => setHover(null)}>
                <Row label={p.name} value={`${p.steps.length} ${p.steps.length === 1 ? 'step' : 'steps'}`} onClick={() => paste(p.steps)} />
              </div>
            ))}
          </Grp>
        </>
      ) : null}
      <Note style={{ margin: '14px 0 2px' }}>AI</Note>
      <Grp>
        {AI_ACTIONS.filter((a) => !a.codeOnly || clip.contentType === 'code').map((a) => (
          <Row key={a.type} icon="sparkle" label={a.label} tone={aiOk ? undefined : 'muted'} onClick={aiOk ? () => nav.go(`quickboard/ai/${id}/${a.type}/-`) : undefined} />
        ))}
        <Row icon="globe" label="Translate" tone={aiOk ? undefined : 'muted'} go={aiOk ? `quickboard/translate/${id}` : undefined} />
      </Grp>
      {access && !aiOk ? <Note style={{ marginTop: 10 }}>{aiAccessNote(access.reason)}</Note> : null}
      {access && !aiOk && needsConnect(access.reason) ? (
        <>
          <Gap h={8} />
          <ConnectAiBtn block />
        </>
      ) : null}
    </>
  )
}

const LANGS = ['Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Korean', 'Portuguese', 'Italian']

export function Translate({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const [other, setOther] = useState('')
  const id = encodeURIComponent(params.id)
  const run = (lang: string): void => nav.go(`quickboard/ai/${id}/translate/${encodeURIComponent(lang)}`)
  return (
    <>
      <Grp>
        {LANGS.map((l) => (
          <Row key={l} label={l} onClick={() => run(l)} />
        ))}
      </Grp>
      <Note style={{ margin: '12px 0 6px' }}>Other language</Note>
      <input
        className="text-in"
        placeholder="e.g. Te reo Māori"
        aria-label="Other language"
        value={other}
        maxLength={40}
        onChange={(e) => setOther(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && other.trim()) run(other.trim())
        }}
      />
    </>
  )
}

/* ─── AI run: processing, then paste or show the error ───────────────────── */

const ERRORS: Record<string, [string, string]> = {
  timeout: ['The AI took too long', 'Try again in a moment.'],
  not_licensed: ['AI needs a PeakFlow licence', 'AI actions are part of the paid plan.'],
  no_provider: ['Connect ChatGPT or Claude', 'QuickBoard’s AI runs on your own ChatGPT or Claude. Connect one, then try again.'],
  not_signed_in: ['Sign in to ChatGPT or Claude', 'You’re signed out of ChatGPT or Claude. Connect signs you back in, then try again.'],
  codex_outdated: ['Update Codex', 'Your Codex app is too old for PeakFlow. Update it in Terminal with “npm install -g @openai/codex”, then try again.'],
  too_long: ['Too long for AI', `This clip is longer than ${(10_000).toLocaleString('en')} characters, the limit for AI actions. Copy a shorter part and try again.`]
}

export function AiRun({ params }: { params: RouteParams }): React.JSX.Element {
  const nav = useNav()
  const clip = useClip(params.id)
  const [state, setState] = useState<{ phase: 'run' | 'error'; error: string }>({ phase: 'run', error: '' })
  const [attempt, setAttempt] = useState(0)
  const visible = usePanelVisible()
  const lang = params.lang === '-' ? undefined : params.lang
  const action = AI_ACTIONS.find((a) => a.type === params.type)
  const doing = params.type === 'translate' ? `Translating to ${lang}…` : action?.doing ?? 'Working…'

  // Start/paste rules live in ai-run.ts: only while the panel is open on this page
  const navRef = useRef(nav)
  navRef.current = nav
  const [run] = useState(() =>
    createAiRun({
      transform: (type, text, l) => invoke<AiResult>(IPC_INVOKE.CLIPBOARD_AI_TRANSFORM, type, text, l),
      paste: (id, text) => {
        invoke(IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE, id, false, text).catch(() => {})
      },
      hide: () => navRef.current.hide(),
      leave: () => navRef.current.go('quickboard'),
      setState
    })
  )
  useEffect(() => () => run.dispose(), [run])
  useEffect(() => {
    run.update({ clip, text: clip && clip.type === 'text' ? clipText(clip) : '', type: params.type, lang, attempt, visible })
  }, [run, clip, params.type, lang, attempt, visible])

  if (clip === undefined) return <div style={{ height: 160 }} />
  if (clip === null || clip.type !== 'text') return <Missing />
  if (state.phase === 'run') return <Hero icon="sparkle" title={doing}>This takes a few seconds.</Hero>
  const [title, body] = ERRORS[state.error] ?? ['The AI didn’t answer', 'Something went wrong. Try again.']
  const licence = state.error === 'not_licensed'
  return (
    <>
      <Hero icon="info" title={title}>{body}</Hero>
      <Gap h={12} />
      {licence ? (
        <Btn block onClick={() => nav.go('app/licence')}>See plans</Btn>
      ) : state.error === 'too_long' ? (
        <Btn block onClick={() => nav.go('quickboard')}>Back to clips</Btn>
      ) : needsConnect(state.error) ? (
        <>
          <ConnectAiBtn primary block />
          <Gap h={8} />
          <Btn block onClick={() => setAttempt((n) => n + 1)}>Try again</Btn>
        </>
      ) : (
        <Btn block onClick={() => setAttempt((n) => n + 1)}>Try again</Btn>
      )}
    </>
  )
}
