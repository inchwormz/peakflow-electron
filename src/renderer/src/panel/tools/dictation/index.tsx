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

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { historyTime } from '@shared/dictation-history-time'
import { weeklyNow, minutesSaved } from '@shared/dictation-stats'
import { microphoneOptions } from '@shared/dictation-microphone'
import { createLatest } from '@shared/latest-only'
import { HOLD_KEY_COPY, type NativeHoldKey } from '@shared/dictation-key'
import { watchAccount } from './refresh'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationAccount, TopupAmount } from '@shared/dictation-account'
import type { DictationSettings } from '@shared/launcher/types'
import {
  COPY, buyLabel, dictationStatus, holdKeyName, howTo, missingPermission, payView, pickAmount,
  type DictationPermissions, type PayView
} from '@shared/dictation-view'
import type { PanelToolModule } from '../../types'
import { invoke, isMac, useInvoke, useIpcEvent, usePanelVisible } from '../../hooks'
import { Banner, Btn, Gap, Grp, Note, Primary, Row, Seg, Toggle, Picker, LinkBtn } from '../../kit'
import { useNav } from '../../nav'
import { PermissionNotice, openPermission } from '../../permission'
import { guideCopy } from '@shared/mac-permissions'

// ─── data ────────────────────────────────────────────────────────────────────

function useDictation(): {
  s: DictationSettings | undefined
  takeS: <T extends DictationSettings | { settings: DictationSettings }>(call: Promise<T>) => Promise<T>
  checkoutOpened: () => void
  account: DictationAccount | undefined
  perms: DictationPermissions | undefined
  setPerms: (v: DictationPermissions) => void
} {
  const [s, setS] = useState<DictationSettings>()
  const latest = useRef(createLatest()).current
  const takeS = useCallback(async <T extends DictationSettings | { settings: DictationSettings },>(call: Promise<T>): Promise<T> => {
    const current = latest.next()
    const value = await call
    if (current()) setS('settings' in value ? value.settings : value)
    return value
  }, [latest])
  const reloadS = useCallback(() => { void takeS(invoke<DictationSettings>(IPC_INVOKE.DICTATION_SETTINGS)).catch(() => {}) }, [takeS])
  const [account, setAccount] = useState<DictationAccount>()
  const watcher = useRef<ReturnType<typeof watchAccount<DictationAccount>> | null>(null)
  const reloadAccount = useCallback(() => window.dispatchEvent(new Event('dictation:refresh-account')), [])
  useEffect(() => {
    watcher.current = watchAccount<DictationAccount>({
      fetch: () => invoke<DictationAccount>(IPC_INVOKE.DICTATION_ACCOUNT),
      onValue: setAccount, onError: () => {},
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      onFocus: (fn) => { window.addEventListener('focus', fn); return () => window.removeEventListener('focus', fn) },
      onRefreshEvents: [(fn) => { window.addEventListener('dictation:refresh-account', fn); return () => window.removeEventListener('dictation:refresh-account', fn) }]
    })
    return () => { watcher.current?.stop(); watcher.current = null }
  }, [])
  const checkoutOpened = useCallback(() => watcher.current?.checkoutOpened(), [])
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
  useEffect(() => {
    if (visible) { reloadS(); reloadAccount() }
    return () => latest.cancel()
  }, [visible, reloadS, reloadAccount, latest])
  const missing = !!missingPermission(perms)
  useEffect(() => {
    if (!missing || !visible) return
    const t = setInterval(reloadPerms, 2500)
    return () => clearInterval(t)
  }, [missing, visible, reloadPerms])
  // Back from System Settings: check at once, so the warning clears without waiting for the poll
  useEffect(() => {
    window.addEventListener('focus', reloadPerms)
    return () => window.removeEventListener('focus', reloadPerms)
  }, [reloadPerms])
  return { s, takeS, checkoutOpened, account, perms, setPerms }
}

function useStatus(): string {
  const { s, account, perms } = useDictation()
  return dictationStatus(s, account, perms)
}

const setting = (key: string, value: unknown): Promise<DictationSettings> => invoke<DictationSettings>(IPC_INVOKE.DICTATION_SET, key, value)

// ─── main screen ─────────────────────────────────────────────────────────────

