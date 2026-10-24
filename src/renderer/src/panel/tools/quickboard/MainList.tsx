/**
 * QuickBoard main screen: search (with from:<app>), filter card, select
 * several, Recent / Most copied, clip rows, AI suggestions, the paste-queue
 * banner and the expiry note.
 */

import { useEffect, useRef } from 'react'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { QuickBoardConfig } from '@shared/config-schemas'
import { ToolId } from '@shared/tool-ids'
import { invoke, useToolConfig, usePanelVisible, formatAccelerator, isMac } from '../../hooks'
import { isPrimaryMod, modLabel } from '@shared/mod-key'
import { AppIcon, Banner, Btn, Empty, IconBtn, LinkBtn, Note } from '../../kit'
import { Icon, type IconName } from '../../icons'
import { useNav, type NavApi } from '../../nav'
import { PermissionNotice } from '../../permission'
import {
  canEdit, clipLines, deleteClip, getQB, reloadHistory, reloadPasteStatus, reloadTags, setQB, timeAgo, togglePin, useQB, visibleClips,
  OPEN_KEY, QUEUE_NEXT_KEY, type Clip, type Suggestion, type TypeFilter
} from './store'

const TYPES: Array<[TypeFilter, string]> = [
  ['all', 'All'],
  ['text', 'Text'],
  ['code', 'Code'],
  ['url', 'Links'],
  ['image', 'Images'],
  ['file', 'Files']
]
const TYPE_ICON: Record<Clip['contentType'], IconName> = { text: 'text', code: 'code', url: 'link', image: 'image', file: 'file' }

/** Copy the clip and paste it into the app the user was in. The panel hides first so the paste lands there. */
export function pasteClip(nav: NavApi, clip: Clip, plain: boolean): void {
  if (clip.type === 'file' && !isMac()) {
    nav.toast('Files can’t be pasted from QuickBoard yet')
    return
  }
  nav.hide()
  // The service waits 500 ms before ⌘V; the macOS helper refocuses the previous app if needed
  invoke(IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE, clip.id, plain).catch(() => {})
}

export function expiryText(cfg: QuickBoardConfig | null): string {
  if (!cfg) return ''
  if (!cfg.auto_expire || cfg.max_age_hours <= 0) return 'never'
  const h = cfg.max_age_hours
  if (h > 24 && h % 24 === 0) return `${h / 24} days`
  return `${h} ${h === 1 ? 'hour' : 'hours'}`
}

