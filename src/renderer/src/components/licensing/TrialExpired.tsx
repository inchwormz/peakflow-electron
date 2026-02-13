import { useState, useCallback, useRef, type FormEvent } from 'react'
import type { LicenseActivationResult } from '@shared/ipc-types'
import { IPC_INVOKE } from '@shared/ipc-types'

const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

interface TrialExpiredProps {
  toolName?: string
  onActivated?: () => void
}

/**
 * Full-screen overlay shown when the user's 14-day trial has expired.
 * Offers subscription CTA and inline license key activation.
 */
export function TrialExpired({ toolName, onActivated }: TrialExpiredProps): React.JSX.Element {
  const [licenseKey, setLicenseKey] = useState('')
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  })
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubscribe = useCallback(() => {
    window.open(CHECKOUT_URL, '_blank')
  }, [])

  const handleActivate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()

      const key = licenseKey.trim()
      if (!key) {
        inputRef.current?.focus()
        return
      }

      setStatus({ type: 'loading', message: 'Validating...' })

      try {
        const result = (await window.peakflow.invoke(
          IPC_INVOKE.SECURITY_ACTIVATE_LICENSE,
          key
        )) as LicenseActivationResult

        if (result.success) {
          setStatus({ type: 'success', message: result.message || 'License activated!' })
          setTimeout(() => {
            onActivated?.()
          }, 1500)
        } else {
          setStatus({ type: 'error', message: result.message || 'Invalid license key.' })
        }
      } catch (err) {
        setStatus({
          type: 'error',
          message: err instanceof Error ? err.message : 'Activation failed. Please try again.'
        })
      }
    },
    [licenseKey, onActivated]
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(8, 8, 10, 0.92)' }}
    >
      <div
        className="flex flex-col items-center w-full max-w-[420px] mx-4 px-8 py-10 rounded-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-dim)'
        }}
      >
        {/* Clock icon */}
        <div className="text-5xl mb-5 select-none" aria-hidden="true">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--danger)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        {/* Heading */}
        <h1
          className="text-2xl font-semibold tracking-tight mb-2"
          style={{ color: 'var(--danger)', fontFamily: "'Outfit', sans-serif" }}
        >
          Trial Expired
        </h1>

        {/* Subtitle */}
        <p
          className="text-sm text-center leading-relaxed mb-6 max-w-[340px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Your 14-day free trial of {toolName ? `PeakFlow ${toolName}` : 'PeakFlow'} has ended.
          Subscribe to Pro to keep using all tools.
        </p>

        {/* Subscribe button */}
        <button
          onClick={handleSubscribe}
          className="w-full font-semibold text-sm cursor-pointer border-none outline-none transition-colors duration-200"
          style={{
            background: 'var(--accent)',
            color: 'var(--bg-void)',
            fontFamily: "'Outfit', sans-serif",
            padding: '12px 24px',
            borderRadius: '10px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-bright)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)'
          }}
        >
          Subscribe &mdash; $5/month
        </button>

        {/* Separator */}
        <div
          className="w-full my-6"
          style={{ height: '1px', background: 'var(--border-dim)' }}
        />

        {/* License activation section */}
        <span
          className="text-xs mb-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Already have a license key?
        </span>

        <form onSubmit={handleActivate} className="flex w-full gap-2">
          <input
            ref={inputRef}
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="Enter license key..."
            disabled={status.type === 'loading' || status.type === 'success'}
            className="flex-1 min-w-0 outline-none transition-colors duration-200"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-dim)',
              color: 'var(--text-primary)',
              fontFamily: "'DM Mono', monospace",
              fontSize: '13px',
              padding: '10px 12px',
              borderRadius: '6px'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-mid)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-dim)'
            }}
          />
          <button
            type="submit"
            disabled={status.type === 'loading' || status.type === 'success'}
            className="shrink-0 text-sm cursor-pointer border-none outline-none transition-colors duration-200"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-mid)',
              color: 'var(--text-secondary)',
              fontFamily: "'Outfit', sans-serif",
              padding: '10px 16px',
              borderRadius: '6px',
              opacity: status.type === 'loading' || status.type === 'success' ? 0.5 : 1
            }}
            onMouseEnter={(e) => {
              if (status.type !== 'loading' && status.type !== 'success') {
                e.currentTarget.style.color = 'var(--text-primary)'
                e.currentTarget.style.borderColor = 'var(--border-bright)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.borderColor = 'var(--border-mid)'
            }}
          >
            {status.type === 'loading' ? 'Validating...' : 'Activate'}
          </button>
        </form>

        {/* Status message */}
        {status.type !== 'idle' && status.type !== 'loading' && (
          <p
            className="text-xs mt-3 text-center transition-opacity duration-200"
            style={{
              color: status.type === 'success' ? 'var(--success)' : 'var(--danger)'
            }}
          >
            {status.message}
          </p>
        )}
      </div>
    </div>
  )
}
