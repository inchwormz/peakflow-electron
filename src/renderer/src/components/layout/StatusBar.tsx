import { useCallback } from 'react'
import { useLicense } from '@renderer/hooks/useLicense'

const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

/**
 * 24px status bar pinned to the bottom of every tool window.
 * Shows license/trial state with color-coded messaging.
 * Clickable when in trial/expired state to open the pricing page.
 */
export function StatusBar(): React.JSX.Element {
  const { loading, isLicensed, daysRemaining, allowed } = useLicense()

  const handleClick = useCallback(() => {
    if (!isLicensed) {
      window.open(CHECKOUT_URL, '_blank')
    }
  }, [isLicensed])

  // Determine display state
  const trialExpired = !allowed && !isLicensed
  const trialWarning = !isLicensed && allowed && daysRemaining <= 3
  const trialNormal = !isLicensed && allowed && daysRemaining > 3

  let label: string
  let color: string

  if (loading) {
    label = ''
    color = 'var(--text-tertiary)'
  } else if (isLicensed) {
    label = '\u2713 Pro'
    color = 'var(--success)'
  } else if (trialExpired) {
    label = 'Trial expired'
    color = 'var(--danger)'
  } else if (trialWarning) {
    label = `\u26A0 Trial: ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`
    color = '#eab308'
  } else if (trialNormal) {
    label = `Trial: ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`
    color = 'var(--text-secondary)'
  } else {
    label = ''
    color = 'var(--text-secondary)'
  }

  return (
    <div
      onClick={!isLicensed ? handleClick : undefined}
      className="flex items-center px-3 shrink-0 select-none transition-colors duration-200"
      style={{
        height: '24px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-dim)',
        cursor: !isLicensed ? 'pointer' : 'default'
      }}
      role={!isLicensed ? 'button' : undefined}
      tabIndex={!isLicensed ? 0 : undefined}
      onKeyDown={(e) => {
        if (!isLicensed && (e.key === 'Enter' || e.key === ' ')) {
          handleClick()
        }
      }}
    >
      <span
        className="text-xs leading-none"
        style={{
          color,
          fontSize: '11px',
          fontFamily: "'Outfit', sans-serif"
        }}
      >
        {label}
      </span>
    </div>
  )
}
