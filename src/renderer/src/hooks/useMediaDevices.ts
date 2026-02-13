/**
 * useMediaDevices — Custom hook for camera/mic device enumeration and stream management.
 *
 * Uses the Web MediaDevices API (navigator.mediaDevices):
 *   - enumerateDevices() → list available cameras and microphones
 *   - getUserMedia()     → acquire camera/mic streams
 *   - devicechange event → react to plugged/unplugged devices
 *
 * Replaces Python's OpenCV camera capture + PyAudio + pygrabber device enumeration.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MediaDeviceInfo {
  deviceId: string
  label: string
  kind: 'videoinput' | 'audioinput'
}

export interface UseMediaDevicesReturn {
  /** Available video input devices */
  cameras: MediaDeviceInfo[]
  /** Available audio input devices */
  microphones: MediaDeviceInfo[]
  /** Active camera MediaStream (null if not started) */
  videoStream: MediaStream | null
  /** Active microphone MediaStream (null if not started) */
  audioStream: MediaStream | null
  /** Start the camera stream for a given deviceId (empty = default) */
  startCamera: (deviceId?: string) => Promise<void>
  /** Stop the camera stream */
  stopCamera: () => void
  /** Start the microphone stream for a given deviceId (empty = default) */
  startMic: (deviceId?: string) => Promise<void>
  /** Stop the microphone stream */
  stopMic: () => void
  /** Whether camera permission has been granted */
  cameraPermission: PermissionState
  /** Whether mic permission has been granted */
  micPermission: PermissionState
  /** Error message if device access fails */
  error: string | null
  /** Re-enumerate devices */
  refreshDevices: () => Promise<void>
}

type PermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useMediaDevices(): UseMediaDevicesReturn {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('unknown')
  const [micPermission, setMicPermission] = useState<PermissionState>('unknown')
  const [error, setError] = useState<string | null>(null)

  const videoStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)

  // ─── Device enumeration ─────────────────────────────────────────────────

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()

      const videoDevices: MediaDeviceInfo[] = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
          kind: 'videoinput' as const
        }))

      const audioDevices: MediaDeviceInfo[] = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
          kind: 'audioinput' as const
        }))

      setCameras(videoDevices)
      setMicrophones(audioDevices)
    } catch (err) {
      console.error('[useMediaDevices] enumerateDevices failed:', err)
      setError('Failed to enumerate devices')
    }
  }, [])

  // ─── Camera stream ──────────────────────────────────────────────────────

  const startCamera = useCallback(async (deviceId?: string) => {
    // Stop any existing stream first
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop())
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      videoStreamRef.current = stream
      setVideoStream(stream)
      setCameraPermission('granted')
      setError(null)

      // Re-enumerate after getting permission (labels become available)
      await enumerateDevices()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setCameraPermission('denied')
        setError('Camera access denied')
      } else {
        setError(`Camera error: ${message}`)
      }
      console.error('[useMediaDevices] startCamera failed:', err)
    }
  }, [enumerateDevices])

  const stopCamera = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop())
      videoStreamRef.current = null
      setVideoStream(null)
    }
  }, [])

  // ─── Microphone stream ──────────────────────────────────────────────────

  const startMic = useCallback(async (deviceId?: string) => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop())
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? { deviceId: { exact: deviceId } }
          : true
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      audioStreamRef.current = stream
      setAudioStream(stream)
      setMicPermission('granted')
      setError(null)

      // Re-enumerate after getting permission
      await enumerateDevices()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setMicPermission('denied')
        setError('Microphone access denied')
      } else {
        setError(`Microphone error: ${message}`)
      }
      console.error('[useMediaDevices] startMic failed:', err)
    }
  }, [enumerateDevices])

  const stopMic = useCallback(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop())
      audioStreamRef.current = null
      setAudioStream(null)
    }
  }, [])

  // ─── Device change listener ─────────────────────────────────────────────

  useEffect(() => {
    enumerateDevices()

    const handler = (): void => {
      enumerateDevices()
    }

    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler)
    }
  }, [enumerateDevices])

  // ─── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  return {
    cameras,
    microphones,
    videoStream,
    audioStream,
    startCamera,
    stopCamera,
    startMic,
    stopMic,
    cameraPermission,
    micPermission,
    error,
    refreshDevices: enumerateDevices
  }
}
