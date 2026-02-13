import { useState, useEffect, useCallback, useRef } from 'react'
import type { AccessStatus } from '@shared/ipc-types'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'

export interface LicenseState {
  loading: boolean
  allowed: boolean
  message: string
  daysRemaining: number
  isLicensed: boolean
}

/**
 * Manages license/trial state by querying the main process on mount
 * and listening for push updates via `license:status-changed`.
 */
export function useLicense(): LicenseState & { refresh: () => void } {
  const [state, setState] = useState<LicenseState>({
    loading: true,
    allowed: true,
    message: '',
    daysRemaining: 14,
    isLicensed: false
  })

  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const result = (await window.peakflow.invoke(
        IPC_INVOKE.SECURITY_CHECK_ACCESS
      )) as AccessStatus

      if (mountedRef.current) {
        setState({
          loading: false,
          allowed: result.allowed,
          message: result.message,
          daysRemaining: result.daysRemaining,
          isLicensed: result.isLicensed
        })
      }
    } catch (err) {
      console.error('[useLicense] Failed to check access:', err)
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: false }))
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    refresh()

    // Listen for push updates from main process
    const unsubscribe = window.peakflow.on(
      IPC_SEND.LICENSE_STATUS_CHANGED,
      () => {
        refresh()
      }
    )

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [refresh])

  return { ...state, refresh }
}