/** Why dictation needs each permission. The rest of the wording, the steps and "All set" are shared (@shared/mac-permissions). */
const PERMISSION_WHY = {
  accessibility: 'Dictation uses it to see when you hold the key and to type your words.',
  microphone: 'Dictation uses it to hear you while you hold the key.'
} as const

function Main(): React.JSX.Element {
  const { s, takeS, checkoutOpened, account, perms, setPerms } = useDictation()
  const [capturing, setCapturing] = useState(false)
  const [keyError, setKeyError] = useState('')
  const captureStamp = useRef(createLatest()).current
  useEffect(() => () => {
    captureStamp.cancel()
    void invoke(IPC_INVOKE.DICTATION_RECORD_KEY, false)
  }, [captureStamp])
  const changeKey = async (): Promise<void> => {
    const current = captureStamp.next()
    setCapturing(true)
    setKeyError('')
    try {
      const key = await invoke<NativeHoldKey | 'rejected' | null>(IPC_INVOKE.DICTATION_RECORD_KEY, true)
      if (!current()) return
      if (key === 'rejected') setKeyError(HOLD_KEY_COPY.rejection(isMac()))
      else if (key) await takeS(setting('holdKey', key))
    } finally { if (current()) setCapturing(false) }
  }
  if (!s) return <div style={{ height: 300 }} />
  const mac = isMac()
  const missing = missingPermission(perms)
  const keyName = holdKeyName(s.holdKey, mac)
  const pay = payView(account)
  return (
    <>
      {missing === 'microphone' && perms?.microphone === 'not-determined' ? (
        // macOS hasn't asked yet: Allow shows its own prompt (the shared guide is for a switch that's off)
        <>
          <Banner icon="shield">
            <b>{guideCopy('microphone', false).title}</b>
            <br />
            {PERMISSION_WHY.microphone} macOS asks once.
          </Banner>
          <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => void invoke<DictationPermissions>(IPC_INVOKE.DICTATION_ALLOW).then(setPerms).catch(() => {})}>
            Allow
          </Btn>
        </>
      ) : missing === 'accessibility' && s.enabled ? (
        // Dictation is on but the hold key can't be heard: a visible warning with Open settings
        <div className="pg pg-compact" style={{ marginBottom: 14 }}>
          <Banner icon="shield">
            <b>{perms?.accessibilityLost ? 'macOS forgot PeakFlow after the update' : 'Hold-to-talk needs Accessibility'}</b>
            <br />
            {perms?.accessibilityLost
              ? 'Hold-to-talk and snippets stop until you fix it: select PeakFlow in Accessibility, click −, then + and add it again.'
              : 'Hold-to-talk needs Accessibility. Open settings to switch PeakFlow on.'}
          </Banner>
          <Btn primary block style={{ marginTop: 8 }} onClick={() => openPermission('accessibility')}>
            Open settings
          </Btn>
        </div>
      ) : missing ? (
        // The same notice as SnapGrid and FocusDim: what happened (including "macOS forgot PeakFlow
        // after the update"), Show me how (the step-by-step guide) and Open Settings
        <PermissionNotice kind={missing} why={PERMISSION_WHY[missing]} />
      ) : null}

      {s.kept ? (
        <>
          <Banner icon="refresh">
            <b>Your last dictation didn’t go through</b>
            <br />
            {s.kept} {s.kept === 1 ? 'second' : 'seconds'} of talking is saved. Try again types it into the app you were using.
          </Banner>
          <Btn block style={{ marginTop: 12, marginBottom: 14 }} onClick={() => void invoke<boolean>(IPC_INVOKE.DICTATION_RETRY).catch(() => {})}>
            Try again
          </Btn>
        </>
      ) : null}

      <Grp>
        <Row
          label="Dictation"
          sub={s.hasKey ? howTo(keyName) : pay.kind === 'own-key' ? 'To turn it on, add your OpenAI key below.' : 'To turn it on, buy time below or add your OpenAI key.'}
          right={<Toggle label="Dictation" checked={s.enabled} disabled={!s.hasKey} onChange={(v) => void takeS(setting('enabled', v))} />}
        />
        <Row
          label={HOLD_KEY_COPY.label}
          value={capturing ? undefined : keyName}
          sub={capturing ? HOLD_KEY_COPY.recording : undefined}
          right={capturing ? <Btn sm onClick={() => void invoke(IPC_INVOKE.DICTATION_RECORD_KEY, false)}>{HOLD_KEY_COPY.cancel}</Btn> : <Btn sm onClick={() => void changeKey()}>{HOLD_KEY_COPY.change}</Btn>}
        />
      </Grp>
      <Grp style={{ marginTop: 10 }}><Microphone value={s.microphone ?? ''} onChange={(v) => void takeS(setting('microphone', v))} /></Grp>
      {keyError ? <Note style={{ marginTop: 8 }}>{keyError}</Note> : null}
      {s.enabled && s.hint ? <Note style={{ marginTop: 8 }}>{s.hint}</Note> : null}

      <Gap h={14} />
      <Paying view={pay} ownKey={!!s.ownKey} checkoutOpened={checkoutOpened} />
      <Gap h={14} />
      <Recent />
    </>
  )
}

