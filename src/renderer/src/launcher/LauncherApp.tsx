/**
 * The launcher bar (⌥Space / Alt+Space). Keyboard first: type, ↑↓, Enter.
 * Esc steps back a view, clears the search, then closes.
 *
 * Views: search (default) · kill (Kill Process) · ai (an answer streaming in)
 * · snippet-form · link-form · settings · ai-setup (connect ChatGPT/Claude).
 * Ranking and the calculator run here on every keystroke; files come from
 * main a moment later. Main only ever receives item ids, never paths.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type {
  AiChunk, AiProviderId, AiStatus, AiTextAction, CurrencyRates, LauncherItem, LauncherOpenInfo, LauncherProcess,
  LauncherRunResult, LauncherSettings, SelectionResult, DictationHoldKey, DictationSettings
} from '@shared/launcher/types'
import type { PermissionStatus } from '@shared/mac-permissions'
import { rankItems, type Usage } from '@shared/launcher/rank'
import { calculate, type CalcResult } from '@shared/launcher/calc'
import { invoke, isMac, formatAccelerator } from '../panel/hooks'
import { Icon } from '../panel/icons'
import { Glyph } from './glyphs'
import '../panel/panel.css'
import './launcher.css'
import { DictationAccountRow } from './DictationAccountRow'

type View = 'search' | 'kill' | 'ai' | 'snippet-form' | 'link-form' | 'settings' | 'ai-setup' | 'words'

interface AiRun {
  reqId: number
  title: string
  text: string
  done: boolean
  error?: string
  /** What to re-run when the provider changes */
  redo: { prompt: string; action?: AiTextAction; text?: string; language?: string }
}

const MOD = isMac() ? '⌘' : 'Ctrl'
const PROVIDER_NAMES: Record<AiProviderId, string> = { codex: 'ChatGPT', claude: 'Claude', ollama: 'Local model' }

const AI_ACTIONS: Array<{ action: AiTextAction; title: string; keywords: string[] }> = [
  { action: 'grammar', title: 'Fix spelling and grammar', keywords: ['fix', 'grammar', 'spelling', 'proofread', 'correct'] },
  { action: 'rewrite', title: 'Rewrite selected text', keywords: ['rewrite', 'rephrase', 'improve', 'polite', 'shorter', 'tone'] },
  { action: 'summarise', title: 'Summarise selected text', keywords: ['summarise', 'summarize', 'summary', 'tldr', 'bullet'] },
  { action: 'translate', title: 'Translate selected text', keywords: ['translate', 'translation', 'language'] },
  { action: 'explain', title: 'Explain selected text', keywords: ['explain', 'what does this mean', 'simplify'] }
]

