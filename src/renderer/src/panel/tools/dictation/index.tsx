/**
 * Dictation in the v2 panel: hold a key, talk, let go, and the words are
 * typed where the cursor is. John, 24 Oct 2026: "dictation should be its own
 * simple product in the launch" — one page with on/off, the hold key, the
 * balance and Add $5–$20, not buried in Launcher Settings.
 *
 * The rules (what to show for each account state, permission and status) are
 * in @shared/dictation-view and checked in scripts/checks/dictation-tool.
 * Recording, the pill and paying all stay in src/main/dictation.
 *
 * Ungated: dictation came from the free launcher and keeps that access rule;
 * the prepaid balance is tied to the licence on PeakFlow's server.
 * Routes: dictation, dictation/settings, dictation/key, dictation/words.
 */

import { useEffect, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationAccount, TopupAmount } from '@shared/dictation-account'
import type { DictationSettings } from '@shared/launcher/types'
import {
  COPY, buyLabel, dictationStatus, holdKeyName, holdKeys, howTo, missingPermission, payView, pickAmount,
  type DictationPermissions, type PayView
} from '@shared/dictation-view'
import type { PanelToolModule } from '../../types'
import { invoke, isMac, useInvoke, useIpcEvent, usePanelVisible } from '../../hooks'
import { Banner, Btn, Gap, Grp, Note, Picker, Primary, Row, Seg, Toggle } from '../../kit'
import { useNav } from '../../nav'

// ─── data ────────────────────────────────────────────────────────────────────

function useDictation(): {
  s: DictationSettings | undefined
  setS: (v: DictationSettings) => void
  account: DictationAccount | undefined
  perms: DictationPermissions | undefined
  setPerms: (v: DictationPermissions) => void
} {
  const [s, reloadS, setS] = useInvoke<DictationSettings>(IPC_INVOKE.DICTATION_SETTINGS)
  const [account, reloadAccount] = useInvoke<DictationAccount>(IPC_INVOKE.DICTATION_ACCOUNT)
  const [perms, reloadPerms, setPerms] = useInvoke<DictationPermissions>(IPC_INVOKE.DICTATION_PERMISSIONS)
  useIpcEvent(IPC_SEND.DICTATION_ACCOUNT_CHANGED, () => {
    reloadAccount()
    // A purchase can make dictation usable (the switch and the how-to line follow)
    reloadS()
  })
  useIpcEvent(IPC_SEND.LICENSE_STATUS_CHANGED, reloadAccount)
  // The header status and the page each hold settings: main says when they change (Sol review R1)
  useIpcEvent(IPC_SEND.DICTATION_SETTINGS_CHANGED, reloadS)
  // While a permission is missing, look again every few seconds so the page
  // catches up when it's switched on in System Settings
  const visible = usePanelVisible()
  const missing = !!missingPermission(perms)
  useEffect(() => {
    if (!missing || !visible) return
    const t = setInterval(reloadPerms, 2500)
    return () => clearInterval(t)
  }, [missing, visible, reloadPerms])
  return { s, setS, account, perms, setPerms }
}

function useStatus(): string {
  const { s, account, perms } = useDictation()
  return dictationStatus(s, account, perms)
}

const setting = (key: string, value: unknown): Promise<DictationSettings> => invoke<DictationSettings>(IPC_INVOKE.DICTATION_SET, key, value)

// ─── main screen ─────────────────────────────────────────────────────────────

const PERMISSION_TEXT = {
  accessibility: ['Needs Accessibility access', 'PeakFlow needs it to see when you hold the key and to type your words.'],
  microphone: ['Needs Microphone access', 'PeakFlow uses it to hear you while you hold the key.']
} as const

