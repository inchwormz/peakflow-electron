/**
 * Camera rules for Liquid Focus focus detection, kept pure so
 * scripts/checks/camera-stop.check.mts can test them.
 */

interface TimerLike {
  mode: string
  status: string
}

/** The camera runs only while detection is on and a work session is actually running. */
export function detectorShouldRun(detectionEnabled: boolean, timer: TimerLike | null | undefined): boolean {
  return detectionEnabled && timer?.mode === 'work' && timer?.status === 'running'
}

/** Stop every track (the camera light goes off). Returns null for `ref.current = stopStream(ref.current)`. */
export function stopStream(stream: { getTracks(): Array<{ stop(): void }> } | null | undefined): null {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* already stopped */
    }
  })
  return null
}
