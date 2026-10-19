/**
 * Liquid Focus Background: always mounted in the panel window, which stays
 * alive while hidden. It does the jobs the old Liquid Focus window used to:
 *  - plays the phase-complete sound (main only sends it when sounds are on);
 *  - runs the webcam FocusDetector during a running work session when focus
 *    detection is on (the detector records each interruption itself);
 *  - shows the always-on-top mini timer whenever a session is running or
 *    paused, except while the panel is open on Liquid Focus (prototype rule).
 */

import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'
import { invoke, useIpcEvent, usePanelVisible, useToolConfig } from '../../hooks'
import { useNav } from '../../nav'
import { detectorStore, isActive, refreshLF, setMini, useLF, type DetectorStatus } from './store'

const FocusDetector = lazy(() => import('../../../tools/liquidfocus/FocusDetector').then((m) => ({ default: m.FocusDetector })))

export function Background(): React.JSX.Element | null {
  const lf = useLF()
  const nav = useNav()
  const visible = usePanelVisible()
  const [cfg, , reloadCfg] = useToolConfig<LiquidFocusConfig>(ToolId.LiquidFocus)
  const t = lf?.timer

  useIpcEvent(IPC_SEND.LIQUIDFOCUS_PHASE_COMPLETE, (phase) => playPhaseSound(String(phase)))
  // Looking away reset the session (main did it); say why if the panel is the one on screen
  useIpcEvent(IPC_SEND.LIQUIDFOCUS_AWAY_RESET, () => {
    if (visible) nav.toast('Looked away — timer reset')
  })

  // Fresh numbers when the panel opens
  useEffect(() => {
    if (visible) refreshLF()
  }, [visible])

  // Settings may change while the panel is open; re-read them when a session starts, changes phase or the panel closes
  useEffect(() => {
    reloadCfg()
  }, [t?.status, t?.mode, visible, reloadCfg])

  // Mini timer: open while a session runs (or is paused), closed while the panel shows Liquid Focus
  const active = isActive(t)
  const lfOpen = visible && nav.route.split('/')[0] === 'liquidfocus'
  const ready = !!t
  useEffect(() => {
    if (!ready) return
    if (lfOpen) setMini(false)
    else if (active) setMini(true)
  }, [ready, lfOpen, active])

  // Focus detection
  const enabled = !!cfg?.focus_detection_enabled
  const detActive = enabled && t?.mode === 'work' && t?.status === 'running'
  const lastStatus = useRef<DetectorStatus>('off')
  const detActiveRef = useRef(detActive)
  detActiveRef.current = detActive
  // Must stay stable: the detector restarts the camera whenever this callback changes
  const onStatus = useCallback((s: string) => {
    const status = s as DetectorStatus
    // The detector reports 'loading' when it stops; ignore that outside a running work session
    if (!detActiveRef.current && status === 'loading') return
    const cur = detectorStore.get()
    const enteringAway = status === 'away' && lastStatus.current !== 'away'
    // The mini timer's eye icon follows the detector (sent only when it changes)
    if (status !== lastStatus.current) invoke(IPC_INVOKE.LIQUIDFOCUS_DETECTOR_STATUS, status).catch(() => {})
    lastStatus.current = status
    detectorStore.set({
      status,
      distractions: cur.distractions + (enteringAway ? 1 : 0),
      noCamera: status === 'no-camera' ? true : status === 'focused' || status === 'away' ? false : cur.noCamera
    })
  }, [])

  // A new or stopped session starts the distraction count again; pausing keeps it
  const sessionKey = t ? (t.mode === 'work' && t.status !== 'idle' ? 'work' : 'none') : 'none'
  useEffect(() => {
    if (sessionKey === 'none') {
      if (lastStatus.current !== 'off') invoke(IPC_INVOKE.LIQUIDFOCUS_DETECTOR_STATUS, 'off').catch(() => {})
      lastStatus.current = 'off'
      detectorStore.set({ ...detectorStore.get(), status: 'off', distractions: 0 })
    }
  }, [sessionKey])
  useEffect(() => {
    if (detActive) {
      invoke(IPC_INVOKE.LIQUIDFOCUS_DETECTOR_STATUS, 'loading').catch(() => {})
      lastStatus.current = 'loading'
      detectorStore.set({ ...detectorStore.get(), status: 'loading' })
    }
  }, [detActive])
  useEffect(() => {
    if (!enabled) {
      detectorStore.set({ ...detectorStore.get(), status: 'off' })
      invoke(IPC_INVOKE.LIQUIDFOCUS_DETECTOR_STATUS, 'off').catch(() => {})
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div
      aria-hidden
      style={{ position: 'fixed', left: -10000, top: 0, width: 48, height: 36, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
    >
      <Suspense fallback={null}>
        <FocusDetector
          active={detActive}
          thresholdSecs={cfg?.focus_away_threshold_secs ?? 5}
          showPreview={false}
          onStatusChange={onStatus}
        />
      </Suspense>
    </div>
  )
}

/** Copied from the old LiquidFocus.tsx: a short descending tone after focus, ascending after a break. */
function playPhaseSound(phase: string): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'

    if (phase === 'work') {
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3)
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3)
    }

    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => ctx.close()
  } catch {
    // Audio API may not be available
  }
}