function Main(): React.JSX.Element {
  const { s, setS, account, perms, setPerms } = useDictation()
  if (!s) return <div style={{ height: 300 }} />
  const mac = isMac()
  const missing = missingPermission(perms)
  const keyName = holdKeyName(s.holdKey, mac)
  const pay = payView(account)
  return (
    <>
      {missing ? (
        <>
          <Banner icon="shield">
            <b>{PERMISSION_TEXT[missing][0]}</b>
            <br />
            {PERMISSION_TEXT[missing][1]}
          </Banner>
          <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => invoke<DictationPermissions>(IPC_INVOKE.DICTATION_ALLOW).then(setPerms).catch(() => {})}>
            Allow
          </Btn>
        </>
      ) : null}

      {s.kept ? (
        <>
          <Banner icon="refresh">
            <b>Your last dictation didn’t go through</b>
            <br />
            {s.kept} {s.kept === 1 ? 'second' : 'seconds'} of talking is saved. Try again types it into the app you were using.
          </Banner>
          <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => invoke<boolean>(IPC_INVOKE.DICTATION_RETRY).catch(() => {})}>
            Try again
          </Btn>
        </>
      ) : null}

      <Grp>
        <Row
          label="Dictation"
          sub={s.hasKey ? howTo(keyName) : pay.kind === 'own-key' ? 'To turn it on, add your OpenAI key below.' : 'To turn it on, buy time below or add your OpenAI key.'}
          right={<Toggle label="Dictation" checked={s.enabled} disabled={!s.hasKey} onChange={(v) => void setting('enabled', v).then(setS)} />}
        />
        <Row
          label="Hold key"
          right={<Picker label="Hold key" value={s.holdKey} options={holdKeys(mac)} onChange={(k) => void setting('holdKey', k).then(setS)} />}
        />
      </Grp>
      {s.enabled && s.hint ? <Note style={{ marginTop: 8 }}>{s.hint}</Note> : null}

      <Gap h={14} />
      <Paying view={pay} ownKey={!!s.ownKey} />
    </>
  )
}

/** The balance and Add $5–$20 (or Get dictation), with the own key as the small second option. */
function Paying({ view, ownKey }: { view: PayView; ownKey: boolean }): React.JSX.Element {
  const [chosen, setChosen] = useState<TopupAmount | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  if (view.kind === 'own-key') {
    // The add-on isn't on sale in this build (or the server switch is off): the own key is the way in
    return (
      <Grp>
        <Row
          label="OpenAI key"
          sub="Dictation uses your own OpenAI key, which costs about 1 cent for every 2 minutes of talking."
          value={ownKey ? 'Saved' : 'Add'}
          go="dictation/key"
        />
      </Grp>
    )
  }

  const amounts = view.kind === 'buy' || view.kind === 'balance' ? view.amounts : []
  const amount = pickAmount(amounts, chosen)
  const buy = async (): Promise<void> => {
    if (amount === undefined) return
    setOpening(true)
    setError('')
    try {
      if (!(await invoke<boolean>(IPC_INVOKE.DICTATION_CHECKOUT, amount))) setError('Couldn’t open the checkout. Try again.')
    } catch {
      setError('Couldn’t open the checkout. Try again.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <Grp>
        {view.kind === 'buy' ? <Row label="Get dictation" sub={COPY.offer} /> : null}
        {view.kind === 'devices' ? <Row label="Balance" sub={COPY.devices} /> : null}
        {view.kind === 'balance' ? <Row label="Balance" value={view.line ?? undefined} sub={view.notice ?? undefined} /> : null}
      </Grp>
      {amount !== undefined ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {amounts.length > 1 ? (
            <div style={{ flex: 1 }} aria-label="Top-up amount" role="group">
              <Seg value={String(amount)} options={amounts.map((a) => [String(a), `US$${a}`] as [string, string])} onChange={(v) => setChosen(Number(v) as TopupAmount)} />
            </div>
          ) : null}
          <Btn primary disabled={opening} style={amounts.length > 1 ? { flex: 'none' } : { flex: 1 }} onClick={() => void buy()}>
            {buyLabel(view, amount)}
          </Btn>
        </div>
      ) : null}
      {error ? <Note style={{ marginTop: 6, color: 'var(--text)' }}>{error}</Note> : null}
      <Grp style={{ marginTop: 10 }}>
        <Row label="Use my own OpenAI key" tone="muted" value={ownKey ? 'On' : undefined} go="dictation/key" />
      </Grp>
    </>
  )
}

// ─── settings ────────────────────────────────────────────────────────────────

function Settings(): React.JSX.Element {
  const { s, setS } = useDictation()
  if (!s) return <div style={{ height: 120 }} />
  return (
    <>
      <Grp>
        <Row
          label="Clean up as you go"
          sub="Takes out “um”, adds punctuation, and keeps only the fix when you say “no wait”. Never changes names, numbers or “not”."
          right={<Toggle label="Clean up as you go" checked={s.cleanup} onChange={(v) => void setting('cleanup', v).then(setS)} />}
        />
        <Row label="My words" sub="Names and terms to spell your way" value={s.wordCount ? String(s.wordCount) : undefined} go="dictation/words" />
        <Row label="OpenAI key" value={s.ownKey ? 'Saved' : 'Not added'} go="dictation/key" />
      </Grp>
      <Note style={{ marginTop: 10 }}>The app’s name and the text before your cursor help dictation spell things right. Password fields are never read.</Note>
    </>
  )
}

const KEY_ERRORS: Record<string, string> = {
  bad_key: 'OpenAI didn’t accept that key.',
  network: 'Couldn’t reach OpenAI. Check the internet connection.',
  failed: 'Couldn’t save the key.'
}

function OwnKey(): React.JSX.Element {
  const nav = useNav()
  const { s, setS } = useDictation()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!s) return <div style={{ height: 120 }} />
  const save = (): void => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError('')
    invoke<{ ok: boolean; error?: string; settings: DictationSettings }>(IPC_INVOKE.DICTATION_SAVE_KEY, key)
      .then((r) => {
        setS(r.settings)
        if (r.ok) {
          setKey('')
          nav.toast('Key saved. Dictation is on')
        } else setError(KEY_ERRORS[r.error ?? 'failed'] ?? KEY_ERRORS.failed)
      })
      .catch(() => setError(KEY_ERRORS.failed))
      .finally(() => setBusy(false))
  }
  if (s.ownKey) {
    return (
      <>
        <Grp>
          <Row
            label="OpenAI key"
            sub="Saved encrypted on this computer"
            right={<Btn sm onClick={() => invoke<DictationSettings>(IPC_INVOKE.DICTATION_REMOVE_KEY).then((v) => { setS(v); nav.toast('Key removed') }).catch(() => {})}>Remove</Btn>}
          />
        </Grp>
        <Note style={{ marginTop: 10 }}>If you also have a balance, dictation uses the balance first. Your key takes over when the balance can’t be used.</Note>
      </>
    )
  }
  return (
    <>
      <input
        className="text-in"
        type="password"
        placeholder="sk-…"
        aria-label="OpenAI API key"
        value={key}
        autoFocus
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      {error ? <Note style={{ marginTop: 6, color: 'var(--text)' }}>{error}</Note> : null}
      <Gap h={10} />
      <Primary onClick={save} disabled={busy || !key.trim()}>
        {busy ? 'Checking…' : 'Save key'}
      </Primary>
      <Note style={{ marginTop: 10 }}>Make a key at platform.openai.com. It costs about 1 cent for 2 minutes of talking, paid to OpenAI. The key stays encrypted on this computer.</Note>
    </>
  )
}

