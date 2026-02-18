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

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'

// ─── Design Tokens (dark cinematic -- matches Python COLORS) ────────────────

const DS = {
  bg: '#0a0a0a',
  bgLight: '#111111',
  bgHover: '#141414',
  surface: '#1a1a1a',
  border: '#1a1a1a',
  textPrimary: '#f0f0f5',
  textSecondary: '#888888',
  textMuted: '#666666',
  textDim: '#555555',
  textLabel: '#444444',
  textGhost: '#333333',
  green: '#4ae08a',
  yellow: '#eab308',
  red: '#f05858',
  white: '#ffffff',
  badgeBg: '#1a1a1a'
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

interface ClipboardItem {
  id: string
  text: string | null
  type: 'text' | 'image'
  timestamp: string
  copyCount: number
  pinned: boolean
  preview: string
  imageDataUrl?: string
  imageWidth?: number
  imageHeight?: number
}

type SortMode = 'recent' | 'frequency'
type ViewMode = 'main' | 'settings'

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
              <span style={{ fontSize: 16, fontWeight: 600, color: DS.textPrimary }}>
                QuickBoard
              </span>
              <span style={{ fontSize: 10, color: DS.textDim }}>
                {filteredHistory.length} items
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <NavButton icon="&#9881;" onClick={switchToSettings} />
              <NavButton icon="&#8212;" onClick={handleMinimize} />
              <NavButton icon="&#10005;" onClick={handleClose} isClose />
            </div>
          </div>

          {/* Search box */}
          <div style={{ padding: '12px 24px 0' }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search clips..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSelectedIndex(0)
              }}
              style={searchBoxStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = DS.white
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = DS.border
              }}
            />
          </div>

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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            animation: 'fadeIn 0.2s ease'
          }}
        >
          {/* Settings nav bar */}
          <div style={navBarStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <NavButton icon="&#9664;" onClick={switchToMain} />
              <span style={{ fontSize: 16, fontWeight: 600, color: DS.textPrimary }}>
                Settings
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
          </div>

          {/* Settings body */}
          <div style={{ padding: '12px 24px 24px', flex: 1 }}>
            <SectionLabel>History</SectionLabel>

            {/* Max items */}
            <SettingRow label="Max items" borderBottom>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={settingsMaxItems}
                  min={10}
                  max={200}
                  onChange={(e) =>
                    setSettingsMaxItems(parseInt(e.target.value) || 50)
                  }
                  style={settingNumStyle}
                />
                <span style={{ fontSize: 10, color: DS.textDim }}>clips</span>
              </div>
            </SettingRow>

            {/* Keyboard shortcut (read-only) */}
            <SettingRow label="Keyboard shortcut" borderBottom>
              <span
                style={{
                  fontSize: 11,
                  color: DS.textDim,
                  fontWeight: 500
                }}
              >
                Ctrl+Shift+V
              </span>
            </SettingRow>

            <SectionLabel>Options</SectionLabel>

            {/* Plain text mode */}
            <SettingRow label="Plain text mode" borderBottom>
              <Toggle
                checked={settingsPlainText}
                onChange={() => setSettingsPlainText(!settingsPlainText)}
              />
            </SettingRow>

            {/* Encrypt history */}
            <SettingRow label="Encrypt history">
              <Toggle
                checked={settingsEncrypt}
                onChange={() => setSettingsEncrypt(!settingsEncrypt)}
              />
            </SettingRow>

            {/* Clear All History button */}
            <button onClick={handleClearHistory} style={clearBtnStyle}>
              Clear All History
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Individual clip row matching HTML .clip-row */
function ClipRow({
  item,
  icon,
  time,
  showBadge,
  isSelected,
  onSelect,
  onPin,
  onDelete
}: {
  item: ClipboardItem
  icon: string
  time: string
  showBadge: boolean
  isSelected: boolean
  onSelect: () => void
  onPin: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const rowBg = isSelected ? DS.bgLight : hovered ? DS.bgLight : 'transparent'

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 10,
        cursor: 'pointer',
        marginBottom: 2,
        transition: 'background 0.15s',
        alignItems: 'flex-start',
        background: rowBg
      }}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon */}
      <div style={clipIconStyle}>{icon}</div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.type === 'image' && item.imageDataUrl ? (
          <img
            src={item.imageDataUrl}
            alt="clipboard image"
            style={{
              maxWidth: 100,
              maxHeight: 60,
              borderRadius: 4,
              display: 'block'
            }}
          />
        ) : (
          <div style={clipPreviewStyle}>{item.preview}</div>
        )}

        {/* Meta row */}
        <div style={clipMetaStyle}>
          <span>{time}</span>
          {showBadge && item.copyCount > 1 && (
            <span style={clipBadgeStyle}>&times;{item.copyCount}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0
        }}
      >
        <ActionButton
          icon={item.pinned ? '\u2605' : '\u2606'}
          defaultColor={item.pinned ? DS.yellow : DS.textGhost}
          hoverColor={DS.yellow}
          onClick={onPin}
        />
        <ActionButton
          icon="\u00D7"
          defaultColor={DS.textGhost}
          hoverColor={DS.red}
          onClick={onDelete}
        />
      </div>
    </div>
  )
}

