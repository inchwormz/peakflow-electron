/**
 * CameraPreview — Live video element with canvas-based brightness analysis.
 *
 * Replaces Python's OpenCV camera capture (cv2.VideoCapture) and lighting
 * analysis (cv2.cvtColor → grayscale → np.mean).
 *
 * Web API approach:
 *   - <video> element fed by getUserMedia stream
 *   - OffscreenCanvas / Canvas2D for per-frame brightness sampling
 *   - requestAnimationFrame loop for smooth analysis (~10 FPS sampling)
 *
 * Brightness thresholds (matching Python CameraHandler._analyze_lighting):
 *   - < 0.15 → "Too Dark"   (red)
 *   - < 0.30 → "Low Light"  (yellow)
 *   - < 0.70 → "Good"       (green)
 *   - < 0.85 → "Bright"     (yellow)
 *   - >= 0.85 → "Too Bright" (red)
 */

import { useEffect, useRef, useCallback, type CSSProperties } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

export type LightingStatus = 'Too Dark' | 'Low Light' | 'Good' | 'Bright' | 'Too Bright' | 'Unknown'
export type LightingLevel = 'good' | 'warn' | 'bad' | 'unknown'

export interface BrightnessResult {
  /** Normalized 0-1 brightness value */
  brightness: number
  /** Human-readable status label */
  status: LightingStatus
  /** Severity level for coloring */
  level: LightingLevel
}

interface CameraPreviewProps {
  /** MediaStream from getUserMedia — null means no camera */
  stream: MediaStream | null
  /** Called whenever brightness is re-computed (~10 FPS) */
  onBrightness?: (result: BrightnessResult) => void
  /** CSS className */
  className?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyBrightness(normalized: number): BrightnessResult {
  if (normalized < 0.15) {
    return { brightness: normalized, status: 'Too Dark', level: 'bad' }
  }
  if (normalized < 0.30) {
    return { brightness: normalized, status: 'Low Light', level: 'warn' }
  }
  if (normalized < 0.70) {
    return { brightness: normalized, status: 'Good', level: 'good' }
  }
  if (normalized < 0.85) {
    return { brightness: normalized, status: 'Bright', level: 'warn' }
  }
  return { brightness: normalized, status: 'Too Bright', level: 'bad' }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CameraPreview({
  stream,
  onBrightness,
  className
}: CameraPreviewProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const lastSampleRef = useRef<number>(0)
  const onBrightnessRef = useRef(onBrightness)
  onBrightnessRef.current = onBrightness

  // Attach / detach MediaStream to <video> element
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (stream) {
      video.srcObject = stream
      video.play().catch((err) => {
        console.warn('[CameraPreview] autoplay blocked:', err)
      })
    } else {
      video.srcObject = null
    }

    return () => {
      video.srcObject = null
    }
  }, [stream])

  // Brightness analysis loop — samples at ~10 FPS via rAF
  const analyze = useCallback((timestamp: number) => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
      // Throttle to ~10 FPS (100ms)
      if (timestamp - lastSampleRef.current > 100) {
        lastSampleRef.current = timestamp

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          // Use a small sample size for performance
          const sampleW = 64
          const sampleH = 48
          canvas.width = sampleW
          canvas.height = sampleH

          ctx.drawImage(video, 0, 0, sampleW, sampleH)
          const imageData = ctx.getImageData(0, 0, sampleW, sampleH)
          const data = imageData.data

          // Compute mean luminance (grayscale approximation)
          // Using perceptual luminance weights: 0.299*R + 0.587*G + 0.114*B
          let sum = 0
          const pixelCount = data.length / 4
          for (let i = 0; i < data.length; i += 4) {
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          }

          const meanLuminance = sum / pixelCount / 255 // normalize to 0-1
          const result = classifyBrightness(meanLuminance)

          if (onBrightnessRef.current) {
            onBrightnessRef.current(result)
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(analyze)
  }, [])

  useEffect(() => {
    if (stream) {
      rafRef.current = requestAnimationFrame(analyze)
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [stream, analyze])

  return (
    <div style={containerStyle} className={className}>
      {/* Live video — mirror effect via scaleX(-1) */}
      <video
        ref={videoRef}
        style={videoStyle}
        autoPlay
        playsInline
        muted
      />

      {/* Offscreen analysis canvas — hidden */}
      <canvas ref={canvasRef} style={hiddenCanvas} />

      {/* Bottom gradient overlay */}
      <div style={gradientOverlay} />

      {/* Placeholder when no stream */}
      {!stream && (
        <div style={placeholderStyle}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#444"
            strokeWidth="1.2"
            style={{ width: 48, height: 48, marginBottom: 8, opacity: 0.3 }}
          >
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          <span style={{ fontSize: 11, letterSpacing: 1, color: '#333' }}>
            Camera Preview
          </span>
        </div>
      )}

      {/* Live indicator */}
      {stream && (
        <div style={liveIndicator}>
          <div style={liveDot} />
          <span style={liveText}>Live</span>
        </div>
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  width: '100%',
  height: 210,
  background: '#111111',
  borderRadius: 16,
  position: 'relative',
  overflow: 'hidden'
}

const videoStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)' // mirror effect
}

const hiddenCanvas: CSSProperties = {
  position: 'absolute',
  width: 0,
  height: 0,
  opacity: 0,
  pointerEvents: 'none'
}

const gradientOverlay: CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 60,
  background: 'linear-gradient(transparent, rgba(10,10,10,0.8))',
  pointerEvents: 'none'
}

const placeholderStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#333'
}

const liveIndicator: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: '#4ae08a'
}

const liveDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#4ae08a',
  animation: 'meetready-pulse 1.5s infinite'
}

const liveText: CSSProperties = {
  fontFamily: "'Be Vietnam Pro', 'Segoe UI', sans-serif"
}
