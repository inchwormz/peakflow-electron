/**
 * The panel's building blocks: the one row component, groups, switches,
 * segmented controls, sliders, number fields, pickers, shortcut recorders,
 * notes, empty states and buttons. They mirror the prototype's helpers
 * (row, grp, tg, seg, slider, num, cyc, rec, empty, hero, primary, btn) and
 * use the classes in panel.css, so every screen shares one rhythm.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { useNav } from './nav'
import { formatAccelerator, isMac, useAppIcon } from './hooks'
import type { AppIconQuery } from '@shared/ipc-types'

const cx = (...c: Array<string | false | null | undefined>): string => c.filter(Boolean).join(' ')

function IconSlot({ icon }: { icon?: IconName | ReactNode }): React.JSX.Element | null {
  if (!icon) return null
  return <span className="ic">{typeof icon === 'string' ? <Icon name={icon as IconName} /> : icon}</span>
}

/* ─── Row: the one row component ─────────────────────────────────────────── */

export interface RowProps {
  label: ReactNode
  sub?: ReactNode
  right?: ReactNode
  /** Grey value text on the right (shorthand for right={<V>…</V>}). */
  value?: ReactNode
  icon?: IconName | ReactNode
  /** Drill into this route (adds the chevron). */
  go?: string
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  tone?: 'danger' | 'muted' | 'locked'
  nochev?: boolean
  style?: CSSProperties
  title?: string
}

export function Row({ label, sub, right, value, icon, go, onClick, onContextMenu, tone, nochev, style, title }: RowProps): React.JSX.Element {
  const nav = useNav()
  const clickable = !!go || !!onClick
  const activate = (): void => {
    if (onClick) onClick()
    else if (go) nav.go(go)
  }
  return (
    <div
      className={cx('r', tone)}
      data-go={go ? '' : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? (e) => {
        // Clicks on controls inside the row (switches, buttons, inputs) don't navigate
        if ((e.target as HTMLElement).closest('button, input, select, textarea, a') && e.target !== e.currentTarget) return
        activate()
      } : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) activate() } : undefined}
      onContextMenu={onContextMenu}
      style={{ ...(clickable ? { cursor: 'default' } : null), ...style }}
      title={title}
    >
      <IconSlot icon={icon} />
      <div className="l">
        {label}
        {sub ? <small>{sub}</small> : null}
      </div>
      <span className="ri">
        {value !== undefined && value !== null ? <span className="v">{value}</span> : null}
        {right}
        {go && !nochev ? <Icon name="chevR" className="go" /> : null}
      </span>
    </div>
  )
}

export function Grp({ children, style }: { children: ReactNode; style?: CSSProperties }): React.JSX.Element {
  return <div className="grp" style={style}>{children}</div>
}

export function V({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="v">{children}</span>
}

export function Note({ children, style }: { children: ReactNode; style?: CSSProperties }): React.JSX.Element {
  return <div className="note" style={style}>{children}</div>
}

export function Gap({ h = 14 }: { h?: number }): React.JSX.Element {
  return <div style={{ height: h }} />
}

/* ─── Controls ───────────────────────────────────────────────────────────── */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
    />
  )
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

/** Text tabs like "Recent · Most copied" or "Light Medium Heavy Max". */
export function TextTabs<T extends string | number>({ value, options, onChange, style, children }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; style?: CSSProperties; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="tabs-txt" style={style}>
      {options.map(([v, l]) => (
        <button key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
      {children}
    </div>
  )
}

/** Slider row: label, value on the right, full-width track underneath. Commits on release. */
export function SliderRow({ label, value, min, max, step = 1, format, onChange, onCommit }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (v: number) => string
  onChange?: (v: number) => void
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [local, setLocal] = useState(value)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setLocal(value)
  }, [value])
  const pct = ((local - min) / (max - min)) * 100
  return (
    <div className="r" style={{ flexWrap: 'wrap', paddingBottom: 10 }}>
      <div className="l">{label}</div>
      <span className="v">{format(local)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        aria-label={label}
        style={{ flexBasis: '100%', ['--p' as string]: `${pct}%` } as CSSProperties}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          onChange?.(v)
        }}
        onPointerUp={(e) => {
          dragging.current = false
          onCommit(Number((e.target as HTMLInputElement).value))
        }}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  )
}

/** Small number field + unit; commits on blur or Enter, clamped to [min, max]. */
export function NumIn({ value, onCommit, unit, min = 0, max = 9999, label, width }: { value: number; onCommit: (v: number) => void; unit?: string; min?: number; max?: number; label: string; width?: number }): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = parseInt(text, 10)
    if (Number.isNaN(n)) {
      setText(String(value))
      return
    }
    const c = Math.max(min, Math.min(max, n))
    setText(String(c))
    if (c !== value) onCommit(c)
  }
  return (
    <>
      <input
        className="num-in"
        inputMode="numeric"
        aria-label={label}
        value={text}
        style={width ? { width } : undefined}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </>
  )
}