/** Pin / Delete action button */
function ActionButton({
  icon,
  defaultColor,
  hoverColor,
  onClick
}: {
  icon: string
  defaultColor: string
  hoverColor: string
  onClick: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 14,
        padding: 2,
        color: hovered ? hoverColor : defaultColor,
        transition: 'color 0.2s',
        lineHeight: 1
      }}
    >
      {icon}
    </button>
  )
}

/** Nav bar button (32x32 circle) matching HTML .nav-btn */
function NavButton({
  icon,
  onClick,
  isClose = false
}: {
  icon: string
  onClick: () => void
  isClose?: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: `1px solid ${hovered ? (isClose ? DS.red : DS.textGhost) : DS.border}`,
        background: hovered ? DS.bgHover : 'transparent',
        color: hovered ? (isClose ? DS.red : DS.white) : DS.textMuted,
        cursor: 'pointer',
        fontSize: 14,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        outline: 'none',
        padding: 0
      }}
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  )
}

/** Sort toggle button matching HTML .sort-btn */
function SortButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 7,
        border: 'none',
        borderRadius: 8,
        background: active ? DS.surface : DS.bgLight,
        color: active ? DS.white : DS.textLabel,
        fontFamily: 'inherit',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '1.5px',
        textTransform: 'uppercase' as const,
        cursor: 'pointer',
        transition: 'all 0.2s',
        outline: 'none'
      }}
    >
      {label}
    </button>
  )
}

/** Section label matching HTML .sec-label */
function SectionLabel({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: '2.5px',
        textTransform: 'uppercase' as const,
        color: DS.textLabel,
        margin: '16px 0 8px'
      }}
    >
      {children}
    </div>
  )
}

/** Settings row matching HTML .setting-row */
function SettingRow({
  label,
  children,
  borderBottom = false
}: {
  label: string
  children: React.ReactNode
  borderBottom?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        borderBottom: borderBottom ? `1px solid ${DS.bgLight}` : 'none'
      }}
    >
      <span style={{ fontSize: 13, color: DS.textSecondary }}>{label}</span>
      {children}
    </div>
  )
}

/** Toggle switch matching HTML .toggle-wrap exactly */
function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <label
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        cursor: 'pointer',
        display: 'inline-block',
        flexShrink: 0
      }}
      onClick={(e) => {
        e.preventDefault()
        onChange()
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? DS.green : DS.surface,
          borderRadius: 10,
          transition: 'background 0.25s'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 19 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: checked ? DS.white : '#444444',
          transition: 'all 0.25s'
        }}
      />
    </label>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: DS.bg,
  color: DS.textPrimary,
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
  overflow: 'hidden',
  borderRadius: 28
}

const navBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '20px 24px 0',
  flexShrink: 0
}

const searchBoxStyle: CSSProperties = {
  width: '100%',
  background: DS.bgLight,
  border: `1px solid ${DS.border}`,
  borderRadius: 12,
  padding: '10px 14px',
  fontFamily: 'inherit',
  fontSize: 13,
  color: DS.white,
  outline: 'none',
  transition: 'border-color 0.2s'
}

const clipListStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 24px 16px',
  minHeight: 0
}

const clipIconStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  background: DS.bgLight,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  flexShrink: 0
}

const clipPreviewStyle: CSSProperties = {
  fontSize: 12,
  color: DS.textSecondary,
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
  overflow: 'hidden'
}

const clipMetaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  fontSize: 9,
  color: DS.textLabel
}

const clipBadgeStyle: CSSProperties = {
  background: DS.badgeBg,
  padding: '2px 6px',
  borderRadius: 4,
  fontWeight: 600,
  color: DS.white,
  fontSize: 9
}

const emptyStateStyle: CSSProperties = {
  textAlign: 'center',
  padding: '50px 20px',
  color: DS.textGhost,
  fontSize: 12
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 30,
  left: '50%',
  transform: 'translateX(-50%)',
  background: DS.green,
  color: DS.bg,
  padding: '8px 20px',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1px',
  transition: 'opacity 0.2s',
  zIndex: 10
}

const settingNumStyle: CSSProperties = {
  width: 44,
  textAlign: 'center',
  background: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  color: DS.white,
  outline: 'none'
}

const clearBtnStyle: CSSProperties = {
  width: '100%',
  marginTop: 16,
  padding: 12,
  border: '1px solid #2a1515',
  borderRadius: 12,
  background: '#1a0a0a',
  color: DS.red,
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  outline: 'none'
}
