/**
 * TagBar — Horizontal scrollable tag filter chips.
 */

import { DS } from './shared'

interface TagBarProps {
  tags: string[]
  activeTags: string[]
  onToggleTag: (tag: string) => void
}

export function TagBar({ tags, activeTags, onToggleTag }: TagBarProps): React.JSX.Element | null {
  if (tags.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 24px',
        overflowX: 'auto',
        flexShrink: 0
      }}
    >
      {tags.map((tag) => {
        const isActive = activeTags.includes(tag)
        return (
          <button
            key={tag}
            onClick={() => onToggleTag(tag)}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: `1px solid ${isActive ? DS.accent : DS.border}`,
              fontSize: 9,
              fontWeight: 600,
              cursor: 'pointer',
              background: isActive ? DS.accent : 'transparent',
              color: isActive ? DS.bg : DS.textLabel,
              transition: 'all 0.15s',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap'
            }}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}
