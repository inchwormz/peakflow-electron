/**
 * AlertOverlay: the full-screen meeting alert.
 *
 * Rendered in a fullscreen BrowserWindow (SystemWindowId.ScreenSlapAlert),
 * one per display the alert is shown on. v2 look (approved round 5, John
 * 19 Oct: "just black and white takes over the full screen"): solid black,
 * a grey "3:32 PM · in 2 minutes" line, a large title (two lines at most),
 * one white Join button with the real meeting-app icon (only with a link),
 * text buttons Snooze 5 min / Snooze 10 min / Dismiss, and "Press any key to
 * dismiss". Under a minute the countdown turns white: "Starting now". With
 * no link, Dismiss is the white button. If another meeting starts at the
 * same time it shows "Also at …" with its own Join.
 *
 * Behaviour kept from the previous overlay:
 *   - alert data arrives on screenslap:alert-data, or is pulled from
 *     screenslap:get-state if the push came before React mounted
 *   - fade in on arrival, fade out before snooze/dismiss/join
 *   - the three-note chime (now only when "Play a sound" is on, once per alert)
 *   - any key dismisses; the countdown ticks every second
 *   - snooze/dismiss/join go through screenslap:snooze/dismiss/join-meeting
 *   - auto-dismiss after "Alert closes after" is done by the main process
 */

import { useEffect, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import type { ScreenSlapConfig } from '@shared/config-schemas'
import { AppIcon } from '../../panel/kit'
import { appName, fmtGapLong, fmtTime, type AlertInfo, type CalendarEvent } from '../../panel/tools/screenslap/format'
import './AlertOverlay.css'

const api = window.peakflow

/** Ascending C5–E5–G5 chime, synthesised so it works on every platform. */
function playChime(): void {
  try {
    const audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(523, audioCtx.currentTime)
    osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.15)
    osc.frequency.setValueAtTime(784, audioCtx.currentTime + 0.3)
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5)
    osc.start(audioCtx.currentTime)
    osc.stop(audioCtx.currentTime + 0.5)
    osc.onended = () => audioCtx.close()
  } catch {
    // Sound not critical
  }
}

export function AlertOverlay(): React.JSX.Element {
  const [alert, setAlert] = useState<AlertInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [also, setAlso] = useState<CalendarEvent | null>(null)
  const [, tick] = useState(0)
  const chimed = useRef<string | null>(null)
  const dismissedRef = useRef(false)

  // ─── Receive alert data from main ───────────────────────────────────────
  useEffect(() => {
    const unsub = api.on(IPC_SEND.SCREENSLAP_ALERT_DATA, (data: unknown) => {
      if (data) setAlert(data as AlertInfo)
    })
    // The push may have arrived before React mounted and registered the listener
    api
      .invoke(IPC_INVOKE.SCREENSLAP_GET_STATE)
      .then((state: unknown) => {
        const s = state as { activeAlert: AlertInfo | null } | null
        if (s?.activeAlert) setAlert((prev) => prev ?? s.activeAlert)
      })
      .catch(() => {})
    return unsub
  }, [])

  // ─── Chime once per alert, when "Play a sound" is on ────────────────────
  useEffect(() => {
    if (!alert || chimed.current === alert.eventId) return
    chimed.current = alert.eventId
    api
      .invoke(IPC_INVOKE.CONFIG_GET, { tool: ToolId.ScreenSlap })
      .then((c: unknown) => {
        if ((c as ScreenSlapConfig | null)?.alert_sound !== false) playChime()
      })
      .catch(() => playChime())
  }, [alert])

  // ─── Another meeting starting at the same minute ────────────────────────
  const alertId = alert?.eventId
  const alertStart = alert?.startTime
  useEffect(() => {
    if (!alertId || !alertStart) return
    const start = Math.floor(new Date(alertStart).getTime() / 60_000)
    api
      .invoke(IPC_INVOKE.CALENDAR_GET_EVENTS)
      .then((list: unknown) => {
        const other = ((list as CalendarEvent[] | null) ?? []).find(
          (e) => !e.allDay && e.id !== alertId && Math.floor(new Date(e.startTime).getTime() / 60_000) === start
        )
        setAlso(other ?? null)
      })
      .catch(() => setAlso(null))
  }, [alertId, alertStart])

  // ─── Countdown tick ─────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // ─── Actions (fade out first, then tell main) ───────────────────────────
  const finish = (then: () => void): void => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    setDismissed(true)
    setTimeout(then, 200)
  }
  const handleDismiss = (): void => finish(() => void api.invoke(IPC_INVOKE.SCREENSLAP_DISMISS).catch(() => {}))
  const handleSnooze = (minutes: number): void => {
    if (!alert) return
    const id = alert.eventId
    finish(() => void api.invoke(IPC_INVOKE.SCREENSLAP_SNOOZE, id, minutes).catch(() => {}))
  }
  const handleJoin = (link: string | null): void => {
    if (!link || dismissedRef.current) return
    // Open straight away; main closes the alert windows after opening the link
    api.invoke(IPC_INVOKE.SCREENSLAP_JOIN_MEETING, link).catch(() => {})
    finish(() => {})
  }

  // ─── Any key dismisses ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (): void => handleDismiss()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!alert) return <div className="ssa" />

  const diff = new Date(alert.startTime).getTime() - Date.now()
  const urgent = diff < 60_000
  const when = diff <= -60_000 ? `Started ${fmtGapLong(-diff)} ago` : urgent ? 'Starting now' : `in ${fmtGapLong(diff)}`
  const name = appName(alert.meetingService)
  const hasLink = !!alert.meetingLink

  return (
    <div className={`ssa in${urgent ? ' urgent' : ''}${dismissed ? ' out' : ''}`} role="alertdialog" aria-label={alert.summary}>
      <div className="wrap">
        <div className="when">
          <span>{alert.timeFormatted}</span>
          <span className="dot">·</span>
          <b>{when}</b>
        </div>
        <h1 title={alert.summary}>{alert.summary}</h1>
        <div className="acts">
          {hasLink ? (
            <button className="big" onClick={() => handleJoin(alert.meetingLink)}>
              <AppIcon q={{ url: alert.meetingLink ?? undefined }} size={18} /> Join {name}
            </button>
          ) : (
            <button className="big" onClick={handleDismiss}>
              Dismiss
            </button>
          )}
          <button className="tx" onClick={() => handleSnooze(5)}>
            Snooze 5 min
          </button>
          <button className="tx" onClick={() => handleSnooze(10)}>
            Snooze 10 min
          </button>
          {hasLink ? (
            <button className="tx" onClick={handleDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
        {also ? (
          <div className="also">
            <span className="aw">Also at {fmtTime(also.startTime)}</span>
            <span className="at" title={also.summary}>
              {also.summary}
            </span>
            {also.meetingLink ? (
              <button className="tx" onClick={() => handleJoin(also.meetingLink)}>
                <AppIcon q={{ url: also.meetingLink }} size={14} /> Join {appName(also.meetingService)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="foot">Press any key to dismiss</div>
    </div>
  )
}