export function MainList(): React.JSX.Element {
  const nav = useNav()
  const s = useQB()
  const [cfg] = useToolConfig<QuickBoardConfig>(ToolId.QuickBoard)
  const visible = usePanelVisible()
  const search = useRef<HTMLInputElement>(null)
  const clips = visibleClips(s)
  const plain = !!cfg?.plain_text_mode

  // Fresh data and focus each time the panel opens
  useEffect(() => {
    if (!visible) return
    reloadHistory()
    reloadTags()
    reloadPasteStatus()
    setQB({ sel: 0 })
    setTimeout(() => search.current?.focus(), 50)
  }, [visible])

  // Poll the paste status while a sequence runs and the panel is open (main sends no push for it)
  useEffect(() => {
    if (!visible || !s.paste.active) return
    const t = setInterval(reloadPasteStatus, 1000)
    return () => clearInterval(t)
  }, [visible, s.paste.active])

  // Keyboard: ↑/↓ move, Enter pastes, ⌘1–9 (Ctrl+1–9 on Windows) quick paste. Esc leaves select mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = getQB()
      const list = visibleClips(st)
      const t = e.target as HTMLElement
      const inOtherField = t.closest?.('input, textarea, select') && t !== search.current
      if (inOtherField) return
      if (e.key === 'Escape' && st.selectMode && t !== search.current) {
        e.stopImmediatePropagation()
        setQB({ selectMode: false, picks: [] })
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setQB({ sel: Math.max(0, Math.min(list.length - 1, st.sel + d)) })
        return
      }
      if (e.key === 'Enter' && !st.selectMode && (t === search.current || t === document.body)) {
        const c = list[st.sel]
        if (c) {
          e.preventDefault()
          pasteClip(nav, c, plain)
        }
        return
      }
      if (isPrimaryMod(e, isMac()) && /^Digit[1-9]$/.test(e.code)) {
        const c = list[Number(e.code.slice(5)) - 1]
        if (c) {
          e.preventDefault()
          pasteClip(nav, c, plain)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [nav, plain])

  // Keep the selected row in view
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.clip.sel')?.scrollIntoView({ block: 'nearest' })
  }, [s.sel])

  const filtered = s.type !== 'all' || s.tagFilter.length > 0
  const total = s.history?.length ?? 0

  const onClip = (c: Clip, i: number): void => {
    if (s.selectMode) {
      setQB((st) => ({ picks: st.picks.includes(c.id) ? st.picks.filter((x) => x !== c.id) : [...st.picks, c.id] }))
      return
    }
    setQB({ sel: i })
    pasteClip(nav, c, plain)
  }

  const startQueue = (): void => {
    const ids = s.picks
    if (ids.length < 2) return
    invoke(IPC_INVOKE.CLIPBOARD_QUEUE_START, ids)
      .then(() => {
        setQB({ selectMode: false, picks: [], paste: { kind: 'queue', active: true, current: 1, total: ids.length, label: '' } })
        nav.hide()
      })
      .catch(() => nav.toast('Couldn’t start pasting'))
  }

  const cancelPaste = (): void => {
    const ch = s.paste.kind === 'workflow' ? IPC_INVOKE.CLIPBOARD_CANCEL_WORKFLOW : s.paste.kind === 'form' ? IPC_INVOKE.CLIPBOARD_CANCEL_FORM_FILL : IPC_INVOKE.CLIPBOARD_QUEUE_CANCEL
    invoke(ch).finally(reloadPasteStatus)
    setQB({ paste: { ...s.paste, active: false } })
  }

  return (
    <>
      <PermissionNotice kind="accessibility" why="QuickBoard uses it to paste into the app you were in." onlyIfLost />
      {s.paste.active ? (
        <Banner style={{ marginBottom: 10 }} action={<LinkBtn onClick={cancelPaste}>Cancel</LinkBtn>}>
          <b>{s.paste.kind === 'form' ? 'Filling' : 'Pasting'} {s.paste.current} of {s.paste.total}</b>
          {s.paste.label ? ` · ${s.paste.label}` : ''} · press {formatAccelerator(QUEUE_NEXT_KEY)} for the next one
        </Banner>
      ) : null}

      {!s.selectMode && !s.suggestionsHidden && s.suggestions.length ? <Suggestions list={s.suggestions} /> : null}

      <div className="qb-top">
        <div className="field-wrap">
          <Icon name="search" />
          <input
            ref={search}
            className="field"
            placeholder="Search, or from:slack"
            aria-label="Search clips"
            value={s.q}
            onChange={(e) => setQB({ q: e.target.value, sel: 0 })}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              if (s.q) setQB({ q: '', sel: 0 })
              else if (s.selectMode) setQB({ selectMode: false, picks: [] })
              else nav.hide()
            }}
          />
        </div>
        <IconBtn icon="filter" label="Filter" onClick={() => setQB({ filterOpen: !s.filterOpen })} style={filtered || s.filterOpen ? { color: 'var(--text)' } : undefined} />
        <IconBtn icon="listcheck" label="Select several" active={s.selectMode} onClick={() => setQB({ selectMode: !s.selectMode, picks: [] })} />
      </div>

      {s.filterOpen ? (
        <div className="card" style={{ padding: '10px 12px', marginTop: 8 }}>
          <div className="note" style={{ marginBottom: 6 }}>Type</div>
          <div className="chips">
            {TYPES.map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={s.type === v} onClick={() => setQB({ type: v, sel: 0 })}>{l}</button>
            ))}
          </div>
          <div className="note" style={{ margin: '10px 0 6px' }}>Tags</div>
          {s.tags.length ? (
            <div className="chips">
              {s.tags.map((t) => (
                <button
                  key={t}
                  className="chip"
                  aria-pressed={s.tagFilter.includes(t)}
                  onClick={() => setQB((st) => ({ sel: 0, tagFilter: st.tagFilter.includes(t) ? st.tagFilter.filter((x) => x !== t) : [...st.tagFilter, t] }))}
                >
                  #{t}
                </button>
              ))}
            </div>
          ) : (
            <div className="note">No tags yet.</div>
          )}
        </div>
      ) : null}

      <div className="tabs-txt">
        <button aria-pressed={s.tab === 'recent'} onClick={() => setQB({ tab: 'recent', sel: 0 })}>Recent</button>
        <button aria-pressed={s.tab === 'top'} onClick={() => setQB({ tab: 'top', sel: 0 })}>Most copied</button>
        <span className="sp" />
        <button onClick={() => nav.go('quickboard/workflows')}>Workflows</button>
        <button onClick={() => nav.go('quickboard/forms')}>Forms</button>
      </div>

      {s.history === null ? (
        <div style={{ height: 160 }} />
      ) : total === 0 ? (
        <Empty icon="quickboard" title="No clips yet">
          Copy something and it shows up here.
          <br />
          Open QuickBoard any time with {formatAccelerator(OPEN_KEY)}.
        </Empty>
      ) : clips.length === 0 ? (
        <Empty icon="search" title="No clips match">
          {s.q ? `Nothing for “${s.q}”. Try from:slack to filter by app.` : 'Try another filter.'}
        </Empty>
      ) : (
        <div className="stack" style={{ margin: '0 -8px' }} ref={listRef}>
          {clips.map((c, i) => (
            <ClipRow
              key={c.id}
              clip={c}
              index={i}
              selected={!s.selectMode && i === s.sel}
              pick={s.selectMode ? s.picks.indexOf(c.id) + 1 : null}
              top={s.tab === 'top'}
              onClick={() => onClip(c, i)}
              onContext={c.type === 'text' && !s.selectMode ? () => nav.go(`quickboard/transform/${encodeURIComponent(c.id)}`) : undefined}
              onEdit={() => nav.go(`quickboard/edit/${encodeURIComponent(c.id)}`)}
            />
          ))}
        </div>
      )}

      {s.selectMode ? (
        <Banner style={{ marginTop: 10 }} action={<Btn primary sm disabled={s.picks.length < 2} onClick={startQueue}>Start pasting</Btn>}>
          <b>{s.picks.length} selected</b> · pasted in this order
        </Banner>
      ) : cfg && total > 0 ? (
        <Note style={{ marginTop: 10, textAlign: 'center' }}>
          {expiryText(cfg) === 'never' ? 'Unpinned clips are kept until you delete them. ' : `Unpinned clips clear after ${expiryText(cfg)}. `}
          <LinkBtn onClick={() => nav.go('quickboard/settings/general')}>Change</LinkBtn>
        </Note>
      ) : null}
    </>
  )
}

