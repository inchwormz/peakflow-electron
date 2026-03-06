/**
 * QuickBoard -- Clipboard Manager UI
 *
 * Matches QuickBoard_Redesign.html pixel-for-pixel:
 *   - 340px wide popup, dark cinematic design
 *   - Search bar at top, sort tabs (Recent | Top Copied)
 *   - Clip list with icon, preview, copy count badge, pin/delete
 *   - Settings view with max items, plain text, encrypt toggles
 *   - Toast notification on copy
 *
 * Communicates with main process via IPC:
 *   - clipboard:get-history   -> retrieve current history
 *   - clipboard:simulate-paste -> copy + paste an item
 *   - clipboard:delete-item   -> remove one item
 *   - clipboard:pin-item      -> toggle pin
 *   - clipboard:clear-history -> clear non-pinned
 *   - clipboard:on-change     -> push updates from main
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import {
  DS,
  NavButton,
  SortButton,
  rootStyle,
  navBarStyle,
  clipListStyle,
  emptyStateStyle,
  toastStyle,
  type ClipboardItem,
  type SortMode,
  type ViewMode
} from './components/shared'
import { ClipRow } from './components/ClipRow'
import { SearchBar } from './components/SearchBar'
import { SettingsPanel } from './components/SettingsPanel'

// ─── Component ──────────────────────────────────────────────────────────────

export function QuickBoard(): React.JSX.Element {
  const [history, setHistory] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [view, setView] = useState<ViewMode>('main')
  const [toastVisible, setToastVisible] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings state
  const [settingsMaxItems, setSettingsMaxItems] = useState(100)
  const [settingsPlainText, setSettingsPlainText] = useState(false)
  const [settingsEncrypt, setSettingsEncrypt] = useState(false)

  // ── Load history on mount ───────────────────────────────────────────────

  useEffect(() => {
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_GET_HISTORY).then((data) => {
      if (Array.isArray(data)) {
        setHistory(data as ClipboardItem[])
      }
    }).catch((err) => {
      console.error('[QuickBoard] Failed to load history:', err)
      setHistory([])
    })
  }, [])

  // ── Listen for clipboard changes from main process ─────────────────────

  useEffect(() => {
    const unsub = window.peakflow.on(
      IPC_SEND.CLIPBOARD_ON_CHANGE,
      (data: unknown) => {
        if (Array.isArray(data)) {
          setHistory(data as ClipboardItem[])
        }
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

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(
        (item) =>
          item.type === 'text' &&
          item.preview.toLowerCase().includes(q)
      )
    }

    // Separate pinned and unpinned
    const pinned = items.filter((h) => h.pinned)
    const unpinned = items.filter((h) => !h.pinned)

    if (sortMode === 'frequency') {
      pinned.sort((a, b) => b.copyCount - a.copyCount || b.timestamp.localeCompare(a.timestamp))
      unpinned.sort((a, b) => b.copyCount - a.copyCount || b.timestamp.localeCompare(a.timestamp))
    } else {
      pinned.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      unpinned.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    }

    return [...pinned, ...unpinned].slice(0, 50)
  }, [history, searchQuery, sortMode])

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
    window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE, item.id, settingsPlainText)
    showToast()
    // Close after brief delay so the user sees the toast
    setTimeout(() => {
      window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
    }, 400)
  }, [settingsPlainText, showToast])

  // ── Keyboard navigation ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
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
        window.peakflow.invoke(IPC_INVOKE.WINDOW_CLOSE)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [view, selectedIndex, filteredHistory, handleSelectItem])

  // ── View switching (save settings on return) ───────────────────────────

  const switchToSettings = useCallback(() => {
    setView('settings')
  }, [])

  const switchToMain = useCallback(() => {
    // Persist settings
    window.peakflow.invoke(IPC_INVOKE.CONFIG_SET, {
      tool: 'quickboard',
      key: 'max_entries',
      value: Math.max(10, Math.min(200, settingsMaxItems))
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

  // ── Icon helper ─────────────────────────────────────────────────────────

  const getItemIcon = (item: ClipboardItem): string => {
    if (item.type === 'image') return '\uD83D\uDCF7' // camera
    if (item.text && /^https?:\/\//.test(item.text)) return '\uD83D\uDD17' // link
    if (
      item.text &&
      ['function', 'def ', 'class ', 'import ', 'const ', 'let ', 'var ', '=>', '{'].some(
        (ind) => item.text!.includes(ind)
      )
    )
      return '\uD83D\uDCBB' // laptop (code)
    return '\uD83D\uDCDD' // memo (text)
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

      {view === 'main' ? (
        /* ═══════════════ MAIN VIEW ═══════════════ */
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* Nav bar */}
          <div style={navBarStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 400, color: DS.textPrimary, fontFamily: "'Silkscreen', cursive" }}>
                QuickBoard
              </span>
              <span style={{ fontSize: 10, color: DS.textDim }}>
                {filteredHistory.length} items
              </span>
            </div>
            {/* @ts-expect-error -- Electron-specific CSS */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' }}>
              <NavButton icon="&#9881;" onClick={switchToSettings} />
              <NavButton icon="&#8212;" onClick={handleMinimize} />
              <NavButton icon="&#10005;" onClick={handleClose} isClose />
            </div>
          </div>

          {/* Search box */}
          <SearchBar
            ref={searchRef}
            searchQuery={searchQuery}
            onSearchChange={(val) => {
              setSearchQuery(val)
              setSelectedIndex(0)
            }}
          />

          {/* Sort toggle */}
          <div style={{ padding: '10px 24px', display: 'flex', gap: 2 }}>
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
          </div>

          {/* Clip list */}
          <div ref={listRef} style={clipListStyle}>
            {filteredHistory.length === 0 ? (
              <div style={emptyStateStyle}>No clips found</div>
            ) : (
              filteredHistory.map((item, idx) => (
                <ClipRow
                  key={item.id}
                  item={item}
                  icon={getItemIcon(item)}
                  time={formatTime(item.timestamp)}
                  showBadge={sortMode === 'frequency'}
                  isSelected={idx === selectedIndex}
                  onSelect={() => handleSelectItem(item)}
                  onPin={(e) => handlePinItem(e, item.id)}
                  onDelete={(e) => handleDeleteItem(e, item.id)}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        /* ═══════════════ SETTINGS VIEW ═══════════════ */
        <SettingsPanel
          maxItems={settingsMaxItems}
          plainText={settingsPlainText}
          encrypt={settingsEncrypt}
          onMaxItemsChange={setSettingsMaxItems}
          onPlainTextChange={() => setSettingsPlainText(!settingsPlainText)}
          onEncryptChange={() => setSettingsEncrypt(!settingsEncrypt)}
          onClearHistory={handleClearHistory}
          onBack={switchToMain}
        />
      )}
    </div>
  )
}
