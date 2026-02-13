import { useState, useCallback, useRef, type FormEvent } from 'react'
import type { LicenseActivationResult } from '@shared/ipc-types'
import { IPC_INVOKE } from '@shared/ipc-types'

interface LicenseActivationProps {
  onActivated?: () => void
}

/**
 * Compact inline license key activation component for use in settings panels.
 * Single row: input + activate button with status feedback.
 */
export function LicenseActivation({ onActivated }: LicenseActivationProps): React.JSX.Element {
  const [licenseKey, setLicenseKey] = useState('')
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  })
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="flex flex-col gap-2">
      <form onSubmit={handleActivate} className="flex gap-2">
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
            padding: '8px 12px',
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
          className="shrink-0 text-xs cursor-pointer border-none outline-none transition-colors duration-200"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-mid)',
            color: 'var(--text-secondary)',
            fontFamily: "'Outfit', sans-serif",
            padding: '8px 14px',
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

      {/* Status feedback */}
      {status.message && status.type !== 'loading' && (
        <p
          className="text-xs transition-opacity duration-200"
          style={{
            color: status.type === 'success' ? 'var(--success)' : status.type === 'error' ? 'var(--danger)' : 'var(--text-secondary)'
          }}
        >
          {status.message}
        </p>
      )}
    </div>
  )
}