/** "My words": names and terms to spell the person's way, one per line; "X -> Y" always replaces. */
function Words(): React.JSX.Element {
  const nav = useNav()
  const [saved] = useInvoke<string>(IPC_INVOKE.DICTATION_WORDS)
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (saved !== undefined && text === null) setText(saved ?? '')
  }, [saved, text])
  if (text === null) return <div style={{ height: 200 }} />
  const lines = text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean)
  const hints = lines.filter((l) => !/(->|→)/.test(l)).length
  const reps = lines.length - hints
  const save = (): void => {
    invoke(IPC_INVOKE.DICTATION_SET_WORDS, text)
      .then(() => {
        nav.toast(hints ? `Saved ${hints} ${hints === 1 ? 'word' : 'words'}` : 'Saved')
        nav.back()
      })
      .catch(() => nav.toast('Couldn’t save'))
  }
  return (
    <>
      <textarea className="text-in" rows={8} aria-label="My words, one per line" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Siobhan\nPeakFlow\nManukora'} />
      <Note style={{ marginTop: 6, color: hints > 50 ? 'var(--text)' : undefined }}>
        {hints > 50
          ? `${hints} words. Lists over 50 make mistakes more likely, so keep the ones that come out wrong.`
          : `${hints} ${hints === 1 ? 'word' : 'words'}${reps ? `, ${reps} always replaced` : ''}`}
      </Note>
      <Gap h={10} />
      <Primary onClick={save}>Save</Primary>
      <Note style={{ marginTop: 10 }}>
        One name or term per line. Dictation uses them as hints, so ordinary words still come through as spoken. To always swap a word, write <b>teh -&gt; the</b>.
      </Note>
    </>
  )
}

export const dictationTool: PanelToolModule = {
  id: 'dictation',
  name: 'Dictation',
  desc: 'Hold a key, talk, let go',
  icon: 'mic',
  ungated: true,
  useStatus,
  routes: {
    dictation: { kind: 'tool', tool: 'dictation', view: Main },
    'dictation/settings': { kind: 'sub', back: 'dictation', title: 'Dictation settings', view: Settings },
    'dictation/key': { kind: 'sub', back: 'dictation', title: 'Your OpenAI key', view: OwnKey },
    'dictation/words': { kind: 'sub', back: 'dictation/settings', title: 'My words', view: Words }
  }
}
