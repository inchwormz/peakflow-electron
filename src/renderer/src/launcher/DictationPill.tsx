/**
 * Dictation's pill: a small bar at the bottom of the screen while a hold key
 * is down. It records the microphone (opened only while recording, so the
 * Mac's mic indicator is off the rest of the time), shows a live waveform,
 * and hands the audio to main on release. It never takes focus.
 *
 * The waveform is one canvas drawn at the display's frame rate:
 *   listening     bars flow right to left, driven by the mic's loudness
 *                 (quick to rise, slow to fall); a soft breathing when quiet
 *   transcribing  the bars settle into a row of dots with a light sweeping across
 *   done          the dots draw a check mark, then the pill fades
 * With reduced motion: no flow, breathing or sweep; the bars just follow the level.
 */

import { useEffect, useRef, useState } from 'react'
import { openMicrophone } from '@shared/dictation-microphone'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationState } from '@shared/launcher/types'
import { invoke } from '../panel/hooks'
// An external same-origin asset: the packaged CSP blocks data: worklet URLs.
const captureWorkletUrl = './dictation-capture-worklet.js'

const BARS = 19
const BAR_W = 2.5
const GAP = 2.5
const CANVAS_W = BARS * BAR_W + (BARS - 1) * GAP
const CANVAS_H = 22

declare global {
  interface Window {
    /** Development only: a level (0–1) to show instead of the microphone's (test recordings) */
    __pfLevel?: number
  }
}

