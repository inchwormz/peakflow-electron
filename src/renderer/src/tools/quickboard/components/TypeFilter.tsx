/**
 * TypeFilter — Content type filter chips for QuickBoard.
 */

import { DS, type ClipboardItem } from './shared'

export type ContentTypeFilter = 'all' | ClipboardItem['contentType']

interface TypeFilterProps {
  active: ContentTypeFilter
  onChange: (filter: ContentTypeFilter) => void
}

const FILTERS: { label: string; value: ContentTypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Text', value: 'text' },
  { label: 'Code', value: 'code' },
  { label: 'URLs', value: 'url' },
  { label: 'Images', value: 'image' },
  { label: 'Files', value: 'file' }
]

export function TypeFilter({ active, onChange }: TypeFilterProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '0 24px', flexWrap: 'wrap' }}>
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.5px',
            cursor: 'pointer',
            background: active === f.value ? DS.surface : 'transparent',
            color: active === f.value ? DS.white : DS.textLabel,
            transition: 'all 0.15s',
            fontFamily: 'inherit'
          }}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
