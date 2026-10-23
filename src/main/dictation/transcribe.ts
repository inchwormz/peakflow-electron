/**
 * OpenAI speech-to-text for dictation: the person's own API key, audio in,
 * text out. No Electron imports, so it can be checked from Node with a
 * sample file. The key is only ever sent to api.openai.com; never logged.
 */

/** gpt-transcribe: OpenAI's current speech-to-text model; gpt-4o-mini-transcribe: fallback for keys without it */
export type DictationModel = 'gpt-transcribe' | 'gpt-4o-mini-transcribe'

export type TranscribeError =
  | 'no_key' | 'bad_key' | 'network' | 'no_speech' | 'failed' | 'model_unavailable'
  // The $5 add-on (addon.ts): balance used up, a third computer, 3 hours today, or switched off
  | 'addon_empty' | 'addon_devices' | 'addon_daily' | 'addon_off'

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
  opts: { key: string | null; model?: DictationModel; mime?: string; language?: string; prompt?: string; timeoutMs?: number; stream?: boolean }
): Promise<TranscribeResult> {
  if (!opts.key) return { ok: false, error: 'no_key' }
  if (audio.byteLength < 1000) return { ok: false, error: 'no_speech' }
  const mime = opts.mime ?? 'audio/webm'
  const ext = mime.includes('wav') ? 'wav' : mime.includes('aiff') ? 'aiff' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mime }), `dictation.${ext}`)
  form.append('model', opts.model ?? 'gpt-transcribe')
  form.append('response_format', 'json')
  if (opts.language) form.append('language', opts.language)
  if (opts.prompt) form.append('prompt', opts.prompt)
  // Streamed: the text arrives as it's decoded and we stop reading at the final event
  if (opts.stream) form.append('stream', 'true')
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
    // The key's project can't use this model (older account, or a model that was retired)
    const unavailable = res.status === 404 || (res.status === 400 && /model/i.test(body))
    return { ok: false, error: unavailable ? 'model_unavailable' : 'failed', detail: `HTTP ${res.status} ${body.slice(0, 200)}` }
  }
  const text = opts.stream ? await readStream(res) : (((await res.json().catch(() => ({}))) as { text?: string }).text ?? '').trim()
  return text ? { ok: true, text } : { ok: false, error: 'no_speech' }
}

/** Server-sent events: transcript.text.delta … transcript.text.done {text}. */
async function readStream(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let soFar = ''
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array }
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const ev = JSON.parse(data) as { type?: string; delta?: string; text?: string }
        if (ev.type === 'transcript.text.delta' && ev.delta) soFar += ev.delta
        else if (ev.type === 'transcript.text.done') {
          void reader.cancel().catch(() => {})
          return (ev.text ?? soFar).trim()
        }
      } catch { /* partial event */ }
    }
  }
  return soFar.trim()
}

/**
 * Open the connection to OpenAI while the person is still talking, so the
 * upload on release skips the TLS handshake. A cheap authorised GET; errors ignored.
 */
export function warmConnection(key: string | null): void {
  if (!key) return
  void fetch(`${API}/models/gpt-transcribe`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) })
    .then((r) => r.arrayBuffer())
    .catch(() => {})
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