function ClipRow({ clip, index, selected, pick, top, onClick, onContext, onEdit }: {
  clip: Clip
  index: number
  selected: boolean
  pick: number | null
  top: boolean
  onClick: () => void
  onContext?: () => void
  onEdit: () => void
}): React.JSX.Element {
  const [main, sub] = clipLines(clip)
  return (
    <div
      className={selected ? 'clip sel' : 'clip'}
      role="button"
      tabIndex={-1}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onClick()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext?.()
      }}
    >
      {pick !== null ? (
        pick > 0 ? <span className="qn">{pick}</span> : <span className="qn off" />
      ) : clip.sourceApp ? (
        <AppIcon q={{ bundleId: clip.sourceApp, name: clip.sourceApp }} />
      ) : (
        <span style={{ width: 18, height: 18, color: 'var(--text-3)', flex: 'none', display: 'inline-flex' }}>
          <Icon name={TYPE_ICON[clip.contentType] ?? 'text'} style={{ width: 18, height: 18 }} />
        </span>
      )}
      {clip.type === 'image' && clip.imageDataUrl ? <img className="thumb-img" src={clip.imageDataUrl} alt="" draggable={false} /> : null}
      <span className="t">
        {main}
        {sub ? <small>{sub}</small> : null}
      </span>
      {clip.pinned ? <Icon name="starF" className="pin" /> : null}
      <span className="m">{top ? `×${clip.copyCount}` : timeAgo(clip.timestamp)}</span>
      {pick === null ? (
        <span className="acts">
          <IconBtn icon={clip.pinned ? 'starF' : 'star'} label={clip.pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(clip.id)} />
          {canEdit(clip) ? <IconBtn icon="pencil" label="Edit" onClick={onEdit} /> : null}
          <IconBtn icon="x" label="Delete" onClick={() => deleteClip(clip.id)} />
          {index < 9 ? <kbd>{modLabel(String(index + 1), isMac())}</kbd> : null}
        </span>
      ) : null}
    </div>
  )
}

