import { type CSSProperties, useState } from 'react'

interface Tab {
  id: string
  label: string
}

interface TabGroupProps {
  tabs: Tab[]
  activeTab: string
  onChange: (tabId: string) => void
  className?: string
}

/**
 * Pill-style tab group matching PeakFlow desktop design specs.
 * Container: bg #111, radius 10px, padding 3px.
 * Active tab: bg #222, 9px weight 600.
 * Inactive tab: transparent bg, 9px.
 */
export function TabGroup({
  tabs,
  activeTab,
  onChange,
  className
}: TabGroupProps): React.JSX.Element {
  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    background: '#111111',
    borderRadius: 10,
    padding: 3,
    gap: 2
  }

  return (
    <div style={containerStyle} className={className}>
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          isActive={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
        />
      ))}
    </div>
  )
}

interface TabButtonProps {
  label: string
  isActive: boolean
  onClick: () => void
}

function TabButton({ label, isActive, onClick }: TabButtonProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  const style: CSSProperties = {
    fontSize: 9,
    fontWeight: isActive ? 600 : 400,
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif",
    color: isActive ? '#ffffff' : hovered ? '#cccccc' : '#888888',
    background: isActive ? '#222222' : 'transparent',
    border: 'none',
    outline: 'none',
    borderRadius: 8,
    padding: '5px 12px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    transition: 'background 0.15s, color 0.15s'
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
    >
      {label}
    </button>
  )
}
