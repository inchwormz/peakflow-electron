/**
 * AudioMeter — Real-time microphone level visualization (VU meter).
 *
 * Replaces Python's PyAudio-based AudioMeter class:
 *   - AudioContext + AnalyserNode replaces pyaudio.open() + np.frombuffer()
 *   - getFloatTimeDomainData() replaces stream.read(1024)
 *   - RMS calculation is identical to Python: sqrt(mean(samples^2))
 *
 * Level thresholds (matching Python AudioMeter + update loop):
 *   - level > 0.7  → "Too Loud" (red)
 *   - level > 0.05 → "Active"   (green)
 *   - level <= 0.05 → "Silent"  (gray)
 *
 * The component renders the 6px-tall VU bar from the HTML design spec.
 */

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

export type MicStatus = 'Active' | 'Silent' | 'Too Loud'
export type MicLevel = 'good' | 'warn' | 'bad'

export interface MicResult {
  /** RMS level 0-1 */
  level: number
  /** Peak hold 0-1 */
  peak: number
  /** Human-readable status */
  status: MicStatus
  /** Severity for coloring */
  severity: MicLevel
}

interface AudioMeterProps {
  /** MediaStream from getUserMedia({ audio: true }) — null if no mic */
  stream: MediaStream | null
  /** Called on each analysis frame (~60fps) */
  onLevel?: (result: MicResult) => void
  /** CSS className */
  className?: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AudioMeter({
  stream,
  onLevel,
  className
}: AudioMeterProps): React.JSX.Element {
  const [level, setLevel] = useState(0)
  const [barColor, setBarColor] = useState('#555555')

  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number>(0)
  const peakRef = useRef<number>(0)
  const onLevelRef = useRef(onLevel)
  onLevelRef.current = onLevel

  // ─── Setup / teardown AudioContext + AnalyserNode ───────────────────────

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!stream) {
      cleanup()
      setLevel(0)
      setBarColor('#555555')
      return
    }

    // Create fresh AudioContext for this stream
    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    analyserRef.current = analyser

    const source = audioCtx.createMediaStreamSource(stream)
    sourceRef.current = source
    source.connect(analyser)

    // Float time-domain buffer for RMS calculation
    const dataArray = new Float32Array(analyser.fftSize)

    // ─── Analysis loop ──────────────────────────────────────────────────

    const tick = (): void => {
      analyser.getFloatTimeDomainData(dataArray)

      // Compute RMS (same as Python: sqrt(mean(samples^2)))
      let sumSq = 0
      for (let i = 0; i < dataArray.length; i++) {
        sumSq += dataArray[i] * dataArray[i]
      }
      const rms = Math.sqrt(sumSq / dataArray.length)

      // Normalize: audio samples are -1..1, so RMS of 0.3 is already quite loud.
      // Scale to match Python's normalization (rms / 10000 on int16 range).
      // With float -1..1 range, map RMS 0..0.5 → 0..1 for UI.
      const normalized = Math.min(rms * 2.5, 1.0)

      // Peak hold with decay (matching Python: peak = max(peak * 0.95, level))
      peakRef.current = Math.max(peakRef.current * 0.95, normalized)

      // Classify
      let status: MicStatus
      let severity: MicLevel
      let color: string

      if (normalized > 0.7) {
        status = 'Too Loud'
        severity = 'bad'
        color = '#f05858'
      } else if (normalized > 0.05) {
        status = 'Active'
        severity = 'good'
        color = '#4ae08a'
      } else {
        status = 'Silent'
        severity = 'warn'
        color = '#555555'
      }

      setLevel(normalized)
      setBarColor(color)

      if (onLevelRef.current) {
        onLevelRef.current({
          level: normalized,
          peak: peakRef.current,
          status,
          severity
        })
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return cleanup
  }, [stream, cleanup])

  // ─── Render VU bar (6px tall, matching HTML .mic-bar-wrap) ────────────

  return (
    <div style={wrapStyle} className={className}>
      <div
        style={{
          ...fillStyle,
          width: `${level * 100}%`,
          background: barColor
        }}
      />
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const wrapStyle: CSSProperties = {
  height: 6,
  background: '#1a1a1a',
  borderRadius: 3,
  overflow: 'hidden',
  marginTop: 2,
  width: '100%'
}

const fillStyle: CSSProperties = {
  height: '100%',
  borderRadius: 3,
  transition: 'width 0.08s ease, background 0.15s ease'
}
