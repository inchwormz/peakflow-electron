/**
 * Dictation's pill: a small bar at the bottom of the screen while a hold key
 * is down. It records the microphone (opened only while recording, so the
 * Mac's mic indicator is off the rest of the time), shows the level, and
 * hands the audio to main on release. It never takes focus.
 */

import { useEffect, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationState } from '@shared/launcher/types'
import { invoke } from '../panel/hooks'

const BARS = 5

export function DictationPill(): React.JSX.Element {
  const [st, setSt] = useState<DictationState>({ phase: 'idle' })
  const [level, setLevel] = useState(0)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; chunks: Blob[] } | null>(null)
  const startId = useRef(0)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    void invoke(IPC_INVOKE.DICTATION_READY)

    const release = (): void => {
      const r = rec.current
      if (!r) return
      cancelAnimationFrame(r.raf)
      r.stream.getTracks().forEach((t) => t.stop())
      void r.ctx.close().catch(() => {})
      rec.current = null
      setLevel(0)
    }

    const start = async (): Promise<void> => {
      const id = ++startId.current
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (err) {
        const name = (err as DOMException).name
        void invoke(IPC_INVOKE.DICTATION_MIC_ERROR, name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'none' : 'failed')
        return
      }
      // Let go before the mic opened
      if (id !== startId.current) return stream.getTracks().forEach((t) => t.stop())
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = (): void => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += (v - 128) ** 2
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40))
        if (rec.current) rec.current.raf = requestAnimationFrame(tick)
      }
      rec.current = { mr, stream, ctx, raf: requestAnimationFrame(tick), chunks }
      mr.start(250)
    }

    const stop = (send: boolean): void => {
      startId.current++
      const r = rec.current
      if (!r) {
        // Mic never opened (very short hold or no permission): nothing to send
        if (send) void invoke(IPC_INVOKE.DICTATION_AUDIO, new ArrayBuffer(0), 'audio/webm')
        return
      }
      r.mr.onstop = () => {
        const type = r.mr.mimeType || 'audio/webm'
        release()
        if (!send) return
        void new Blob(r.chunks, { type }).arrayBuffer().then((ab) => invoke(IPC_INVOKE.DICTATION_AUDIO, ab, type))
      }
      r.mr.stop()
    }

    const offStart = window.peakflow.on(IPC_SEND.DICTATION_START, () => void start())
    const offStop = window.peakflow.on(IPC_SEND.DICTATION_STOP, (raw) => stop(!!(raw as { send?: boolean } | undefined)?.send))
    const offState = window.peakflow.on(IPC_SEND.DICTATION_STATE, (raw) => setSt(raw as DictationState))
    return () => {
      offStart()
      offStop()
      offState()
      release()
    }
  }, [])

  const label = st.phase === 'listening' ? 'Listening' : st.phase === 'transcribing' ? 'Typing…' : st.phase === 'error' ? st.message ?? 'Something went wrong' : st.phase === 'done' ? 'Done' : ''
  return (
    <div style={S.wrap}>
      <div style={{ ...S.pill, ...(st.phase === 'error' ? S.err : null) }} role="status" aria-live="polite">
        {st.phase === 'listening' ? (
          <span style={S.bars} aria-hidden>
            {Array.from({ length: BARS }, (_, i) => {
              const shape = 1 - Math.abs(i - (BARS - 1) / 2) / BARS
              return <i key={i} style={{ ...S.bar, height: 4 + Math.round(16 * Math.max(0.08, level * shape)) }} />
            })}
          </span>
        ) : st.phase === 'transcribing' ? (
          <span style={S.spin} aria-hidden />
        ) : null}
        <span style={S.text}>{label}</span>
      </div>
      <style>{'@keyframes pfspin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', userSelect: 'none' },
  pill: {
    display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 16px', borderRadius: 18, maxWidth: 'calc(100vw - 8px)',
    background: 'rgba(18,18,18,0.94)', border: '0.5px solid rgba(255,255,255,0.14)', color: '#f2f2f2',
    font: '500 13px/1 -apple-system, "Segoe UI", system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,0.35)'
  },
  err: { background: 'rgba(48,20,20,0.95)' },
  bars: { display: 'flex', alignItems: 'center', gap: 3, height: 20 },
  bar: { display: 'block', width: 3, borderRadius: 2, background: '#ff5a4f', transition: 'height 60ms linear' },
  spin: { width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#f2f2f2', animation: 'pfspin 0.8s linear infinite' },
  text: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
}
