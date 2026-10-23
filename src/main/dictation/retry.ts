/**
 * Not losing what was said (review finding S11, 24 Oct 2026): when a clip
 * can't be turned into text, its audio is kept so the person can try again
 * from the Dictation page or the launcher, and long clips get a longer limit.
 * No Electron imports, so it can be checked from Node.
 */

import type { TranscribeError } from './transcribe'

/** How long a kept clip can be tried again (the same 30 minutes as "Paste last dictation") */
export const KEEP_CLIP_MS = 30 * 60_000

/**
 * The time allowed for upload, transcription and streaming the text back:
 * 30 s plus half the clip's length (a 5-minute clip gets 3 minutes), at most 5 minutes.
 * The old fixed 30 s cut off long clips on a slow connection.
 */
export function transcribeTimeoutMs(durationMs: number, base = 30_000): number {
  const d = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  return Math.min(5 * 60_000, Math.max(base, 30_000 + Math.round(d / 2)))
}

/** Keep the audio unless there was nothing in it to try again. */
export function keepsClip(error: TranscribeError | 'mic_denied' | 'mic_none' | undefined): boolean {
  return error !== 'no_speech' && error !== 'mic_denied' && error !== 'mic_none'
}

/** Short failures (no connection, a server hiccup) say where to try again; the others already name their fix. */
export function sayTryAgain(error: TranscribeError | 'mic_denied' | 'mic_none' | undefined): boolean {
  return error === 'network' || error === 'failed' || error === 'model_unavailable'
}

/** The paste shortcut in the "Copied" message: ⌘V on a Mac, Ctrl+V on Windows. */
export function pasteKeys(mac: boolean): string {
  return mac ? '⌘V' : 'Ctrl+V'
}
