import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { AccessStatus } from '@shared/ipc-types'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'

export interface LicenseState {
  loading: boolean
  allowed: boolean
  message: string
  daysRemaining: number
  isLicensed: boolean
  isSuiteLicense: boolean
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
    isLicensed: false,
    isSuiteLicense: false
  })

  const mountedRef = useRef(true)

  /** Tool windows need per-tool access; Dashboard uses suite-wide check. */
  const scopedToolId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('toolId')
    if (raw && Object.values(ToolId).includes(raw as ToolId)) {
      return raw as ToolId
    }
    return null
  }, [])

  const refresh = useCallback(async () => {
    try {
      const result = (scopedToolId
        ? await window.peakflow.invoke(IPC_INVOKE.SECURITY_CHECK_TOOL_ACCESS, scopedToolId)
        : await window.peakflow.invoke(IPC_INVOKE.SECURITY_CHECK_ACCESS)) as AccessStatus

      if (mountedRef.current) {
        setState({
          loading: false,
          allowed: result.allowed,
          message: result.message,
          daysRemaining: result.daysRemaining,
          // On tool windows, badge follows whether THIS tool is licensed
          isLicensed: scopedToolId ? result.isToolLicensed : result.isLicensed,
          isSuiteLicense: result.isSuiteLicense === true
        })
      }
    } catch (err) {
      console.error('[useLicense] Failed to check access:', err)
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: false }))
      }
    }
  }, [scopedToolId])

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