/** A compact picker that looks like the prototype's select button, backed by a native menu. */
export function Picker<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }): React.JSX.Element {
  const current = options.find(([v]) => v === value)?.[1] ?? String(value)
  return (
    <span className="select" style={{ position: 'relative' }}>
      {current} <Icon name="chev" />
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find(([v]) => String(v) === e.target.value)
          if (hit) onChange(hit[0])
        }}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'default' }}
      >
        {options.map(([v, l]) => (
          <option key={String(v)} value={String(v)}>
            {l}
          </option>
        ))}
      </select>
    </span>
  )
}

/** Electron accelerator from a keydown, or null for a bare modifier / no modifier. */
function acceleratorFromEvent(e: React.KeyboardEvent): string | null {
  if (['Meta', 'Alt', 'Control', 'Shift'].includes(e.key)) return null
  if (!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push(isMac() ? 'Control' : 'CommandOrControl')
  if (e.metaKey) parts.push(isMac() ? 'CommandOrControl' : 'Super')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key
  const map: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Backquote: '`' }
  key = map[key] ?? map[e.code] ?? key
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

/**
 * Shortcut recorder button: click, then press the keys. Needs ⌘, ⌥, ⌃ or ⇧.
 * Esc cancels. `onRecord` receives an Electron accelerator string.
 */
export function Rec({ value, onRecord, disabled }: { value: string; onRecord?: (accel: string) => void; disabled?: boolean }): React.JSX.Element {
  const [on, setOn] = useState(false)
  return (
    <button
      className={cx('rec', on && 'on')}
      disabled={disabled || !onRecord}
      onClick={(e) => {
        e.stopPropagation()
        setOn((v) => !v)
      }}
      onBlur={() => setOn(false)}
      onKeyDown={(e) => {
        if (!on) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') return setOn(false)
        const accel = acceleratorFromEvent(e)
        if (!accel) return
        setOn(false)
        onRecord?.(accel)
      }}
    >
      {on ? 'Press keys…' : value ? formatAccelerator(value) : 'Set'}
    </button>
  )
}

/* ─── Buttons ────────────────────────────────────────────────────────────── */

export function Btn({ children, onClick, primary, block, lg, sm, disabled, style, title }: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  block?: boolean
  lg?: boolean
  sm?: boolean
  disabled?: boolean
  style?: CSSProperties
  title?: string
}): React.JSX.Element {
  return (
    <button
      className={cx('btn', primary && 'primary', block && 'block', lg && 'lg', sm && 'sm')}
      disabled={disabled}
      style={style}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </button>
  )
}

/** The one white button on a screen, full width. */
export function Primary({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <Btn primary block lg onClick={onClick} disabled={disabled}>
      {children}
    </Btn>
  )
}

export function IconBtn({ icon, label, onClick, active, style }: { icon: IconName; label: string; onClick?: () => void; active?: boolean; style?: CSSProperties }): React.JSX.Element {
  return (
    <button
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      style={active ? { color: 'var(--text)', background: 'var(--active)', ...style } : style}
    >
      <Icon name={icon} />
    </button>
  )
}

export function LinkBtn({ children, onClick, style }: { children: ReactNode; onClick?: () => void; style?: CSSProperties }): React.JSX.Element {
  return (
    <button
      className="link"
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </button>
  )
}

/* ─── States ─────────────────────────────────────────────────────────────── */

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="empty">
      <div className="ei">
        <Icon name={icon} />
      </div>
      <b>{title}</b>
      {children}
    </div>
  )
}

export function Hero({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="hero">
      <div className="hi">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  )
}

export function Banner({ icon, children, action, style }: { icon?: IconName; children: ReactNode; action?: ReactNode; style?: CSSProperties }): React.JSX.Element {
  return (
    <div className="banner" style={style}>
      {icon ? <Icon name={icon} style={{ width: 16, height: 16, flex: 'none' }} /> : null}
      <span className="grow">{children}</span>
      {action}
    </div>
  )
}

/* ─── Real app icons (the only colour in the UI) ─────────────────────────── */

export function AppIcon({ q, size = 18 }: { q: AppIconQuery | null | undefined; size?: number }): React.JSX.Element {
  const src = useAppIcon(q)
  const style = { width: size, height: size, borderRadius: size / 4 }
  return src ? <img className="logo" src={src} alt="" style={style} draggable={false} /> : <span className="logo ph" style={style} />
}

/* ─── Progress ring (Liquid Focus) ───────────────────────────────────────── */

export function Ring({ size, frac, stroke = 3 }: { size: number; frac: number; stroke?: number }): React.JSX.Element {
  const r = 70
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, frac))
  return (
    <svg viewBox="0 0 160 160" style={{ width: size, height: size, transform: 'rotate(-90deg)' }}>
      <circle cx="80" cy="80" r={r} stroke="var(--active)" strokeWidth={stroke} fill="none" />
      <circle
        cx="80"
        cy="80"
        r={r}
        stroke="var(--text)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        style={{ transition: 'stroke-dashoffset .8s linear' }}
      />
    </svg>
  )
}

/** Open a link in the browser through the main process's URL allow-list. */
export function openExternal(url: string): void {
  window.peakflow.invoke('shell:open-external', url).catch(() => {})
}
