/**
 * OpenAI speech-to-text for dictation: the person's own API key, audio in,
 * text out. No Electron imports, so it can be checked from Node with a
 * sample file. The key is only ever sent to api.openai.com; never logged.
 */

export type DictationModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe'

export type TranscribeError = 'no_key' | 'bad_key' | 'network' | 'no_speech' | 'failed'

export interface TranscribeResult {
  ok: boolean
  text?: string
  error?: TranscribeError
  /** OpenAI's own message, for the log (never contains the key) */
  detail?: string
}

const API = 'https://api.openai.com/v1'

export async function transcribe(
  audio: Uint8Array,
  opts: { key: string | null; model?: DictationModel; mime?: string; language?: string; prompt?: string; timeoutMs?: number }
): Promise<TranscribeResult> {
  if (!opts.key) return { ok: false, error: 'no_key' }
  if (audio.byteLength < 1000) return { ok: false, error: 'no_speech' }
  const mime = opts.mime ?? 'audio/webm'
  const ext = mime.includes('wav') ? 'wav' : mime.includes('aiff') ? 'aiff' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mime }), `dictation.${ext}`)
  form.append('model', opts.model ?? 'gpt-4o-mini-transcribe')
  form.append('response_format', 'json')
  if (opts.language) form.append('language', opts.language)
  if (opts.prompt) form.append('prompt', opts.prompt)
  let res: Response
  try {
    res = await fetch(`${API}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.key}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000)
    })
  } catch (err) {
    return { ok: false, error: 'network', detail: (err as Error).name }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'bad_key', detail: `HTTP ${res.status}` }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: 'failed', detail: `HTTP ${res.status} ${body.slice(0, 200)}` }
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string }
  const text = (body.text ?? '').trim()
  return text ? { ok: true, text } : { ok: false, error: 'no_speech' }
}

/** One tiny call to check a key works (lists the transcription model). */
export async function checkKey(key: string): Promise<'ok' | 'bad_key' | 'network' | 'failed'> {
  try {
    const res = await fetch(`${API}/models/gpt-4o-mini-transcribe`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
    if (res.ok) return 'ok'
    return res.status === 401 || res.status === 403 ? 'bad_key' : 'failed'
  } catch {
    return 'network'
  }
}
