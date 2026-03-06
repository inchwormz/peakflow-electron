/**
 * QueueBanner — Shows sequential paste status at top of QuickBoard.
 */

import { DS } from './shared'

interface QueueBannerProps {
  current: number
  total: number
  onCancel: () => void
}

export function QueueBanner({ current, total, onCancel }: QueueBannerProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 24px',
        background: DS.surface,
        borderBottom: `1px solid ${DS.border}`,
        flexShrink: 0
      }}
    >
      <span style={{ fontSize: 11, color: DS.accent, fontWeight: 600 }}>
        Pasting {current} of {total}
      </span>
      <button
        onClick={onCancel}
        style={{
          border: 'none',
          background: 'transparent',
          color: DS.red,
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit'
        }}
      >
        Cancel
      </button>
    </div>
  )
}
