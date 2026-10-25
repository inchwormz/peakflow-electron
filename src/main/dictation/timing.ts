export type ConnectionWarmup = 'not-requested' | 'pending' | 'complete' | 'failed' | 'unknown'

export interface ClipTiming {
  clipId: number
  platform: string
  retry: boolean
  warmup: ConnectionWarmup
  releaseAt: number
  releaseToAudioReadyMs: number | null
  durationMs: number
  bytes: number
  attempts: Array<{ provider: 'own-key' | 'add-on'; model: string; ms: number; outcome: string }>
  tidy: string
  tidyMs: number
  tidyProvider?: string
  tidyModel?: string
  pasteStartMs?: number
  pasteCompleteMs?: number
  pasteSuccess?: boolean
}

export function clipTiming(clipId: number, releaseAt: number, audioReadyAt: number | undefined, durationMs: number, bytes: number, warmup: ConnectionWarmup = 'unknown'): ClipTiming {
  return {
    clipId, platform: process.platform, warmup, retry: audioReadyAt === undefined, releaseAt,
    releaseToAudioReadyMs: audioReadyAt === undefined ? null : Math.max(0, audioReadyAt - releaseAt),
    durationMs, bytes, attempts: [], tidy: 'off', tidyMs: 0
  }
}

/** Fixed metadata only: no app context, model responses, or replacement text. */
export function logTiming(t: ClipTiming): void {
  console.log('[DictationTiming]', JSON.stringify(t))
}
