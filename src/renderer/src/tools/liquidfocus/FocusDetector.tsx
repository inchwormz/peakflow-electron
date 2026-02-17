/**
 * FocusDetector — Webcam-based attention detection for LiquidFocus.
 *
 * Uses TensorFlow.js BlazeFace model to detect face presence in real-time.
 * When the user looks away (no face detected) for longer than the configured
 * threshold, it records an interruption via IPC.
 *
 * Privacy: All processing is on-device. Frames are sampled to an OffscreenCanvas
 * and immediately discarded after inference. No video is stored or transmitted.
 *
 * Performance: Runs at ~3 FPS (every 333ms) to minimize CPU/GPU usage.
 * BlazeFace is ~190KB and runs inference in <10ms on most hardware.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as blazeface from '@tensorflow-models/blazeface'
import { IPC_INVOKE } from '@shared/ipc-types'
import { DS } from './LiquidFocus'

// ─── Types ──────────────────────────────────────────────────────────────────

export type FocusStatus = 'loading' | 'focused' | 'away' | 'no-camera' | 'error'

interface FocusDetectorProps {
  /** Whether the timer is in a work session and running */
  active: boolean
  /** Seconds of looking away before counting as an interruption */
  thresholdSecs: number
  /** Called when focus status changes */
  onStatusChange?: (status: FocusStatus) => void
  /** Show the small camera preview pip */
  showPreview?: boolean
}

// ─── Component ──────────────────────────────────────────────────────────────

export function FocusDetector({
  active,
  thresholdSecs,
  onStatusChange,
  showPreview = true
}: FocusDetectorProps): React.JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)
  const modelRef = useRef<blazeface.BlazeFaceModel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const awayStartRef = useRef<number | null>(null)
  const interruptionRecordedRef = useRef(false)
  const thresholdRef = useRef(thresholdSecs)

  const [status, setStatus] = useState<FocusStatus>('loading')
  const [totalInterruptions, setTotalInterruptions] = useState(0)

  // Keep threshold ref in sync without triggering effect re-runs
  useEffect(() => {
    thresholdRef.current = thresholdSecs
  }, [thresholdSecs])

  // ── Update parent when status changes ──────────────────────────────────

  const updateStatus = useCallback(
    (newStatus: FocusStatus) => {
      setStatus(newStatus)
      onStatusChange?.(newStatus)
    },
    [onStatusChange]
  )

  // ── Record an interruption via IPC ─────────────────────────────────────

  const recordInterruption = useCallback(() => {
    window.peakflow
      .invoke(IPC_INVOKE.LIQUIDFOCUS_RECORD_INTERRUPTION)
      .then(() => {
        setTotalInterruptions((prev) => prev + 1)
      })
      .catch((err: unknown) => {
        console.warn('[FocusDetector] Failed to record interruption:', err)
      })
  }, [])

  // ── Initialize camera + model ──────────────────────────────────────────

  useEffect(() => {
    if (!active) {
      // Clean up when not active
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      awayStartRef.current = null
      updateStatus('loading')
      return
    }

    let cancelled = false

    async function init(): Promise<void> {
      try {
        // 1. Load BlazeFace model (reuse cached model if available)
        if (!modelRef.current) {
          await tf.ready()
          if (cancelled) return

          const model = await blazeface.load({ maxFaces: 1 })
          if (cancelled) return
          modelRef.current = model
        }

        // 2. Start camera (small resolution for performance)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 5 } }
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        updateStatus('focused')
        startDetection()
      } catch (err) {
        if (cancelled) return
        const errName = err instanceof Error ? err.name : ''
        if (errName === 'NotAllowedError' || errName === 'NotFoundError') {
          updateStatus('no-camera')
        } else {
          console.error('[FocusDetector] Init error:', err)
          updateStatus('error')
        }
      }
    }

    function startDetection(): void {
      let lastDetectTime = 0
      const DETECT_INTERVAL = 333 // ~3 FPS

      function detect(): void {
        if (cancelled) return
        rafRef.current = requestAnimationFrame(detect)

        const now = performance.now()
        if (now - lastDetectTime < DETECT_INTERVAL) return
        lastDetectTime = now

        const video = videoRef.current
        const model = modelRef.current
        if (!video || !model || video.readyState < 2) return

        // Run inference
        model.estimateFaces(video, false).then((predictions) => {
          if (cancelled) return

          const faceDetected = predictions.length > 0

          if (faceDetected) {
            // User is looking at screen — reset away tracking
            awayStartRef.current = null
            interruptionRecordedRef.current = false
            updateStatus('focused')
          } else {
            // No face detected
            const currentTime = Date.now()
            if (awayStartRef.current === null) {
              awayStartRef.current = currentTime
            }

            const awayDuration = (currentTime - awayStartRef.current) / 1000
            const threshold = thresholdRef.current

            if (awayDuration >= threshold) {
              updateStatus('away')
              // Record interruption once per away episode
              if (!interruptionRecordedRef.current) {
                interruptionRecordedRef.current = true
                recordInterruption()
              }
            }
          }
        }).catch(() => {
          // Inference error — keep running
        })
      }

      detect()
    }

    init()

    return () => {
      cancelled = true
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      awayStartRef.current = null
    }
  }, [active, updateStatus, recordInterruption])

  // ── Don't render anything when not active ──────────────────────────────

  if (!active) return null

  // ── Styles ─────────────────────────────────────────────────────────────

  const containerStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 8
  }

  const pipStyle: CSSProperties = {
    width: 40,
    height: 30,
    borderRadius: 6,
    overflow: 'hidden',
    border: `1px solid ${status === 'focused' ? DS.green : status === 'away' ? DS.red : DS.border}`,
    opacity: showPreview && (status === 'focused' || status === 'away') ? 0.9 : 0,
    transition: 'border-color 0.3s, opacity 0.3s',
    position: 'relative'
  }

  const videoStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)' // Mirror
  }

  const dotStyle: CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background:
      status === 'focused'
        ? DS.green
        : status === 'away'
          ? DS.red
          : status === 'loading'
            ? DS.amber
            : DS.textMuted,
    boxShadow:
      status === 'focused'
        ? `0 0 6px ${DS.green}`
        : status === 'away'
          ? `0 0 6px ${DS.red}`
          : 'none',
    transition: 'background 0.3s, box-shadow 0.3s'
  }

  const labelStyle: CSSProperties = {
    fontSize: 10,
    color: DS.textMuted,
    letterSpacing: '0.02em'
  }

  return (
    <div style={containerStyle}>
      <div style={pipStyle}>
        <video
          ref={videoRef}
          style={videoStyle}
          muted
          playsInline
          autoPlay
        />
      </div>
      <div style={dotStyle} />
      <span style={labelStyle}>
        {status === 'loading' && 'Starting...'}
        {status === 'focused' && 'Focused'}
        {status === 'away' && 'Distracted'}
        {status === 'no-camera' && 'No camera'}
        {status === 'error' && 'Error'}
      </span>
      {totalInterruptions > 0 && (
        <span style={{ ...labelStyle, color: DS.red, marginLeft: 4 }}>
          {totalInterruptions} distraction{totalInterruptions !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}
