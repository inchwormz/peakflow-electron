/**
 * QuickBoard AI setup wizard (quickboard/setup/1–4, generating, error).
 * Same flow as the old OnboardingWizard: answers → CLIPBOARD_AI_ONBOARD →
 * preview → CLIPBOARD_ONBOARDING_APPLY_CONFIG. Skip marks setup done.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import { invoke } from '../../hooks'
import { Btn, Grp, Hero, LinkBtn, Row, V } from '../../kit'
import { useNav } from '../../nav'
import { reloadHistory, reloadTags, setQB, useQB, type OnboardConfig } from './store'
import { ConnectAiBtn, needsConnect } from './ConnectAi'
import './quickboard.css'

const ROLES = ['Developer', 'Designer', 'Writer', 'Project manager', 'Student', 'Marketing / sales', 'Support', 'Other']
const APPS = ['VS Code', 'Browser', 'Slack / Teams', 'Figma', 'Terminal', 'Email', 'Docs', 'Spreadsheets']
const PATTERNS = ['Code snippets', 'Links', 'Error messages', 'Text passages', 'Email addresses', 'File paths']

function Wiz({ n, title, children, next, nextLabel, nextDisabled }: { n: number; title: string; children: ReactNode; next?: () => void; nextLabel: string; nextDisabled?: boolean }): React.JSX.Element {
  const nav = useNav()
  const skip = (): void => {
    invoke(IPC_INVOKE.CONFIG_SET, { tool: 'quickboard', key: 'ai_onboarding_complete', value: true }).catch(() => {})
    nav.go('quickboard')
  }
  return (
    <>
      <div className="qb-steps">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= n ? 'on' : ''} />
        ))}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 12 }}>{title}</div>
      {children}
      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <LinkBtn onClick={skip}>Skip</LinkBtn>
        <span className="row" style={{ gap: 6 }}>
          {n > 1 && n < 4 ? <Btn sm onClick={() => nav.go(`quickboard/setup/${n - 1}`)}>Back</Btn> : null}
          <Btn primary sm disabled={nextDisabled || !next} onClick={next}>{nextLabel}</Btn>
        </span>
      </div>
    </>
  )
}

function Chips({ list, on, toggle }: { list: string[]; on: string[]; toggle: (c: string) => void }): React.JSX.Element {
  return (
    <div className="chips" style={{ justifyContent: 'center' }}>
      {list.map((c) => (
        <button key={c} className="chip" aria-pressed={on.includes(c)} onClick={() => toggle(c)}>{c}</button>
      ))}
    </div>
  )
}

const flip = (list: string[], c: string): string[] => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c])

export function Setup1(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  const set = (p: Partial<typeof w>): void => setQB((s) => ({ wizard: { ...s.wizard, ...p } }))
  const role = w.role === 'Other' ? w.customRole.trim() : w.role
  return (
    <Wiz n={1} title="What do you do?" nextLabel="Next" nextDisabled={!role} next={() => nav.go('quickboard/setup/2')}>
      <Chips list={ROLES} on={[w.role]} toggle={(c) => set({ role: w.role === c ? '' : c })} />
      {w.role === 'Other' ? (
        <input className="text-in" style={{ marginTop: 12 }} placeholder="Your role" aria-label="Your role" maxLength={60} value={w.customRole} onChange={(e) => set({ customRole: e.target.value })} />
      ) : null}
    </Wiz>
  )
}

export function Setup2(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  return (
    <Wiz n={2} title="Which apps do you use daily?" nextLabel="Next" nextDisabled={!w.apps.length} next={() => nav.go('quickboard/setup/3')}>
      <Chips list={APPS} on={w.apps} toggle={(c) => setQB((s) => ({ wizard: { ...s.wizard, apps: flip(s.wizard.apps, c) } }))} />
    </Wiz>
  )
}

export function Setup3(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  return (
    <Wiz n={3} title="What do you copy most?" nextLabel="Generate setup" next={() => nav.go('quickboard/setup/generating')}>
      <Chips list={PATTERNS} on={w.patterns} toggle={(c) => setQB((s) => ({ wizard: { ...s.wizard, patterns: flip(s.wizard.patterns, c) } }))} />
      <textarea
        className="text-in"
        rows={3}
        style={{ marginTop: 12 }}
        placeholder="Anything you type over and over?"
        aria-label="Anything you type over and over?"
        maxLength={2000}
        value={w.repetitive}
        onChange={(e) => setQB((s) => ({ wizard: { ...s.wizard, repetitive: e.target.value } }))}
      />
    </Wiz>
  )
}

const ERR: Record<string, string> = {
  timeout: 'It took too long. Try again.',
  not_licensed: 'AI setup needs a PeakFlow licence.',
  no_provider: 'QuickBoard’s AI runs on your own ChatGPT or Claude. Connect one, then try again.',
  not_signed_in: 'You’re signed out of ChatGPT or Claude. Connect signs you back in, then try again.',
  codex_outdated: 'Your Codex app is too old for PeakFlow. Update it in Terminal with “npm install -g @openai/codex”, then try again.'
}

export function SetupGenerating(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const role = w.role === 'Other' ? w.customRole.trim() : w.role
    invoke<{ ok: boolean; config?: OnboardConfig; error?: string }>(IPC_INVOKE.CLIPBOARD_AI_ONBOARD, {
      role,
      apps: w.apps,
      copyPatterns: w.patterns,
      repetitiveText: w.repetitive
    })
      .then((res) => {
        if (res?.ok && res.config) {
          setQB((s) => ({ wizard: { ...s.wizard, config: res.config ?? null, error: '' } }))
          nav.go('quickboard/setup/4')
        } else {
          setQB((s) => ({ wizard: { ...s.wizard, error: res?.error ?? '' } }))
          nav.go('quickboard/setup/error')
        }
      })
      .catch(() => {
        setQB((s) => ({ wizard: { ...s.wizard, error: 'network_error' } }))
        nav.go('quickboard/setup/error')
      })
  }, [w, nav])
  return (
    <Wiz n={4} title="Your setup" nextLabel="Generating…">
      <Hero icon="sparkle" title="Generating your setup…">Picking tags, templates, workflows and forms for you.</Hero>
    </Wiz>
  )
}

export function Setup4(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  const c = w.config
  if (!c) {
    return (
      <Wiz n={4} title="Your setup" nextLabel="Generate setup" next={() => nav.go('quickboard/setup/generating')}>
        <Hero icon="sparkle" title="No setup yet">Answer the questions first.</Hero>
      </Wiz>
    )
  }
  const names = (l?: Array<{ name: string }>): string => (l?.length ? l.map((x) => x.name).join(', ') : 'None')
  const apply = (): void => {
    invoke(IPC_INVOKE.CLIPBOARD_ONBOARDING_APPLY_CONFIG, c)
      .then(() => {
        reloadHistory()
        reloadTags()
        nav.go('quickboard')
        nav.toast('Setup applied')
      })
      .catch(() => nav.toast('Couldn’t apply the setup'))
  }
  return (
    <Wiz n={4} title="Your setup" nextLabel="Apply and start" next={apply}>
      <Grp>
        <Row label="Tags" value={c.tags?.length ? c.tags.map((t) => `#${t}`).join(' ') : 'None'} />
        <Row label="Pinned templates" right={<V>{c.pinnedTemplates?.length ?? 0}</V>} />
        <Row label="Workflows" value={names(c.workflows)} />
        <Row label="Forms" value={names(c.formProfiles)} />
      </Grp>
      <div style={{ textAlign: 'center', marginTop: 10 }}>
        <LinkBtn onClick={() => nav.go('quickboard/setup/generating')}>Re-generate</LinkBtn>
      </div>
    </Wiz>
  )
}

export function SetupError(): React.JSX.Element {
  const nav = useNav()
  const { wizard: w } = useQB()
  return (
    <Wiz n={4} title="Your setup" nextLabel="Try again" next={() => nav.go('quickboard/setup/generating')}>
      <Hero icon="info" title="Couldn’t generate a setup">{ERR[w.error] ?? 'Something went wrong. Try again.'}</Hero>
      {needsConnect(w.error) ? (
        <div style={{ marginTop: 12 }}>
          <ConnectAiBtn block />
        </div>
      ) : null}
    </Wiz>
  )
}