const KIND_LABEL: Record<string, string> = {
  app: 'Application', file: 'File', setting: 'Settings', command: 'Command', tool: 'PeakFlow', window: 'Window',
  link: 'Quick link', search: 'Web search', snippet: 'Snippet', ai: 'AI'
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.round(n / 1e3)} KB`
}

/** "translate to french" → "French" */
function languageFrom(q: string): string | undefined {
  const m = /\b(?:to|into|in)\s+([a-z\u00c0-\uffff]+(?:\s[a-z]+)?)\s*$/i.exec(q)
  return m ? m[1].replace(/^\w/, (c) => c.toUpperCase()) : undefined
}

// ─── icons (real app/file icons, fetched once) ───────────────────────────────

const iconCache = new Map<string, string | null>()
const iconWaiters = new Map<string, Promise<string | null>>()

function useIcon(path: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(path ? iconCache.get(path) ?? null : null)
  useEffect(() => {
    if (!path) return setSrc(null)
    if (iconCache.has(path)) return setSrc(iconCache.get(path) ?? null)
    let live = true
    let p = iconWaiters.get(path)
    if (!p) {
      p = invoke<string | null>(IPC_INVOKE.LAUNCHER_ICON, path).catch(() => null)
      iconWaiters.set(path, p)
    }
    void p.then((v) => {
      iconCache.set(path, v)
      iconWaiters.delete(path)
      if (live) setSrc(v)
    })
    return () => {
      live = false
    }
  }, [path])
  return src
}

function RowIcon({ item }: { item: LauncherItem }): React.JSX.Element {
  const src = useIcon(item.iconPath)
  if (src) return <span className="lc-ic img"><img src={src} alt="" /></span>
  return <span className="lc-ic"><Glyph name={item.glyph ?? (item.kind === 'app' ? 'app' : item.kind === 'file' ? 'file' : undefined)} /></span>
}

function Row({ item, sel, onPick, onHover, right }: { item: LauncherItem; sel: boolean; onPick: () => void; onHover: () => void; right?: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  return (
    <div ref={ref} className={`lc-row${sel ? ' sel' : ''}`} onMouseMove={onHover} onClick={onPick} role="option" aria-selected={sel}>
      <RowIcon item={item} />
      <span className="lc-tx">
        <span className="lc-t">{item.title}</span>
        {item.subtitle && <span className="lc-s">{item.subtitle}</span>}
      </span>
      {right ?? (item.tag ? <span className="lc-tag">{item.tag}</span> : <span className="lc-kind">{KIND_LABEL[item.kind]}</span>)}
    </div>
  )
}

function Hint({ k, label }: { k: string; label: string }): React.JSX.Element {
  return (
    <span className="lc-hint">
      <kbd>{k}</kbd>
      {label}
    </span>
  )
}

// ─── the app ─────────────────────────────────────────────────────────────────

export function LauncherApp(): React.JSX.Element {
  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<LauncherItem[]>([])
  const [usage, setUsage] = useState<Record<string, Usage>>({})
  const [files, setFiles] = useState<{ q: string; list: LauncherItem[] }>({ q: '', list: [] })
  const [sel, setSel] = useState(0)
  const [rates, setRates] = useState<CurrencyRates | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<LauncherItem | null>(null)
  const [procs, setProcs] = useState<LauncherProcess[] | null>(null)
  const [ai, setAi] = useState<AiRun | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [settings, setSettings] = useState<LauncherSettings | null>(null)
  const [editing, setEditing] = useState<LauncherItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const crumbRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openAt = useRef(0)
  const searchTimed = useRef(false)

  const flash = useCallback((m: string | undefined) => {
    if (!m) return
    setMessage(m)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMessage(null), 3500)
  }, [])

  const loadItems = useCallback(() => {
    void invoke<LauncherItem[]>(IPC_INVOKE.LAUNCHER_ITEMS).then(setItems)
    void invoke<Record<string, Usage>>(IPC_INVOKE.LAUNCHER_USAGE).then(setUsage)
  }, [])

  const loadAiStatus = useCallback(() => invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_STATUS).then(setAiStatus), [])

  // ── open / close ──
  useEffect(() => {
    loadItems()
    void loadAiStatus()
    void invoke<CurrencyRates | null>(IPC_INVOKE.LAUNCHER_RATES).then(setRates)
    // Windows can drop the focus given while the bar was hidden: put it back when the window gets focus
    const onWinFocus = (): void => {
      if (!document.activeElement || document.activeElement === document.body) inputRef.current?.focus()
    }
    window.addEventListener('focus', onWinFocus)
    const offShown = window.peakflow.on(IPC_SEND.LAUNCHER_SHOWN, (raw) => {
      const info = raw as LauncherOpenInfo
      openAt.current = info.at
      searchTimed.current = false
      setView('search')
      setQuery('')
      setSel(0)
      setConfirm(null)
      setMessage(null)
      setAi(null)
      setEditing(null)
      setFiles({ q: '', list: [] })
      loadItems()
      void loadAiStatus()
      // Opened on its settings (the tray menu's "Launcher Settings")
      if (info.view === 'settings') {
        void invoke<LauncherSettings>(IPC_INVOKE.LAUNCHER_SETTINGS).then(setSettings)
        setView('settings')
      }
      if (!rates) void invoke<CurrencyRates | null>(IPC_INVOKE.LAUNCHER_RATES).then(setRates)
      inputRef.current?.focus()
      // Open time: hotkey pressed → bar painted
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void invoke(IPC_INVOKE.LAUNCHER_READY, { openMs: Date.now() - info.at })
        })
      )
    })
    const offChanged = window.peakflow.on(IPC_SEND.LAUNCHER_CHANGED, () => loadItems())
    const offChunk = window.peakflow.on(IPC_SEND.LAUNCHER_AI_CHUNK, (raw) => {
      const c = raw as AiChunk
      setAi((prev) => (prev && prev.reqId === c.reqId ? { ...prev, text: c.text || prev.text, done: c.done, error: c.error } : prev))
    })
    void invoke(IPC_INVOKE.LAUNCHER_READY)
    return () => {
      offShown()
      window.removeEventListener('focus', onWinFocus)
      offChanged()
      offChunk()
    }
  }, [])

  // ── size follows content ──
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const top = el.querySelector<HTMLElement>('.lc-top')
      const body = el.querySelector<HTMLElement>('.lc-body')
      const foot = el.querySelector<HTMLElement>('.lc-foot')
      const content = body ? Array.from(body.children).reduce((h, c) => h + (c as HTMLElement).offsetHeight, 0) + 12 : 0
      const h = (top?.offsetHeight ?? 54) + (body ? Math.min(content, 440) : 0) + (foot?.offsetHeight ?? 34)
      void invoke(IPC_INVOKE.LAUNCHER_RESIZE, h)
    })
    ro.observe(el)
    const body = el.querySelector('.lc-body')
    if (body) Array.from(body.children).forEach((c) => ro.observe(c))
    const mo = new MutationObserver(() => {
      const b = el.querySelector('.lc-body')
      if (b) Array.from(b.children).forEach((c) => ro.observe(c))
    })
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  // ── files (a moment after typing stops) ──
  useEffect(() => {
    if (view !== 'search') return
    const q = query.trim()
    if (q.length < 2 || calculate(q, { currency: rates })) {
      setFiles({ q, list: [] })
      return
    }
    const t = setTimeout(() => {
      void invoke<LauncherItem[]>(IPC_INVOKE.LAUNCHER_FILES, q).then((list) => setFiles({ q, list }))
    }, 140)
    return () => clearTimeout(t)
  }, [query, view, rates])

  // ── search results ──
  const providerName = aiStatus?.selected ? PROVIDER_NAMES[aiStatus.selected] : null
  const calc = useMemo<CalcResult | { pending: 'currency' } | null>(() => (view === 'search' ? calculate(query, { currency: rates }) : null), [query, rates, view])

  const results = useMemo<LauncherItem[]>(() => {
    if (view !== 'search') return []
    const t0 = performance.now()
    const q = query.trim()
    const lower = q.toLowerCase()
    const aiItems: LauncherItem[] = AI_ACTIONS.map((a) => ({
      id: `ai:${a.action}`, kind: 'ai', title: a.title, subtitle: providerName ? `with ${providerName}` : 'Connect an AI first', keywords: ['ai', ...a.keywords], glyph: 'sparkle'
    }))
    let ranked = rankItems([...items, ...aiItems], q, usage, 40)
    if (!q) {
      // Nothing typed: recent picks, then a few useful starting points
      const starters = ['view:kill', 'tool:quickboard', 'cmd:keep-awake', 'ai:grammar', 'view:snippet-form', 'view:settings']
        .map((id) => [...items, ...aiItems].find((i) => i.id === id))
        .filter((i): i is LauncherItem => !!i && !ranked.some((r) => r.id === i.id))
      ranked = [...ranked.slice(0, 6), ...starters].slice(0, 9)
    }
    const out: LauncherItem[] = []
    // "g pizza" → Search Google for pizza, first
    const sp = /^(\S+)\s+(.+)$/.exec(q)
    const engine = sp ? items.find((i) => i.kind === 'search' && i.prefix === sp[1].toLowerCase()) : undefined
    if (engine && sp) out.push({ ...engine, id: engine.id, title: `${engine.title.replace(/^Search /, 'Search ')} for “${sp[2]}”`, subtitle: undefined })
    out.push(...ranked.filter((r) => r.kind !== 'search' || !q))
    if (files.q === q) out.push(...files.list.slice(0, 8))
    if (q) {
      out.push({ id: 'ask', kind: 'ai', title: `Ask ${providerName ?? 'AI'}: “${q}”`, subtitle: providerName ? 'Tab' : 'Connect ChatGPT or Claude first', glyph: 'sparkle' })
      const google = items.find((i) => i.id === 'search:google')
      if (google && !engine) out.push({ ...google, title: `Search Google for “${q}”`, subtitle: undefined })
      if (!engine) out.push(...ranked.filter((r) => r.kind === 'search').slice(0, 2).map((r) => ({ ...r, title: `${r.title} for “${q}”`, subtitle: undefined })))
    }
    const ms = performance.now() - t0
    if (lower.length === 3 && !searchTimed.current) {
      searchTimed.current = true
      void invoke(IPC_INVOKE.LAUNCHER_READY, { searchMs: ms })
    }
    return out
  }, [view, query, items, usage, files, providerName])

  const calcShown = calc && 'display' in calc ? calc : null
  const rowCount = (calcShown ? 1 : 0) + results.length
  useEffect(() => setSel(0), [query, view])
  // Views without a text field still need the keyboard (Enter to copy, Esc to go back)
  useEffect(() => {
    if (view === 'ai' || view === 'settings' || view === 'ai-setup') crumbRef.current?.focus()
    else if (view === 'search' || view === 'kill') inputRef.current?.focus()
  }, [view])

  // ── actions ──
  const hide = (): void => void invoke(IPC_INVOKE.LAUNCHER_HIDE)

  const startAi = useCallback(
    async (title: string, redo: AiRun['redo'], provider?: AiProviderId) => {
      // Main picks the saved choice when no provider is given, so a stale list here can't send it to the wrong AI
      const status = await invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_STATUS)
      setAiStatus(status)
      if (!(provider ?? status.selected)) {
        setView('ai-setup')
        return
      }
      const reqId = await invoke<number>(IPC_INVOKE.LAUNCHER_AI_ASK, { ...redo, provider })
      setAi({ reqId, title, text: '', done: false, redo })
      setView('ai')
    },
    []
  )

  const runAiAction = useCallback(
    async (action: AiTextAction, extra: string) => {
      const a = AI_ACTIONS.find((x) => x.action === action)!
      flash('Reading the selected text…')
      const sel = await invoke<SelectionResult>(IPC_INVOKE.LAUNCHER_SELECTION)
      setMessage(null)
      if (!sel.trusted) {
        flash('PeakFlow needs the Accessibility permission to read selected text')
        void invoke(IPC_INVOKE.APP_OPEN_ACCESSIBILITY)
        return
      }
      if (!sel.text.trim()) {
        flash('Select some text in any app first, then open the launcher')
        return
      }
      const language = action === 'translate' ? languageFrom(extra) ?? 'English' : undefined
      // The words typed that aren't the action's own name become an extra instruction ("rewrite more politely")
      const instruction = a.keywords.some((k) => extra.toLowerCase().startsWith(k)) ? extra : ''
      void startAi(action === 'translate' ? `Translate selected text to ${language}` : a.title, { prompt: instruction, action, text: sel.text, language })
    },
    [flash, startAi]
  )

  const run = useCallback(
    async (item: LauncherItem, alt = false) => {
      if (item.confirm && !confirm) {
        setConfirm(item)
        return
      }
      setConfirm(null)
      if (item.id === 'ask') return void startAi(query.trim(), { prompt: query.trim() })
      if (item.id.startsWith('ai:')) return void runAiAction(item.id.slice(3) as AiTextAction, query.trim())
      if (item.view) {
        if (item.view === 'kill') {
          setProcs(null)
          void invoke<LauncherProcess[]>(IPC_INVOKE.LAUNCHER_PROCESSES).then(setProcs)
        }
        if (item.view === 'settings') void invoke<LauncherSettings>(IPC_INVOKE.LAUNCHER_SETTINGS).then(setSettings)
        if (item.view === 'ai-setup') void loadAiStatus()
        setEditing(null)
        setQuery('')
        setView(item.view)
        return
      }
      // "g pizza" searches Google for "pizza"; any other search row uses everything typed
      const q = query.trim()
      const searchFor = item.prefix && q.toLowerCase().startsWith(`${item.prefix} `) ? q.slice(item.prefix.length + 1).trim() : q
      const r = await invoke<LauncherRunResult>(IPC_INVOKE.LAUNCHER_RUN, item.id, { query: item.kind === 'search' ? searchFor : undefined, alt })
      if (r.keepOpen) {
        flash(r.message)
        loadItems()
      } else if (r.ok) {
        if (r.message) flash(r.message)
        hide()
      } else flash(r.message ?? 'That didn’t work')
    },
    [confirm, query, startAi, runAiAction, loadAiStatus, flash, loadItems]
  )

  const back = (): void => {
    setView('search')
    setQuery('')
    setAi((a) => {
      if (a && !a.done) void invoke(IPC_INVOKE.LAUNCHER_AI_CANCEL, a.reqId)
      return null
    })
    setConfirm(null)
    setEditing(null)
    inputRef.current?.focus()
  }

  // ── keyboard ──
  const killList = useMemo(() => {
    if (!procs) return []
    const q = query.trim().toLowerCase()
    return q ? procs.filter((p) => p.name.toLowerCase().includes(q)) : procs
  }, [procs, query])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMac() ? e.metaKey : e.ctrlKey
    if (e.key === 'Escape') {
      e.preventDefault()
      if (confirm) return setConfirm(null)
      if (view !== 'search') return back()
      if (query) return setQuery('')
      return hide()
    }
    if (view === 'ai' && ai) {
      if (e.key === 'Enter' && ai.done && ai.text) {
        e.preventDefault()
        void invoke(IPC_INVOKE.LAUNCHER_COPY, ai.text, { paste: mod })
      }
      return
    }
    if (view !== 'search' && view !== 'kill') return
    const count = view === 'kill' ? killList.length : rowCount
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setSel((s) => (count ? (s + 1) % count : 0))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setSel((s) => (count ? (s - 1 + count) % count : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (view === 'kill') {
        const p = killList[sel]
        if (!p) return
        void invoke<boolean>(IPC_INVOKE.LAUNCHER_QUIT_PROCESS, p.pid, mod).then((ok) => {
          flash(ok ? `${mod ? 'Force quit' : 'Quit'} ${p.name}` : `Couldn’t quit ${p.name}${mod ? '' : `: try ${MOD}+Enter to force quit`}`)
          setTimeout(() => void invoke<LauncherProcess[]>(IPC_INVOKE.LAUNCHER_PROCESSES).then(setProcs), 600)
        })
        return
      }
      if (confirm) return void run(confirm)
      if (calcShown && sel === 0) return void invoke(IPC_INVOKE.LAUNCHER_COPY, calcShown.copy)
      const item = results[sel - (calcShown ? 1 : 0)]
      if (item) void run(item, mod)
    } else if (e.key === 'Tab' && view === 'search' && query.trim()) {
      e.preventDefault()
      void startAi(query.trim(), { prompt: query.trim() })
    } else if (view === 'search' && mod && (e.key === 'e' || e.key === 'Backspace')) {
      const item = results[sel - (calcShown ? 1 : 0)]
      if (!item || (item.kind !== 'snippet' && !item.id.startsWith('link:'))) return
      e.preventDefault()
      if (e.key === 'e') {
        setEditing(item)
        setView(item.kind === 'snippet' ? 'snippet-form' : 'link-form')
      } else {
        void invoke(item.kind === 'snippet' ? IPC_INVOKE.LAUNCHER_DELETE_SNIPPET : IPC_INVOKE.LAUNCHER_DELETE_LINK, item.id).then(() => flash(`Deleted ${item.title}`))
      }
    }
  }

  // ── render ──
  const selectedItem = view === 'search' ? results[sel - (calcShown ? 1 : 0)] : undefined
  const inputShown = view === 'search' || view === 'kill'
  const crumb: Partial<Record<View, string>> = {
    kill: 'Kill Process', ai: ai?.title, 'snippet-form': editing ? 'Edit Snippet' : 'Add Snippet', 'link-form': editing ? 'Edit Quick Link' : 'Add Quick Link',
    settings: 'Launcher Settings', 'ai-setup': 'Connect AI', words: 'My words'
  }

  return (
    <div className="pf lc" ref={rootRef} style={{ height: '100vh' }} onKeyDown={onKeyDown}>
      <div className="lc-top">
        {view === 'search' ? (
          <Icon name="search" />
        ) : (
          <button className="lc-back" onClick={back} tabIndex={-1}>
            <Icon name="chevL" />
            Esc
          </button>
        )}
        {inputShown ? (
          <input
            ref={inputRef}
            className="lc-input"
            value={query}
            autoFocus
            spellCheck={false}
            placeholder={view === 'kill' ? 'Filter running apps…' : 'Search apps, files, commands, or ask AI…'}
            onChange={(e) => {
              setQuery(e.target.value)
              setConfirm(null)
            }}
          />
        ) : (
          <span className="lc-crumb grow" style={{ flex: 1 }} tabIndex={-1} ref={crumbRef}>
            {crumb[view]}
          </span>
        )}
        {view === 'kill' && <span className="lc-crumb">Kill Process</span>}
      </div>

      <div className="lc-body" role="listbox">
        {view === 'search' && (
          <>
            {confirm && (
              <div className="lc-confirm">
                <span className="t">{confirm.confirm}</span>
                <span className="row">
                  <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
                  <button className="btn primary" onClick={() => void run(confirm)}>{confirm.title}</button>
                </span>
              </div>
            )}
            {calcShown && (
              <div className={`lc-calc${sel === 0 ? ' sel' : ''}`} onClick={() => void invoke(IPC_INVOKE.LAUNCHER_COPY, calcShown.copy)}>
                <span className="big">{calcShown.display}</span>
                {calcShown.detail && <span className="small">{calcShown.detail}</span>}
              </div>
            )}
            {calc && 'pending' in calc && <div className="lc-calc"><span className="small">{rates === null ? 'Currency rates aren’t available offline yet' : 'Loading currency rates…'}</span></div>}
            {!query.trim() && results.length > 0 && <div className="lc-sec">Suggestions</div>}
            {results.map((it, i) => (
              <Row key={`${it.id}:${i}`} item={it} sel={sel === i + (calcShown ? 1 : 0)} onHover={() => setSel(i + (calcShown ? 1 : 0))} onPick={() => void run(it)} />
            ))}
            {query.trim() && !results.length && !calcShown && <div className="lc-empty">No matches</div>}
          </>
        )}

        {view === 'kill' && (
          <>
            {!procs && <div className="lc-empty">Looking at running apps…</div>}
            {procs && !killList.length && <div className="lc-empty">No running apps match</div>}
            {killList.map((p, i) => (
              <Row
                key={p.pid}
                item={{ id: `proc:${p.pid}`, kind: 'app', title: p.name, iconPath: p.path }}
                sel={sel === i}
                onHover={() => setSel(i)}
                onPick={() => setSel(i)}
                right={<span className="lc-kind lc-mem">{formatBytes(p.memory)}</span>}
              />
            ))}
          </>
        )}

        {view === 'ai' && ai && (
          <AiAnswer ai={ai} status={aiStatus} onProvider={(p) => {
            void invoke(IPC_INVOKE.LAUNCHER_AI_SET_PROVIDER, p).then((s) => setAiStatus(s as AiStatus))
            if (!ai.done) void invoke(IPC_INVOKE.LAUNCHER_AI_CANCEL, ai.reqId)
            void startAi(ai.title, ai.redo, p)
          }} onConnect={() => { void loadAiStatus(); setView('ai-setup') }} />
        )}

        {view === 'snippet-form' && <SnippetForm editing={editing} onDone={(m) => { flash(m); back() }} />}
        {view === 'link-form' && <LinkForm editing={editing} onDone={(m) => { flash(m); back() }} />}
        {view === 'settings' && settings && <SettingsView settings={settings} onChange={setSettings} aiStatus={aiStatus} onAi={(s) => setAiStatus(s)} onConnect={() => { void loadAiStatus(); setView('ai-setup') }} onWords={() => setView('words')} />}
        {view === 'words' && <WordsForm onDone={(m) => { flash(m); setView('settings') }} />}
        {view === 'ai-setup' && <AiSetup status={aiStatus} reload={loadAiStatus} onPick={(s) => setAiStatus(s)} />}
      </div>

      <div className="lc-foot">
        {message ? (
          <span className="msg">{message}</span>
        ) : (
          <>
            <Icon name="logo" className="logo" />
            <span className="grow" />
            {view === 'search' && selectedItem && <Hint k="↵" label={selectedItem.kind === 'snippet' ? 'Paste' : selectedItem.kind === 'ai' ? 'Ask' : 'Open'} />}
            {view === 'search' && calcShown && sel === 0 && <Hint k="↵" label="Copy answer" />}
            {view === 'search' && (selectedItem?.kind === 'app' || selectedItem?.kind === 'file') && <Hint k={`${MOD}↵`} label={isMac() ? 'Show in Finder' : 'Show in folder'} />}
            {view === 'search' && (selectedItem?.kind === 'snippet' || selectedItem?.id.startsWith('link:')) && (
              <>
                {selectedItem.kind === 'snippet' && <Hint k={`${MOD}↵`} label="Copy" />}
                <Hint k={`${MOD}E`} label="Edit" />
                <Hint k={`${MOD}⌫`} label="Delete" />
              </>
            )}
            {view === 'search' && query.trim() && <Hint k="Tab" label="Ask AI" />}
            {view === 'kill' && <><Hint k="↵" label="Quit" /><Hint k={`${MOD}↵`} label="Force quit" /></>}
            {view === 'ai' && ai?.done && ai.text && <><Hint k="↵" label="Copy" /><Hint k={`${MOD}↵`} label="Paste" /></>}
            {view !== 'search' && <Hint k="Esc" label="Back" />}
          </>
        )}
      </div>
    </div>
  )
}

// ─── AI answer ───────────────────────────────────────────────────────────────

function AiAnswer({ ai, status, onProvider, onConnect }: { ai: AiRun; status: AiStatus | null; onProvider: (p: AiProviderId) => void; onConnect: () => void }): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (ai.done) return
    const t0 = Date.now()
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(t)
  }, [ai.reqId, ai.done])
  const usable = (status?.providers ?? []).filter((p) => p.installed && p.signedIn !== false)
  return (
    <div className="lc-ai">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {/* The question is already in the top bar; show the selected text the action works on */}
        <span className="lc-ai-q">{ai.redo.text ? `“${ai.redo.text.replace(/\s+/g, ' ').slice(0, 90)}${ai.redo.text.length > 90 ? '…' : ''}”` : ''}</span>
        {usable.length > 1 && (
          <span className="seg" style={{ flex: 'none' }}>
            {usable.map((p) => (
              <button key={p.id} aria-pressed={status?.selected === p.id} onClick={() => onProvider(p.id)} tabIndex={-1}>
                {PROVIDER_NAMES[p.id]}
              </button>
            ))}
          </span>
        )}
      </div>
      {ai.error ? (
        <div className="lc-ai-err">
          {ai.error}{' '}
          {/connect/i.test(ai.error) && <button className="btn" onClick={onConnect}>Connect</button>}
        </div>
      ) : ai.text ? (
        <div className="lc-ai-a">
          {ai.text}
          {!ai.done && <span className="lc-cursor" />}
        </div>
      ) : (
        <div className="lc-ai-a wait">
          {status?.selected ? PROVIDER_NAMES[status.selected] : 'AI'} is thinking… {elapsed > 1 ? `${elapsed}s` : ''}
        </div>
      )}
    </div>
  )
}

// ─── forms ───────────────────────────────────────────────────────────────────

function useSubmitOnModEnter(submit: () => void): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.key === 'Enter' && (isMac() ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      submit()
    }
  }
}

function SnippetForm({ editing, onDone }: { editing: LauncherItem | null; onDone: (m: string) => void }): React.JSX.Element {
  const [name, setName] = useState(editing?.kind === 'snippet' && editing.title !== editing.snippetKeyword ? editing.title : '')
  const [keyword, setKeyword] = useState(editing?.snippetKeyword ?? ';')
  const [text, setText] = useState(editing?.snippetText ?? '')
  const [err, setErr] = useState('')
  const submit = (): void => {
    if (keyword.trim().length < 2) return setErr('Give it a keyword of at least two characters, like ;addr')
    if (!text.trim()) return setErr('Type the text it should turn into')
    void invoke(IPC_INVOKE.LAUNCHER_SAVE_SNIPPET, { id: editing?.id.replace(/^snip:/, ''), name, keyword, text }).then((s) =>
      s ? onDone(`Saved. Type ${keyword.trim()} in any app`) : setErr('Couldn’t save that snippet')
    )
  }
  const onKey = useSubmitOnModEnter(submit)
  return (
    <div className="lc-form" onKeyDown={onKey}>
      <label>
        Text
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="The text you type a lot: an address, a sign-off, a reply…" />
        <span className="hint">You can use {'{date}'}, {'{time}'} and {'{clipboard}'}.</span>
      </label>
      <label>
        Keyword
        <input value={keyword} onChange={(e) => setKeyword(e.target.value.replace(/\s/g, ''))} placeholder=";addr" />
        <span className="hint">Type this in any app and it turns into the text. Starting with ; stops it firing by accident.</span>
      </label>
      <label>
        Name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home address" />
      </label>
      {err && <span className="err">{err}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={submit}>Save snippet <kbd>{MOD}↵</kbd></button>
      </div>
    </div>
  )
}

/** "My words": names and terms to spell the person's way, one per line; "X -> Y" always replaces. */
function WordsForm({ onDone }: { onDone: (m: string) => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void invoke<string>(IPC_INVOKE.DICTATION_WORDS).then((t) => setText(t ?? ''))
  }, [])
  const lines = (text ?? '').split(/[\n,]/).map((l) => l.trim()).filter(Boolean)
  const hints = lines.filter((l) => !/(->|→)/.test(l)).length
  const reps = lines.length - hints
  const submit = (): void => {
    void invoke(IPC_INVOKE.DICTATION_SET_WORDS, text ?? '').then(() => onDone(hints ? `Saved ${hints} words` : 'Saved'))
  }
  const onKey = useSubmitOnModEnter(submit)
  if (text === null) return <div className="lc-form" />
  return (
    <div className="lc-form" onKeyDown={onKey}>
      <label>
        One per line
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Siobhan\nPeakFlow\nManukora'} style={{ minHeight: 150 }} />
        <span className="hint">
          Names, products and jargon that come out wrong. Dictation uses them as hints, so ordinary words still come through as spoken.
          To always swap a word, write it as <b>teh -&gt; the</b>.
        </span>
      </label>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={hints > 50 ? 'err' : 'hint'}>
          {hints > 50 ? `${hints} words: lists over 50 make mistakes more likely. Keep the ones that actually come out wrong.` : `${hints} word${hints === 1 ? '' : 's'}${reps ? `, ${reps} always replaced` : ''}`}
        </span>
        <button className="btn primary" onClick={submit}>Save <kbd>{MOD}↵</kbd></button>
      </div>
    </div>
  )
}

function LinkForm({ editing, onDone }: { editing: LauncherItem | null; onDone: (m: string) => void }): React.JSX.Element {
  const [name, setName] = useState(editing?.title ?? '')
  const [target, setTarget] = useState(editing?.target ?? '')
  const [err, setErr] = useState('')
  const submit = (): void => {
    if (!target.trim()) return setErr('Type a website address or a folder')
    void invoke(IPC_INVOKE.LAUNCHER_SAVE_LINK, { id: editing?.id.replace(/^link:/, ''), name: name || target, target }).then((l) =>
      l ? onDone(`Saved. Search “${name || target}” to open it`) : setErr('That isn’t a website address or a folder on this computer')
    )
  }
  const onKey = useSubmitOnModEnter(submit)
  return (
    <div className="lc-form" onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); submit() } else onKey(e) }}>
      <label>
        Website or folder
        <input autoFocus value={target} onChange={(e) => setTarget(e.target.value)} placeholder={isMac() ? 'example.com or ~/Documents/Invoices' : 'example.com or C:\\Users\\you\\Documents'} />
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Invoices" />
      </label>
      {err && <span className="err">{err}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={submit}>Save link <kbd>↵</kbd></button>
      </div>
    </div>
  )
}

// ─── settings ────────────────────────────────────────────────────────────────

/**
 * The line under snippet and dictation rows when Accessibility is missing:
 * the shared "macOS forgot PeakFlow" wording after an update (review S1).
 */
function useAccessibilityNote(): { note: string; lost: boolean } {
  const [ax, setAx] = useState<PermissionStatus | null>(null)
  useEffect(() => {
    if (isMac()) void invoke<PermissionStatus | null>(IPC_INVOKE.APP_PERMISSION_STATUS, 'accessibility').then(setAx).catch(() => {})
  }, [])
  return ax?.lost
    ? { note: 'macOS forgot PeakFlow after the update. Show me how walks you through the fix.', lost: true }
    : { note: 'Needs the Accessibility permission (the same one QuickBoard uses)', lost: false }
}

/**
 * Allow (opens System Settings), or after an update made macOS forget
 * PeakFlow, Show me how: the panel's step-by-step guide with pictures.
 */
function AllowButton({ lost }: { lost: boolean }): React.JSX.Element {
  return lost ? (
    <button className="btn" onClick={() => void invoke(IPC_INVOKE.PANEL_SHOW, 'app/setup')}>Show me how</button>
  ) : (
    <button className="btn" onClick={() => void invoke(IPC_INVOKE.APP_OPEN_ACCESSIBILITY)}>Allow</button>
  )
}

function acceleratorFrom(e: React.KeyboardEvent): string | null {
  const key = e.key
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  const mods: string[] = []
  if (e.metaKey) mods.push(isMac() ? 'Command' : 'Super')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (!mods.length) return null
  const code = e.code
  let k = key.length === 1 ? key.toUpperCase() : key
  if (code === 'Space') k = 'Space'
  else if (/^Key[A-Z]$/.test(code)) k = code.slice(3)
  else if (/^Digit\d$/.test(code)) k = code.slice(5)
  return [...mods, k].join('+')
}

function SettingsView({ settings, onChange, aiStatus, onAi, onConnect, onWords }: { settings: LauncherSettings; onChange: (s: LauncherSettings) => void; aiStatus: AiStatus | null; onAi: (s: AiStatus) => void; onConnect: () => void; onWords: () => void }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const axNote = useAccessibilityNote()
  const set = (key: string, value: unknown): void => void invoke<LauncherSettings>(IPC_INVOKE.LAUNCHER_SET_SETTING, key, value).then(onChange)
  const usable = (aiStatus?.providers ?? []).filter((p) => p.installed && p.signedIn !== false)
  const selectedAi = usable.find((p) => p.id === aiStatus?.selected)
  return (
    <div>
      <div className="lc-set">
        <div>
          <div className="lbl">Open the launcher</div>
          <div className="sub">
            {!settings.hotkeyRegistered
              ? 'Another app is using this shortcut: pick a different one'
              : settings.hotkeyMovedFrom
                ? `Another app uses ${formatAccelerator(settings.hotkeyMovedFrom)}, so PeakFlow picked this one`
                : 'Press it from any app'}
          </div>
        </div>
        <button
          className="btn lc-rec"
          onClick={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') return setRecording(false)
            const accel = acceleratorFrom(e)
            if (accel) {
              setRecording(false)
              set('hotkey', accel)
            }
          }}
        >
          {recording ? 'Press keys…' : formatAccelerator(settings.hotkey)}
        </button>
      </div>
      <div className="lc-set">
        <div>
          <div className="lbl">Expand snippets as you type</div>
          <div className="sub">
            {!settings.expansionEnabled ? 'Off' : settings.expansionActive ? 'On in every app' : isMac() ? axNote.note : 'Starting…'}
          </div>
        </div>
        <span className="row">
          {settings.expansionEnabled && !settings.expansionActive && isMac() && <AllowButton lost={axNote.lost} />}
          <button className="switch" role="switch" aria-checked={settings.expansionEnabled} onClick={() => set('expansion', !settings.expansionEnabled)} />
        </span>
      </div>
      <div className="lc-set">
        <div>
          <div className="lbl">AI</div>
          <div className="sub">{usable.length ? 'Runs on your own plan, free. PeakFlow never sees your login.' : 'Not connected'}</div>
        </div>
        {usable.length ? (
          <span className="seg">
            {usable.map((p) => (
              <button key={p.id} aria-pressed={aiStatus?.selected === p.id} onClick={() => void invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_SET_PROVIDER, p.id).then(onAi)}>
                {PROVIDER_NAMES[p.id]}
              </button>
            ))}
          </span>
        ) : (
          <button className="btn" onClick={onConnect}>Connect</button>
        )}
      </div>
      {selectedAi && (
        <div className="lc-set">
          <div>
            <div className="lbl">{PROVIDER_NAMES[selectedAi.id]} model</div>
            <div className="sub">{selectedAi.tier === 'best' ? 'Uses your plan’s top model: slower, uses more of your limit' : 'A smaller model: quick, and uses less of your plan’s limit'}</div>
          </div>
          <span className="seg">
            {(['light', 'best'] as const).map((t) => (
              <button key={t} aria-pressed={selectedAi.tier === t} onClick={() => void invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_SET_TIER, selectedAi.id, t).then(onAi)}>
                {t === 'light' ? 'Light' : 'Best'}
              </button>
            ))}
          </span>
        </div>
      )}
      <DictationAccountRow />
      <DictationRows onWords={onWords} />
      <div className="lc-set">
        <div>
          <div className="lbl">Snippets and quick links</div>
          <div className="sub">Search “snippet” or “link” in the bar; {MOD}E edits, {MOD}⌫ deletes</div>
        </div>
      </div>
    </div>
  )
}

const HOLD_KEYS: Array<[DictationHoldKey, string]> = isMac()
  ? [['fn', 'fn'], ['ropt', 'Right ⌥'], ['rcmd', 'Right ⌘'], ['rctrl', 'Right ⌃']]
  : [['rctrl', 'Right Ctrl'], ['ralt', 'Right Alt']]

const KEY_ERRORS: Record<string, string> = {
  bad_key: 'OpenAI didn’t accept that key',
  network: 'Couldn’t reach OpenAI: check the internet connection',
  failed: 'Couldn’t save the key'
}

/** Dictation: hold a key, talk, let go. Needs the person's own OpenAI key. */
function DictationRows({ onWords }: { onWords: () => void }): React.JSX.Element | null {
  const [d, setD] = useState<DictationSettings | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const axNote = useAccessibilityNote()
  useEffect(() => {
    void invoke<DictationSettings>(IPC_INVOKE.DICTATION_SETTINGS).then(setD)
  }, [])
  if (!d) return null
  const set = (k: string, v: unknown): void => void invoke<DictationSettings>(IPC_INVOKE.DICTATION_SET, k, v).then(setD)
  const save = async (): Promise<void> => {
    setSaving(true)
    setErr('')
    const r = await invoke<{ ok: boolean; error?: string; settings: DictationSettings }>(IPC_INVOKE.DICTATION_SAVE_KEY, key)
    setSaving(false)
    setD(r.settings)
    if (r.ok) setKey('')
    else setErr(KEY_ERRORS[r.error ?? 'failed'] ?? KEY_ERRORS.failed)
  }
  const holdName = HOLD_KEYS.find(([k]) => k === d.holdKey)?.[1] ?? d.holdKey
  if (!d.hasKey) {
    return (
      <div className="lc-set">
        <div>
          <div className="lbl">Dictation</div>
          <div className="sub">{err || 'Hold a key and talk; your words are typed for you. Needs your own OpenAI key (about 1 cent for 2 minutes of talking).'}</div>
        </div>
        <span className="row">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key && void save()} placeholder="sk-…" className="lc-field" style={{ width: 150 }} aria-label="OpenAI API key" />
          <button className="btn" disabled={!key || saving} onClick={() => void save()}>{saving ? 'Checking…' : 'Save'}</button>
        </span>
      </div>
    )
  }
  return (
    <>
      <div className="lc-set">
        <div>
          <div className="lbl">Dictation</div>
          <div className="sub">
            {!d.enabled ? 'Off' : d.active ? `Hold ${holdName}, talk, let go. The app’s name and the text before your cursor help it spell things right; password fields are never read.` : isMac() ? axNote.note : 'Starting…'}
          </div>
        </div>
        <span className="row">
          {d.enabled && !d.active && isMac() && <AllowButton lost={axNote.lost} />}
          <button className="switch" role="switch" aria-checked={d.enabled} aria-label="Dictation" onClick={() => set('enabled', !d.enabled)} />
        </span>
      </div>
      {d.enabled && (
        <>
          <div className="lc-set">
            <div>
              <div className="lbl">Hold to talk</div>
              {d.hint && <div className="sub" role="note">{d.hint}</div>}
            </div>
            <span className="seg">
              {HOLD_KEYS.map(([k, name]) => (
                <button key={k} aria-pressed={d.holdKey === k} onClick={() => set('holdKey', k)}>{name}</button>
              ))}
            </span>
          </div>
          <div className="lc-set">
            <div>
              <div className="lbl">My words</div>
              <div className="sub">{d.wordCount ? `${d.wordCount} names and terms spelt your way` : 'Names and terms dictation should spell your way'}</div>
            </div>
            <button className="btn" onClick={onWords}>{d.wordCount ? 'Edit' : 'Add'}</button>
          </div>
          <div className="lc-set">
            <div>
              <div className="lbl">Clean up as you go</div>
              <div className="sub">Takes out “um”, adds punctuation, and keeps only the fix when you say “no wait”. Never changes names, numbers or “not”.</div>
            </div>
            <button className="switch" role="switch" aria-checked={d.cleanup} aria-label="Clean up as you go" onClick={() => set('cleanup', !d.cleanup)} />
          </div>
        </>
      )}
      {d.ownKey && (
        <div className="lc-set">
          <div>
            <div className="lbl">OpenAI key</div>
            <div className="sub">Saved encrypted on this computer</div>
          </div>
          <button className="btn" onClick={() => void invoke<DictationSettings>(IPC_INVOKE.DICTATION_REMOVE_KEY).then(setD)}>Remove</button>
        </div>
      )}
    </>
  )
}

function AiSetup({ status, reload, onPick }: { status: AiStatus | null; reload: () => Promise<void>; onPick: (s: AiStatus) => void }): React.JSX.Element {
  // While this screen is open, check every few seconds so it turns to "Connected" after sign-in
  useEffect(() => {
    const t = setInterval(() => void reload(), 3000)
    return () => clearInterval(t)
  }, [reload])
  const prov = (id: AiProviderId) => status?.providers.find((p) => p.id === id)
  const card = (id: 'codex' | 'claude', title: string, body: string): React.JSX.Element => {
    const p = prov(id)
    const connected = !!p?.installed && p.signedIn !== false
    return (
      <div className="lc-card">
        <div className="grow">
          <div className="t">{title}</div>
          <div className="s">{connected ? 'Connected. Answers use your own plan.' : p?.installed ? 'Installed, but signed out. Connect signs you back in.' : body}</div>
        </div>
        {connected ? (
          status?.selected === id ? (
            <span className="ok"><Icon name="check" />In use</span>
          ) : (
            <button className="btn" onClick={() => void invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_SET_PROVIDER, id).then(onPick)}>Use</button>
          )
        ) : (
          <button className="btn primary" onClick={() => void invoke(IPC_INVOKE.LAUNCHER_AI_CONNECT, id)}>Connect</button>
        )}
      </div>
    )
  }
  const local = prov('ollama')
  return (
    <div className="lc-prov">
      {card('codex', 'ChatGPT', 'Uses your ChatGPT plan. Connect opens a Terminal window that installs OpenAI’s free Codex app and asks you to sign in with ChatGPT.')}
      {card('claude', 'Claude', 'Uses your Claude plan. Connect opens a Terminal window that installs Anthropic’s Claude Code and asks you to sign in.')}
      <div className="lc-card">
        <div className="grow">
          <div className="t">Local model</div>
          <div className="s">{local?.installed ? `Running: ${local.model ?? 'Ollama'}. Private and works offline.` : 'Private and offline. Install Ollama from ollama.com and download a model, and it shows up here.'}</div>
        </div>
        {local?.installed && status?.selected !== 'ollama' && (
          <button className="btn" onClick={() => void invoke<AiStatus>(IPC_INVOKE.LAUNCHER_AI_SET_PROVIDER, 'ollama').then(onPick)}>Use</button>
        )}
      </div>
      <div className="lc-empty" style={{ padding: '6px 8px', textAlign: 'left' }}>
        Free: PeakFlow doesn’t charge for AI. It starts the ChatGPT or Claude app on this computer, which signs in with your own account. Your login stays with OpenAI or Anthropic.
      </div>
    </div>
  )
}