function Microphone({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [options, setOptions] = useState<Array<[string, string]>>([['', 'System default']])
  useEffect(() => {
    let alive = true
    const refresh = (): void => { void navigator.mediaDevices.enumerateDevices().then((devices) => { if (alive) setOptions(microphoneOptions(devices)) }).catch(() => {}) }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    window.addEventListener('focus', refresh)
    return () => { alive = false; navigator.mediaDevices.removeEventListener('devicechange', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  return <Row label="Microphone" right={<Picker label="Microphone" value={options.some(([id]) => id === value) ? value : ''} options={options} onChange={onChange} />} />
}

function Recent(): React.JSX.Element {
  const { s, takeS } = useDictation()
  const nav = useNav()
  const [all, setAll] = useState(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  if (!s) return <></>
  const history = s.history ?? []
  const weekly = weeklyNow(s.weekly)
  return (
    <>
      {isMac() ? <Note>Recent</Note> : null}
      <Note>{weekly.words} words this week, about {minutesSaved(weekly)} minutes saved</Note>
      {isMac() ? <Grp style={{ marginTop: 4 }}>
        <Row label="Keep history" right={<Toggle label="Keep history" checked={s.keepHistory !== false} onChange={(v) => void takeS(setting('keepHistory', v))} />} />
        {(all ? history : history.slice(0, 5)).map((entry, i) => (
          <HistoryRow key={`${entry.at}-${i}`} entry={entry} now={now} />
        ))}
        {history.length ? <div className="r">
          {history.length > 5 ? <LinkBtn onClick={() => setAll(!all)}>{all ? 'Show less' : 'Show all'}</LinkBtn> : null}
          <LinkBtn style={{ marginLeft: 'auto' }} onClick={() => void takeS(setting('clearHistory', true)).catch(() => nav.toast('Could not clear history'))}>Clear</LinkBtn>
        </div> : null}
      </Grp> : null}
    </>
  )
}

/** A native button keeps Enter and Space copying identical to a pointer click. */
function HistoryRow({ entry, now }: { entry: { text: string; at: number; app?: string }; now: Date }): React.JSX.Element {
  const nav = useNav()
  const metadataId = useId()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [])
  const copy = async (): Promise<void> => {
    try {
      await invoke(IPC_INVOKE.CLIPBOARD_WRITE_TEXT, entry.text)
      if (!alive.current) return
      clearTimeout(timer.current)
      setCopied(true)
      timer.current = setTimeout(() => setCopied(false), 1200)
    } catch { if (alive.current) nav.toast('Could not copy') }
  }
  return <button type="button" className="r dictation-history-row" aria-label={'Copy: ' + entry.text} aria-describedby={metadataId} onClick={() => void copy()}>
    <span className="l">{entry.text}<small id={metadataId} aria-live="polite">{copied ? 'Copied' : [historyTime(entry.at, now), entry.app].filter(Boolean).join(' · ')}</small></span>
    <span className="ri hk link" aria-hidden="true">Copy</span>
  </button>
}

/** The balance and Add $5–$20 (or Get dictation), with the own key as the small second option. */
function Paying({ view, ownKey, checkoutOpened }: { view: PayView; ownKey: boolean; checkoutOpened: () => void }): React.JSX.Element {
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
      checkoutOpened()
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
  const { s, takeS } = useDictation()
  if (!s) return <div style={{ height: 120 }} />
  return (
    <>
      <Grp>
        <Row
          label="Clean up as you go"
          sub="Takes out “um”, adds punctuation, and keeps only the fix when you say “no wait”. Never changes names, numbers or “not”."
          right={<Toggle label="Clean up as you go" checked={s.cleanup} onChange={(v) => void takeS(setting('cleanup', v))} />}
        />
        <Row
          label="Voice snippets"
          sub="Say a snippet's keyword to insert its text."
          right={<Toggle label="Voice snippets" checked={s.voiceSnippets} onChange={(v) => void takeS(setting('voiceSnippets', v))} />}
        />
        {isMac() ? <>
          <Row label="Command mode" sub="Select text, hold your command key and say how to change it."
            right={<Toggle label="Command mode" checked={!!s.commandMode} onChange={(v) => void takeS(setting('commandMode', v))} />} />
          {s.commandMode ? <CommandKey value={s.commandKey ?? null} takeS={takeS} /> : null}
        </> : null}
        <Row label="My words" sub="Names and terms to spell your way" value={s.wordCount ? String(s.wordCount) : undefined} go="dictation/words" />
        <Row label="OpenAI key" value={s.ownKey ? 'Saved' : 'Not added'} go="dictation/key" />
      </Grp>
      {isMac() && s.commandMode ? <Note style={{ marginTop: 10 }}>The selection and spoken instruction go to OpenAI. Other apps may use the same key.</Note> : null}
      <Note style={{ marginTop: 10 }}>The app’s name and the text before your cursor help dictation spell things right. Password fields are never read.</Note>
    </>
  )
}

/** Same physical-key recorder and allowlist as Hold to talk. */
function CommandKey({ value, takeS }: { value: NativeHoldKey | null; takeS: ReturnType<typeof useDictation>['takeS'] }): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const stamp = useRef(createLatest()).current
  useEffect(() => () => { stamp.cancel(); void invoke(IPC_INVOKE.DICTATION_RECORD_KEY, false) }, [stamp])
  const change = async (): Promise<void> => {
    const current = stamp.next()
    setCapturing(true); setError('')
    try {
      const key = await invoke<NativeHoldKey | 'rejected' | null>(IPC_INVOKE.DICTATION_RECORD_KEY, true)
      if (!current()) return
      if (key === 'rejected') setError(HOLD_KEY_COPY.rejection(true))
      else if (key) {
        const saved = await takeS(setting('commandKey', key))
        if (current() && saved.commandKey?.code !== key.code) setError('Pick a key that PeakFlow isn’t already using.')
      }
    } finally { if (current()) setCapturing(false) }
  }
  return <>
    <Row label="Command key" value={capturing ? undefined : value?.label ?? 'Not set'} sub={capturing ? HOLD_KEY_COPY.recording : error || undefined}
      right={capturing ? <Btn sm onClick={() => void invoke(IPC_INVOKE.DICTATION_RECORD_KEY, false)}>{HOLD_KEY_COPY.cancel}</Btn>
        : <Btn sm onClick={() => void change()}>{HOLD_KEY_COPY.change}</Btn>} />
  </>
}

const KEY_ERRORS: Record<string, string> = {
  bad_key: 'OpenAI didn’t accept that key.',
  network: 'Couldn’t reach OpenAI. Check the internet connection.',
  failed: 'Couldn’t save the key.'
}

function OwnKey(): React.JSX.Element {
  const nav = useNav()
  const { s, takeS } = useDictation()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!s) return <div style={{ height: 120 }} />
  const save = (): void => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError('')
    takeS(invoke<{ ok: boolean; error?: string; settings: DictationSettings }>(IPC_INVOKE.DICTATION_SAVE_KEY, key))
      .then((r) => {
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
            right={<Btn sm onClick={() => void takeS(invoke<DictationSettings>(IPC_INVOKE.DICTATION_REMOVE_KEY)).then(() => { nav.toast('Key removed') }).catch(() => {})}>Remove</Btn>}
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
