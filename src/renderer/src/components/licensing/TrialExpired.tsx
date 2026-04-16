import { useState, useCallback, useRef, type FormEvent, type CSSProperties } from 'react'
import type { LicenseActivationResult } from '@shared/ipc-types'
import { IPC_INVOKE } from '@shared/ipc-types'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'

const CHECKOUT_URL = 'https://getpeakflow.pro/#pricing'

interface TrialExpiredProps {
  toolName?: string
  /** The tool that was denied access (passed via URL query param) */
  deniedTool?: string
  /** 'trial_expired' or 'tool_not_licensed' */
  reason?: string
  onActivated?: () => void
}

/**
 * Full-screen overlay shown when the user's 14-day trial has expired
 * or when their license doesn't cover the requested tool.
 */
export function TrialExpired({ toolName, deniedTool, reason, onActivated }: TrialExpiredProps): React.JSX.Element {
  const isToolGated = reason === 'tool_not_licensed'
  const deniedToolName = deniedTool && Object.values(ToolId).includes(deniedTool as ToolId)
    ? TOOL_DISPLAY_NAMES[deniedTool as ToolId]
    : deniedTool
  const [licenseKey, setLicenseKey] = useState('')
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  })
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubscribe = useCallback(() => {
    void window.peakflow.invoke(IPC_INVOKE.SHELL_OPEN_EXTERNAL, CHECKOUT_URL)
  }, [])

  const handleClose = useCallback(() => {
    window.peakflow.invoke('window:close')
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

  const dragStyle: CSSProperties & { WebkitAppRegion?: string } = {
    WebkitAppRegion: 'drag'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(8, 8, 10, 0.92)' }}
    >
      {/* Draggable title bar with close button */}
      <div
        className="flex items-center justify-end shrink-0 px-2"
        style={{ ...dragStyle, height: 36 }}
      >
        <button
          onClick={handleClose}
          className="inline-flex items-center justify-center cursor-pointer"
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#666',
            width: 32,
            height: 32,
            borderRadius: '50%',
            transition: 'background 0.15s, color 0.15s'
          } as CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#666'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
      <div
        className="flex flex-col items-center w-full max-w-[420px] mx-4 px-8 py-10 rounded-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-dim)'
        }}
      >
        {/* Icon */}
        <div className="text-5xl mb-5 select-none" aria-hidden="true">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isToolGated ? 'var(--accent)' : 'var(--danger)'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isToolGated ? (
              /* Lock icon for tool-gated */
              <>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </>
            ) : (
              /* Clock icon for trial expired */
              <>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </>
            )}
          </svg>
        </div>

        {/* Heading */}
        <h1
          className="text-2xl font-semibold tracking-tight mb-2"
          style={{ color: isToolGated ? 'var(--accent)' : 'var(--danger)', fontFamily: "'Outfit', sans-serif" }}
        >
          {isToolGated ? `${deniedToolName ?? 'This tool'} not included` : 'Trial Expired'}
        </h1>

        {/* Subtitle */}
        <p
          className="text-sm text-center leading-relaxed mb-6 max-w-[340px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {isToolGated
            ? `Your license doesn't cover ${deniedToolName ?? 'this tool'}. Subscribe to get all tools, or buy it separately.`
            : `Your 14-day free trial of ${toolName ? `PeakFlow ${toolName}` : 'PeakFlow'} has ended. Subscribe to keep using all tools, or buy individual tools.`
          }
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
          All tools &mdash; $5/month
        </button>

        {/* One-time purchase hint */}
        <p
          className="text-xs mt-3 text-center"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Or buy individual tools forever from $9.99 at{' '}
          <span
            className="cursor-pointer"
            style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            onClick={handleSubscribe}
          >
            getpeakflow.pro
          </span>
        </p>

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
    </div>
  )
}