export function DictationPill(): React.JSX.Element {
  const [st, setSt] = useState<DictationState>({ phase: 'idle' })
  const phase = useRef<DictationState['phase']>('idle')
  const phaseAt = useRef(0)
  const level = useRef(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; an?: AnalyserNode; source?: MediaStreamAudioSourceNode; worklet?: AudioWorkletNode; chunks: Blob[]; sessionId?: number } | null>(null)
  const startId = useRef(0)
  // One audio graph for the level meter, kept between dictations (suspended when idle)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    let disposed = false
    let activeSessionId: number | undefined
    // Warm the graph and processor without opening a microphone. In a preloaded
    // hidden pill this work finishes before the first hold-key press.
    const ctx = ctxRef.current ?? (ctxRef.current = new AudioContext({ sampleRate: 24000 }))
    const workletReady = ctx.audioWorklet.addModule(captureWorkletUrl)
    void workletReady.catch(() => {}) // Timing is optional; MediaRecorder preserves the complete clip
    void ctx.suspend().catch(() => {})
    void navigator.mediaDevices.enumerateDevices().catch(() => {})

    type Recording = NonNullable<typeof rec.current>
    const closeGraph = (r: Recording): void => {
      r.source?.disconnect()
      r.worklet?.disconnect()
      r.an?.disconnect()
      if (!rec.current) void ctx.suspend().catch(() => {})
    }
    const release = (r: Recording): void => {
      r.stream.getTracks().forEach((t) => t.stop())
      if (rec.current === r) rec.current = null
    }

    const start = async (opts: { at?: number; processing?: boolean; sessionId?: number; microphone?: string }): Promise<void> => {
      const id = ++startId.current
      activeSessionId = opts.sessionId
      const processing = opts.processing !== false
      let stream: MediaStream
      try {
        // This is the first asynchronous action on START: no network or worklet
        // setup is allowed to postpone asking the device for audio.
        stream = await openMicrophone((constraints) => navigator.mediaDevices.getUserMedia(constraints), opts.microphone ?? '', processing, () => id === startId.current && !disposed)
      } catch (err) {
        if (id !== startId.current || disposed) return
        const name = (err as DOMException).name
        void invoke(IPC_INVOKE.DICTATION_MIC_ERROR, name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'none' : 'failed', opts.sessionId)
        return
      }
      if (id !== startId.current || disposed) return stream.getTracks().forEach((t) => t.stop())
      if (rec.current) {
        const previous = rec.current
        release(previous)
        if (previous.mr.state !== 'inactive') previous.mr.stop()
        closeGraph(previous)
      }
      try {
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
        const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 })
        const r: Recording = { mr, stream, chunks: [], sessionId: opts.sessionId }
        mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data) }
        rec.current = r
        // Buffer audio immediately, before setting up the optional timing graph.
        mr.start(250)
        void ctx.resume().catch(() => {})
        r.an = ctx.createAnalyser()
        r.an.fftSize = 512
        r.source = ctx.createMediaStreamSource(stream)
        r.source.connect(r.an)
        await workletReady
        if (id !== startId.current || disposed || rec.current !== r) return
        const worklet = new AudioWorkletNode(ctx, 'dictation-capture', { channelCount: 1, channelCountMode: 'explicit' })
        r.worklet = worklet
        worklet.port.onmessage = ({ data }: MessageEvent<{ firstSampleAt?: number }>) => {
          if (data.firstSampleAt && opts.at) {
            void invoke(IPC_INVOKE.DICTATION_READY, { micMs: Math.max(0, data.firstSampleAt - opts.at), sessionId: opts.sessionId })
          }
        }
        r.source.connect(worklet)
        // The processor outputs silence, but a destination connection keeps the
        // rendering graph running. Microphone audio is never played back.
        worklet.connect(ctx.destination)
      } catch {
        // A recorder that never started cannot provide a fallback or onstop.
        // Close its device immediately and report the failure to main.
        const failed = rec.current?.stream === stream ? rec.current : null
        if (!failed || failed.mr.state === 'inactive') {
          if (failed) { release(failed); closeGraph(failed) }
          else stream.getTracks().forEach((t) => t.stop())
          if (!disposed && id === startId.current) void invoke(IPC_INVOKE.DICTATION_MIC_ERROR, 'failed', opts.sessionId)
          return
        }
        // Optional timing graph failure leaves the complete recording intact.
        if (!rec.current || rec.current.stream !== stream) stream.getTracks().forEach((t) => t.stop())
      }
    }

    const stop = (send: boolean, sessionId?: number): void => {
      if (sessionId !== undefined && sessionId !== activeSessionId) return
      startId.current++
      activeSessionId = undefined
      const r = rec.current
      if (!r) {
        if (send && !disposed) void invoke(IPC_INVOKE.DICTATION_AUDIO, new ArrayBuffer(0), 'audio/webm', sessionId)
        return
      }
      r.mr.onstop = () => {
        void (async () => {
          closeGraph(r)
          if (!send || disposed) return
          const type = r.mr.mimeType || 'audio/webm'
          const ab = await new Blob(r.chunks, { type }).arrayBuffer()
          if (!disposed) await invoke(IPC_INVOKE.DICTATION_AUDIO, ab, type, r.sessionId)
        })()
      }
      if (r.mr.state !== 'inactive') r.mr.stop()
      // Stop the tracks now, independently of recorder finalization or network.
      release(r)
    }

    const offStart = window.peakflow.on(IPC_SEND.DICTATION_START, (raw) => void start((raw ?? {}) as { at?: number; processing?: boolean; sessionId?: number; microphone?: string }))
    const offStop = window.peakflow.on(IPC_SEND.DICTATION_STOP, (raw) => { const opts = raw as { send?: boolean; sessionId?: number } | undefined; stop(!!opts?.send, opts?.sessionId) })
    const offState = window.peakflow.on(IPC_SEND.DICTATION_STATE, (raw) => {
      const s = raw as DictationState
      if (s.phase !== phase.current) phaseAt.current = performance.now()
      phase.current = s.phase
      setSt(s)
    })
    void invoke(IPC_INVOKE.DICTATION_READY)
    return () => {
      offStart()
      offStop()
      offState()
      disposed = true
      stop(false)
      ctxRef.current = null
      void ctx.close().catch(() => {})
    }
  }, [])

  // ── the waveform ──
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    c.width = Math.round(CANVAS_W * dpr)
    c.height = Math.round(CANVAS_H * dpr)
    g.scale(dpr, dpr)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const history = new Float32Array(BARS)
    const shown = new Float32Array(BARS)
    const buf = new Uint8Array(512)
    let raf = 0
    let last = performance.now()
    let flow = 0

    const readLevel = (): number => {
      if (import.meta.env.DEV && typeof window.__pfLevel === 'number') return window.__pfLevel
      const an = rec.current?.an
      if (!an) return 0
      an.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += (v - 128) ** 2
      // Speech RMS sits around 3–30 on this scale; a gentle curve keeps quiet words visible
      return Math.min(1, Math.pow(Math.sqrt(sum / buf.length) / 28, 0.7))
    }

    const bar = (x: number, h: number, alpha: number): void => {
      const y = (CANVAS_H - h) / 2
      g.globalAlpha = alpha
      g.beginPath()
      g.roundRect(x, y, BAR_W, h, BAR_W / 2)
      g.fill()
    }

    const draw = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const p = phase.current
      const since = (now - phaseAt.current) / 1000
      g.clearRect(0, 0, CANVAS_W, CANVAS_H)
      g.fillStyle = '#f4f4f4'
      g.strokeStyle = '#f4f4f4'

      // Loudness, smoothed: quick to rise, slow to fall
      const target = p === 'listening' ? readLevel() : 0
      const k = target > level.current ? 1 - Math.exp(-dt * 28) : 1 - Math.exp(-dt * 7)
      level.current += (target - level.current) * k

      if (p === 'listening') {
        // A new sample enters on the right about 24 times a second; the rest flow left
        flow += dt * 24
        while (flow >= 1 && !still) {
          flow -= 1
          history.copyWithin(0, 1)
          history[BARS - 1] = level.current
        }
        if (still) history.fill(level.current)
        for (let i = 0; i < BARS; i++) {
          const centre = 1 - Math.pow(Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2), 2) * 0.55
          const breathe = still ? 0 : 0.07 * (0.5 + 0.5 * Math.sin(now / 520 + i * 0.42)) * (1 - Math.min(1, level.current * 4))
          const want = Math.max(0.1, (history[i] * 0.9 + breathe) * centre)
          shown[i] += (want - shown[i]) * (1 - Math.exp(-dt * 18))
          bar(i * (BAR_W + GAP), 3 + shown[i] * (CANVAS_H - 3), 0.55 + 0.45 * Math.min(1, shown[i] * 2.2))
        }
      } else if (p === 'transcribing') {
        // Bars settle into dots, then a soft light sweeps across them
        const settle = Math.min(1, since / 0.22)
        const sweep = still ? -1 : ((now / 1100) % 1) * (BARS + 8) - 4
        for (let i = 0; i < BARS; i++) {
          shown[i] += (0 - shown[i]) * (1 - Math.exp(-dt * 16))
          const h = 3 + shown[i] * (CANVAS_H - 3) * (1 - settle)
          const glow = sweep < 0 ? 0 : Math.max(0, 1 - Math.abs(i - sweep) / 3.2)
          bar(i * (BAR_W + GAP), Math.max(BAR_W, h), 0.28 + 0.72 * glow * glow)
        }
      } else if (p === 'done') {
        // A check mark draws itself where the dots were
        const t = still ? 1 : Math.min(1, since / 0.26)
        const ease = 1 - Math.pow(1 - t, 3)
        const cx = CANVAS_W / 2
        const pts: Array<[number, number]> = [[cx - 7, 11.5], [cx - 2, 16], [cx + 8, 5.5]]
        const len1 = Math.hypot(5, 4.5)
        const len2 = Math.hypot(10, 10.5)
        let d = ease * (len1 + len2)
        g.globalAlpha = 1
        g.lineWidth = 2.2
        g.lineCap = 'round'
        g.lineJoin = 'round'
        g.beginPath()
        g.moveTo(pts[0][0], pts[0][1])
        const seg = (a: [number, number], b: [number, number], l: number): void => {
          const f = Math.min(1, d / l)
          g.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
          d -= l
        }
        seg(pts[0], pts[1], len1)
        if (d > 0) seg(pts[1], pts[2], len2)
        g.stroke()
      }
      g.globalAlpha = 1
      // Keep drawing only while there's something moving
      if (p === 'listening' || p === 'transcribing' || (p === 'done' && since < 0.3)) raf = requestAnimationFrame(draw)
      else raf = 0
    }
    const kick = (): void => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    kick()
    const off = window.peakflow.on(IPC_SEND.DICTATION_STATE, () => setTimeout(kick, 0))
    return () => {
      off()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const error = st.phase === 'error'
  const visible = st.phase !== 'idle'
  return (
    <div style={S.wrap}>
      <div
        style={{ ...S.pill, ...(error ? S.err : null), opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(4px) scale(0.96)' }}
        role="status"
        aria-live="polite"
        aria-label={st.phase === 'listening' ? 'Listening' : st.phase === 'transcribing' ? 'Typing' : st.phase === 'done' ? 'Done' : undefined}
      >
        <canvas ref={canvas} style={{ width: CANVAS_W, height: CANVAS_H, display: error || st.phase === 'cancelled' ? 'none' : 'block' }} aria-hidden />
        {st.phase === 'cancelled' ? <span style={S.text}>Cancelled</span> : null}
        {st.phase === 'listening' && st.message ? <span style={S.text}>{st.message}</span> : null}
        {error && (
          <>
            <span style={S.dot} aria-hidden />
            <span style={S.text}>{st.message ?? 'Something went wrong'}</span>
          </>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', userSelect: 'none' },
  pill: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, height: 34, padding: '0 18px', borderRadius: 17, maxWidth: 'calc(100vw - 8px)',
    background: 'rgba(12,12,12,0.92)', boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.16), 0 8px 24px rgba(0,0,0,0.38)', color: '#f2f2f2',
    font: '500 12.5px/1 -apple-system, "Segoe UI", system-ui, sans-serif', transition: 'opacity 160ms ease, transform 200ms cubic-bezier(.2,.8,.2,1)'
  },
  err: { padding: '0 14px' },
  dot: { width: 6, height: 6, borderRadius: 3, background: '#f2f2f2', opacity: 0.7, flex: 'none' },
  text: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
}