function Suggestions({ list }: { list: Suggestion[] }): React.JSX.Element {
  const nav = useNav()
  const drop = (id: string): void => {
    invoke(IPC_INVOKE.CLIPBOARD_AI_DISMISS_SUGGESTION, id).catch(() => {})
    setQB((s) => ({ suggestions: s.suggestions.filter((x) => x.id !== id) }))
  }
  const apply = (sug: Suggestion): void => {
    const a = sug.action
    let p: Promise<unknown> = Promise.resolve()
    if (sug.type === 'pin_template' && typeof a.text === 'string') {
      p = invoke(IPC_INVOKE.CLIPBOARD_ADD_PINNED_ITEM, a.text).then(() => reloadHistory())
    } else if (sug.type === 'create_tag') {
      const name = (a.name ?? a.tag) as string | undefined
      if (name) p = invoke(IPC_INVOKE.CLIPBOARD_MANAGE_TAGS, 'create', { name }).then(() => reloadTags())
    } else if (sug.type === 'create_workflow' && typeof a.name === 'string' && Array.isArray(a.items)) {
      p = invoke(IPC_INVOKE.CLIPBOARD_SAVE_WORKFLOW, { name: a.name, description: (a.description as string) ?? '', items: a.items, isAiGenerated: true })
    }
    p.then(() => nav.toast('Done')).catch(() => nav.toast('Couldn’t apply that'))
    drop(sug.id)
  }
  const actionLabel = (t: Suggestion['type']): string => (t === 'pin_template' ? 'Pin it' : t === 'create_tag' ? 'Create tag' : 'Create')
  return (
    <div className="card" style={{ padding: '4px 12px 8px', marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', height: 30 }}>
        <span className="note">
          <b>{list.length} {list.length === 1 ? 'suggestion' : 'suggestions'}</b>
        </span>
        <IconBtn icon="x" label="Hide suggestions" onClick={() => setQB({ suggestionsHidden: true })} />
      </div>
      {list.map((sug) => (
        <div key={sug.id} className="r" style={{ minHeight: 34 }} title={sug.reason}>
          <span className="ic">
            <Icon name="sparkle" />
          </span>
          <div className="l" style={{ fontSize: 12, whiteSpace: 'normal' }}>{sug.label}</div>
          <span className="ri">
            <Btn sm onClick={() => apply(sug)}>{actionLabel(sug.type)}</Btn>
            <IconBtn icon="x" label="Dismiss" onClick={() => drop(sug.id)} />
          </span>
        </div>
      ))}
    </div>
  )
}
