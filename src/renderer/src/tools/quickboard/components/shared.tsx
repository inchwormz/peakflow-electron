/**
 * QuickBoard shared design tokens, types, and small sub-components.
 */

import { useState, type CSSProperties } from 'react'

// ─── Design Tokens (dark cinematic -- matches Python COLORS) ────────────────

export const DS = {
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
  accent: '#ffe17c',
  yellow: '#eab308',
  red: '#f05858',
  white: '#ffffff',
  badgeBg: '#1a1a1a'
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClipboardItem {
  id: string
  text: string | null
  type: 'text' | 'image' | 'file'
  timestamp: string
  copyCount: number
  pinned: boolean
  preview: string
  imageDataUrl?: string
  imageWidth?: number
  imageHeight?: number
  tags: string[]
  sourceApp: string | null
  contentType: 'text' | 'code' | 'url' | 'image' | 'file'
  ocrText: string | null
  filePaths?: string[]
  fileMeta?: { name: string; size: number; ext: string }[]
  editedText?: string
  linkTitle?: string
  linkFavicon?: string
}

export type SortMode = 'recent' | 'frequency'
export type ViewMode = 'main' | 'settings'

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Pin / Delete action button */
export function ActionButton({
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
export function NavButton({
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
export function SortButton({
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
export function SectionLabel({
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
export function SettingRow({
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
export function Toggle({
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
          background: checked ? DS.accent : DS.surface,
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

// ─── Shared Styles ──────────────────────────────────────────────────────────

export const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: DS.bg,
  color: DS.textPrimary,
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
  overflow: 'hidden',
  borderRadius: 28
}

export const navBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '20px 24px 0',
  flexShrink: 0,
  // @ts-expect-error -- Electron-specific CSS property for window dragging
  WebkitAppRegion: 'drag'
}

export const searchBoxStyle: CSSProperties = {
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

export const clipListStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 24px 16px',
  minHeight: 0
}

export const clipIconStyle: CSSProperties = {
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

export const clipPreviewStyle: CSSProperties = {
  fontSize: 12,
  color: DS.textSecondary,
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as CSSProperties['WebkitBoxOrient'],
  overflow: 'hidden'
}

export const clipMetaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  fontSize: 9,
  color: DS.textLabel
}

export const clipBadgeStyle: CSSProperties = {
  background: DS.badgeBg,
  padding: '2px 6px',
  borderRadius: 4,
  fontWeight: 600,
  color: DS.white,
  fontSize: 9
}

export const emptyStateStyle: CSSProperties = {
  textAlign: 'center',
  padding: '50px 20px',
  color: DS.textGhost,
  fontSize: 12
}

export const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 30,
  left: '50%',
  transform: 'translateX(-50%)',
  background: DS.accent,
  color: DS.bg,
  padding: '8px 20px',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1px',
  transition: 'opacity 0.2s',
  zIndex: 10
}

export const settingNumStyle: CSSProperties = {
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

export const clearBtnStyle: CSSProperties = {
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
