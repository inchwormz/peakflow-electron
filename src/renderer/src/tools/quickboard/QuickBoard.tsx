/**
 * QuickBoard -- Clipboard Manager UI
 *
 * Features:
 *   - 340px wide popup, dark cinematic design
 *   - Search bar with fuzzy search + from:app syntax
 *   - Content type filter chips, tag filter bar
 *   - Sort tabs (Recent | Top Copied)
 *   - Virtualized clip list with pin/delete/edit
 *   - Multi-select for sequential paste queue
 *   - Settings with max items, plain text, encrypt toggles
 *   - Toast notification on copy
 *   - AI transforms, onboarding wizard, workflows, form fill, suggestions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import {
  DS,
  NavButton,
  SortButton,
  rootStyle,
  navBarStyle,
  toastStyle,
  type ClipboardItem,
  type SortMode,
  type ViewMode
} from './components/shared'
import { ClipRow } from './components/ClipRow'
import { ClipList } from './components/ClipList'
import { SearchBar } from './components/SearchBar'
import { SettingsPanel } from './components/SettingsPanel'
import { TypeFilter, type ContentTypeFilter } from './components/TypeFilter'
import { TagBar } from './components/TagBar'
import { QueueBanner } from './components/QueueBanner'
import { EditModal } from './components/EditModal'
import { TransformPicker } from './components/TransformPicker'
import { OnboardingWizard } from './components/OnboardingWizard'
import { WorkflowPanel } from './components/WorkflowPanel'
import { FormFillPanel } from './components/FormFillPanel'
import { SuggestionBanner } from './components/SuggestionBanner'
import { scoreItem } from './fuzzy-search'

// ─── Suggestion type ─────────────────────────────────────────────────────────

interface AiSuggestion {
  id: string
  type: 'pin_template' | 'create_tag' | 'create_workflow' | 'add_trigger'
  reason: string
  action: Record<string, unknown>
  label: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export function QuickBoard(): React.JSX.Element {
  const [history, setHistory] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [view, setView] = useState<ViewMode>('main')
  const [toastVisible, setToastVisible] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [typeFilter, setTypeFilter] = useState<ContentTypeFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings state
  const [settingsMaxItems, setSettingsMaxItems] = useState(100)
  const [settingsPlainText, setSettingsPlainText] = useState(false)
  const [settingsEncrypt, setSettingsEncrypt] = useState(false)

  // Tags state
  const [allTags, setAllTags] = useState<string[]>([])
  const [activeTags, setActiveTags] = useState<string[]>([])

  // Sequential paste state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [queueStatus, setQueueStatus] = useState<{ active: boolean; current: number; total: number }>({
    active: false, current: 0, total: 0
  })

  // Edit modal state
  const [editingItem, setEditingItem] = useState<ClipboardItem | null>(null)

  // Transform picker state
  const [transformItem, setTransformItem] = useState<ClipboardItem | null>(null)

  // AI suggestions state
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // ── Load history + tags on mount ──────────────────────────────────────────

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_HISTORY).then((data) => {
      if (Array.isArray(data)) setHistory(data as ClipboardItem[])
    }).catch((err) => {
      console.error('[QuickBoard] Failed to load history:', err)
      setHistory([])
    })

    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_ALL_TAGS).then((data) => {
      if (Array.isArray(data)) setAllTags(data as string[])
    }).catch(() => {})
  }, [])

  // ── Check onboarding + suggestions on mount ────────────────────────────────

  useEffect(() => {
    // Check if onboarding should show
    window.peakflow.invoke(IPC_INVOKE.CONFIG_GET, { tool: 'quickboard' })
      .then((conf: unknown) => {
        if (conf && typeof conf === 'object') {
          const c = conf as Record<string, unknown>
          if (c.ai_onboarding_complete !== true) {
            // Check if user has AI access (licensed, not trial)
            window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_CHECK_ACCESS)
              .then((res: unknown) => {
                const r = res as { allowed: boolean }
                if (r.allowed) setView('onboarding')
              })
              .catch(() => {})
          }
        }
      })
      .catch(() => {})

    // Load pending suggestions
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_SUGGEST)
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          setSuggestions(data as AiSuggestion[])
          setShowSuggestions(true)
        }
      })
      .catch(() => {})
  }, [])

  // ── Listen for clipboard changes from main process ─────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.CLIPBOARD_ON_CHANGE,
      (data: unknown) => {
        if (Array.isArray(data)) setHistory(data as ClipboardItem[])
      }
    )
    return unsub
  }, [])

  // ── Load settings from config on mount ─────────────────────────────────

  useEffect(() => {
    window.peakflow
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: 'quickboard' })
      .then((conf: unknown) => {
        if (conf && typeof conf === 'object') {
          const c = conf as Record<string, unknown>
          if (typeof c.max_entries === 'number') setSettingsMaxItems(c.max_entries)
          if (typeof c.encrypt_history === 'boolean') setSettingsEncrypt(c.encrypt_history)
          if (typeof c.plain_text_mode === 'boolean') setSettingsPlainText(c.plain_text_mode)
        }
      })
      .catch((err) => {
        console.error('[QuickBoard] Failed to load settings:', err)
      })
  }, [])

  // ── Focus search on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (view === 'main') {
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [view])

  // ── Filtering & sorting ────────────────────────────────────────────────

  const filteredHistory = useMemo(() => {
    let items = history

    // Filter by content type
    if (typeFilter !== 'all') {
      items = items.filter((item) => item.contentType === typeFilter)
    }

    // Filter by active tags
    if (activeTags.length > 0) {
      items = items.filter((item) =>
        activeTags.some((tag) => item.tags.includes(tag))
      )
    }

    // Fuzzy search
    if (searchQuery) {
      const scored = items
        .map((item) => ({ item, score: scoreItem(searchQuery, item) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
      items = scored.map(({ item }) => item)
    }

    // Separate pinned and unpinned
    const pinned = items.filter((h) => h.pinned)
    const unpinned = items.filter((h) => !h.pinned)

    if (sortMode === 'frequency') {
      pinned.sort((a, b) => b.copyCount - a.copyCount || b.timestamp.localeCompare(a.timestamp))
      unpinned.sort((a, b) => b.copyCount - a.copyCount || b.timestamp.localeCompare(a.timestamp))
    } else if (!searchQuery) {
      pinned.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      unpinned.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    }

    return [...pinned, ...unpinned].slice(0, 200)
  }, [history, searchQuery, sortMode, typeFilter, activeTags])

  const handleDeleteItem = useCallback(
    (e: React.MouseEvent, itemId: string) => {
      e.stopPropagation()
      window.peakflow
        .invoke(IPC_INVOKE.CLIPBOARD_DELETE_ITEM, itemId)
        .then((data) => {
          if (Array.isArray(data)) setHistory(data as ClipboardItem[])
        })
    },
    []
  )

  const handlePinItem = useCallback(
    (e: React.MouseEvent, itemId: string) => {
      e.stopPropagation()
      window.peakflow
        .invoke(IPC_INVOKE.CLIPBOARD_PIN_ITEM, itemId)
        .then((data) => {
          if (Array.isArray(data)) setHistory(data as ClipboardItem[])
        })
    },
    []
  )

  const handleClearHistory = useCallback(() => {
    window.peakflow
      .invoke(IPC_INVOKE.CLIPBOARD_CLEAR_HISTORY)
      .then((data) => {
        if (Array.isArray(data)) setHistory(data as ClipboardItem[])
      })
    setView('main')
  }, [])

  const showToast = useCallback(() => {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 1200)
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleSelectItem = useCallback((item: ClipboardItem) => {
    if (multiSelectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      return
    }
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE, item.id, settingsPlainText)
    showToast()
    setTimeout(() => {
      window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
    }, 400)
  }, [settingsPlainText, showToast, multiSelectMode])

  // ── Edit handler ──────────────────────────────────────────────────────────

  const handleEditSave = useCallback((itemId: string, editedText: string) => {
    window.peakflow
      .invoke(IPC_INVOKE.CLIPBOARD_EDIT_ITEM, itemId, editedText)
      .then((data) => {
        if (Array.isArray(data)) setHistory(data as ClipboardItem[])
      })
    setEditingItem(null)
  }, [])

  // ── Sequential paste ──────────────────────────────────────────────────────

  const handleStartQueue = useCallback(() => {
    if (selectedIds.size < 2) return
    const ids = filteredHistory
      .filter((item) => selectedIds.has(item.id))
      .map((item) => item.id)
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_QUEUE_START, ids)
    setQueueStatus({ active: true, current: 1, total: ids.length })
    setMultiSelectMode(false)
    setSelectedIds(new Set())
    // Close QuickBoard so focus returns to target app for Ctrl+Shift+N pasting
    setTimeout(() => {
      window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
    }, 300)
  }, [selectedIds, filteredHistory])

  const handleCancelQueue = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_QUEUE_CANCEL)
    setQueueStatus({ active: false, current: 0, total: 0 })
  }, [])

  // ── Tag toggle ────────────────────────────────────────────────────────────

  const handleToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
    setSelectedIndex(0)
  }, [])

  // ── Suggestion handlers ─────────────────────────────────────────────────

  const handleApplySuggestion = useCallback((sug: AiSuggestion) => {
    // Apply the suggestion action
    if (sug.type === 'pin_template' && sug.action.text) {
      window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_WRITE_TEXT, sug.action.text as string)
        .then(() => {
          return window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_HISTORY)
        })
        .then((data) => {
          if (Array.isArray(data)) {
            setHistory(data as ClipboardItem[])
            // Pin the newly added item
            if (data.length > 0) {
              window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_PIN_ITEM, (data[0] as ClipboardItem).id)
            }
          }
        })
    }
    // Dismiss after applying
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_DISMISS_SUGGESTION, sug.id)
    setSuggestions((prev) => prev.filter((s) => s.id !== sug.id))
  }, [])

  const handleDismissSuggestion = useCallback((sugId: string) => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_DISMISS_SUGGESTION, sugId)
    setSuggestions((prev) => prev.filter((s) => s.id !== sugId))
  }, [])

  // ── Keyboard navigation ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (editingItem) return
      if (view !== 'main') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filteredHistory.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredHistory[selectedIndex]) {
          handleSelectItem(filteredHistory[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        if (multiSelectMode) {
          setMultiSelectMode(false)
          setSelectedIds(new Set())
        } else {
          window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, selectedIndex, filteredHistory, handleSelectItem, editingItem, multiSelectMode])

  // ── View switching (save settings on return) ───────────────────────────

  const switchToSettings = useCallback(() => {
    setView('settings')
  }, [])

  const switchToMain = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
      tool: 'quickboard',
      key: 'max_entries',
      value: Math.max(10, Math.min(2000, settingsMaxItems))
    })
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
      tool: 'quickboard',
      key: 'encrypt_history',
      value: settingsEncrypt
    })
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
      tool: 'quickboard',
      key: 'plain_text_mode',
      value: settingsPlainText
    })
    setView('main')
  }, [settingsMaxItems, settingsEncrypt, settingsPlainText])

  const handleClose = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
  }, [])

  const handleMinimize = useCallback(() => {
    window.peakflow.invoke(IPC_INVOKE.WINDOW_MINIMIZE)
  }, [])

  // ── Queue number helper ──────────────────────────────────────────────────

  const getQueueNumber = (itemId: string): number | undefined => {
    if (!multiSelectMode || !selectedIds.has(itemId)) return undefined
    // Compute position: order by how they appear in filtered list
    const orderedSelected = filteredHistory
      .filter((h) => selectedIds.has(h.id))
      .map((h) => h.id)
    const idx = orderedSelected.indexOf(itemId)
    return idx >= 0 ? idx + 1 : undefined
  }

  // ── Format time ─────────────────────────────────────────────────────────

  const formatTime = (isoStr: string): string => {
    try {
      const d = new Date(isoStr)
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={rootStyle}>
      {/* Toast */}
      <div
        style={{
          ...toastStyle,
          opacity: toastVisible ? 1 : 0,
          pointerEvents: 'none'
        }}
      >
        Copied!
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={handleEditSave}
          onCancel={() => setEditingItem(null)}
        />
      )}

      {/* Transform Picker */}
      {transformItem && (
        <TransformPicker
          item={transformItem}
          onClose={() => setTransformItem(null)}
        />
      )}

      {view === 'onboarding' ? (
        /* ═══════════════ ONBOARDING VIEW ═══════════════ */
        <OnboardingWizard
          onComplete={() => setView('main')}
          onSkip={() => {
            window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
              tool: 'quickboard',
              key: 'ai_onboarding_complete',
              value: true
            })
            setView('main')
          }}
        />
      ) : view === 'workflows' ? (
        /* ═══════════════ WORKFLOWS VIEW ═══════════════ */
        <WorkflowPanel onBack={() => setView('main')} />
      ) : view === 'formfill' ? (
        /* ═══════════════ FORM FILL VIEW ═══════════════ */
        <FormFillPanel onBack={() => setView('main')} />
      ) : view === 'main' ? (
        /* ═══════════════ MAIN VIEW ═══════════════ */
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* Queue banner */}
          {queueStatus.active && (
            <QueueBanner
              current={queueStatus.current}
              total={queueStatus.total}
              onCancel={handleCancelQueue}
            />
          )}

          {/* Nav bar */}
          <div style={navBarStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 400, color: DS.textPrimary, fontFamily: "'Silkscreen', cursive" }}>
                QuickBoard
              </span>
              <span style={{ fontSize: 10, color: DS.textDim }}>
                {filteredHistory.length} items
              </span>
              {suggestions.length > 0 && !showSuggestions && (
                <button
                  onClick={() => setShowSuggestions(true)}
                  style={{
                    background: DS.accent,
                    color: DS.bg,
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 8,
                    fontWeight: 700,
                    padding: '1px 5px',
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  {suggestions.length}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
              {/* Multi-select toggle */}
              <NavButton
                icon={multiSelectMode ? '&#10003;' : '&#9776;'}
                onClick={() => {
                  setMultiSelectMode(!multiSelectMode)
                  if (multiSelectMode) setSelectedIds(new Set())
                }}
              />
              <NavButton icon="&#9881;" onClick={switchToSettings} />
              <NavButton icon="&#8212;" onClick={handleMinimize} />
              <NavButton icon="&#10005;" onClick={handleClose} isClose />
            </div>
          </div>

          {/* Suggestion banner */}
          {showSuggestions && suggestions.length > 0 && (
            <SuggestionBanner
              suggestions={suggestions}
              onApply={handleApplySuggestion}
              onDismiss={handleDismissSuggestion}
              onClose={() => setShowSuggestions(false)}
            />
          )}

          {/* Search box */}
          <SearchBar
            ref={searchRef}
            searchQuery={searchQuery}
            onSearchChange={(val) => {
              setSearchQuery(val)
              setSelectedIndex(0)
            }}
          />

          {/* Content type filter */}
          <TypeFilter active={typeFilter} onChange={(f) => { setTypeFilter(f); setSelectedIndex(0) }} />

          {/* Tag filter bar */}
          <TagBar tags={allTags} activeTags={activeTags} onToggleTag={handleToggleTag} />

          {/* Sort toggle + multi-select actions + quick nav */}
          <div style={{ padding: '10px 24px', display: 'flex', gap: 2 }}>
            {multiSelectMode ? (
              <>
                <span style={{ fontSize: 10, color: DS.textDim, flex: 1, alignSelf: 'center' }}>
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={handleStartQueue}
                  disabled={selectedIds.size < 2}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: selectedIds.size >= 2 ? DS.accent : DS.surface,
                    color: selectedIds.size >= 2 ? DS.bg : DS.textDim,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: selectedIds.size >= 2 ? 'pointer' : 'default',
                    fontFamily: 'inherit'
                  }}
                >
                  Start Pasting
                </button>
              </>
            ) : (
              <>
                <SortButton
                  label="RECENT"
                  active={sortMode === 'recent'}
                  onClick={() => { setSortMode('recent'); setSelectedIndex(0) }}
                />
                <SortButton
                  label="TOP COPIED"
                  active={sortMode === 'frequency'}
                  onClick={() => { setSortMode('frequency'); setSelectedIndex(0) }}
                />
                <SortButton
                  label="WORKFLOWS"
                  active={false}
                  onClick={() => setView('workflows')}
                />
                <SortButton
                  label="FORMS"
                  active={false}
                  onClick={() => setView('formfill')}
                />
              </>
            )}
          </div>

          {/* Clip list (virtualized) */}
          <ClipList
            items={filteredHistory}
            selectedIndex={selectedIndex}
            renderRow={(item, idx) => (
              <ClipRow
                item={item}
                time={formatTime(item.timestamp)}
                showBadge={sortMode === 'frequency'}
                isSelected={idx === selectedIndex}
                queueNumber={getQueueNumber(item.id)}
                onSelect={() => handleSelectItem(item)}
                onPin={(e) => handlePinItem(e, item.id)}
                onDelete={(e) => handleDeleteItem(e, item.id)}
                onDoubleClick={item.type === 'text' ? () => setEditingItem(item) : undefined}
                onContextMenu={item.type === 'text' ? (e) => { e.preventDefault(); setTransformItem(item) } : undefined}
              />
            )}
          />
        </div>
      ) : (
        /* ═══════════════ SETTINGS VIEW ═══════════════ */
        <SettingsPanel
          maxItems={settingsMaxItems}
          plainText={settingsPlainText}
          encrypt={settingsEncrypt}
          historyCount={history.length}
          tagCount={allTags.length}
          onMaxItemsChange={setSettingsMaxItems}
          onPlainTextChange={() => setSettingsPlainText(!settingsPlainText)}
          onEncryptChange={() => setSettingsEncrypt(!settingsEncrypt)}
          onClearHistory={handleClearHistory}
          onBack={switchToMain}
          onRerunOnboarding={() => setView('onboarding')}
        />
      )}
    </div>
  )
}
