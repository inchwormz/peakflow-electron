/** Development-only own-key live transcription. One socket and one committed turn per hold. */
import WebSocket from 'ws'
import type { TranscribeResult } from './transcribe'

export const REALTIME_MODEL = 'gpt-live-transcribe'
const ENDPOINT = 'wss://api.openai.com/v1/realtime?intent=transcription'
const BYTES_PER_SECOND = 24_000 * 2

/** Never turns on the paid path or a packaged build. */
export function realtimeEnabled(isPackaged: boolean, ownKey: boolean, flag = process.env.PEAKFLOW_DICTATION_REALTIME): boolean {
  return !isPackaged && ownKey && flag === '1'
}

export interface RealtimeSocket {
  readyState: number
  bufferedAmount: number
  on(event: string, listener: (...args: any[]) => void): unknown
  send(data: string): void
  close(): void
  terminate(): void
}
export interface RealtimeTranscription {
  /** PCM16 little-endian, mono, 24 kHz. Buffers during connection setup. */
  append(audio: Uint8Array): void
  /** Call after the final audio callback. Resolves only authoritative final text. */
  finish(): Promise<TranscribeResult>
  abort(): void
}

export function createRealtimeTranscription(opts: {
  key: string | null
  prompt?: string
  language?: string
  onDelta?: (text: string) => void
  timeoutMs?: number
  maxBytes?: number
  socketFactory?: (url: string, key: string) => RealtimeSocket
}): RealtimeTranscription {
  let socket: RealtimeSocket | undefined
  let ready = false
  let released = false
  let settled = false
  let committed = false
  let committedItem: string | undefined
  let total = 0
  let queue: Buffer[] = []
  const completions = new Map<string, string>()
  const maxBytes = opts.maxBytes ?? BYTES_PER_SECOND * 300
  let resolve!: (result: TranscribeResult) => void
  const result = new Promise<TranscribeResult>(r => { resolve = r })
  let timer: ReturnType<typeof setTimeout> | undefined

  function settle(value: TranscribeResult): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    queue = []
    completions.clear()
    // A connecting ws must be terminated; close() otherwise waits for the handshake.
    try { if (socket?.readyState === 1) socket.close(); else socket?.terminate() } catch { /* already closed */ }
    resolve(value)
  }
  function fail(error: 'network' | 'failed' | 'bad_key' | 'model_unavailable', detail: string): void {
    settle({ ok: false, error, detail })
  }
  function send(event: object): boolean {
    if (settled) return false
    try { socket!.send(JSON.stringify(event)); return true } catch { fail('network', 'Realtime send failed'); return false }
  }
  function complete(): void {
    if (!committedItem || !completions.has(committedItem)) return
    const text = completions.get(committedItem)!.trim()
    settle(text ? { ok: true, text } : { ok: false, error: 'no_speech' })
  }
  function flush(): void {
    if (!ready || settled) return
    const pending = queue
    queue = []
    for (const chunk of pending) {
      if (!send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') })) return
    }
    if (released && !committed) {
      committed = true
      send({ type: 'input_audio_buffer.commit' })
    }
  }

  if (!opts.key) settle({ ok: false, error: 'no_key' })
  else {
    try {
      socket = opts.socketFactory
        ? opts.socketFactory(ENDPOINT, opts.key)
        : new WebSocket(ENDPOINT, { headers: { Authorization: `Bearer ${opts.key}` }, handshakeTimeout: 10_000, maxPayload: 1024 * 1024 })
      timer = setTimeout(() => fail('network', 'Realtime session timed out'), opts.timeoutMs ?? 330_000)
      socket.on('open', () => {
        if (settled) return
        send({ type: 'session.update', session: { type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          transcription: { model: REALTIME_MODEL, delay: 'low', ...(opts.prompt ? { prompt: opts.prompt } : {}), ...(opts.language ? { languages: [opts.language] } : {}) },
          turn_detection: null
        } } } })
      })
      socket.on('message', (data: { toString(): string }) => {
        if (settled) return
        let event: { type?: string; item_id?: string; transcript?: string; delta?: string; error?: { code?: string } }
        try { event = JSON.parse(data.toString()) } catch { fail('failed', 'Invalid realtime response'); return }
        if (event.type === 'session.updated') { ready = true; flush() }
        else if (event.type === 'input_audio_buffer.committed' && committed && event.item_id) {
          committedItem = event.item_id
          complete()
        } else if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') {
          // Partial text is display-only; it is never pasted as a successful result.
          opts.onDelta?.(event.delta)
        } else if (event.type === 'conversation.item.input_audio_transcription.completed' && committed && event.item_id && typeof event.transcript === 'string') {
          if (completions.size > 8) { fail('failed', 'Unexpected realtime turn count'); return }
          completions.set(event.item_id, event.transcript)
          complete()
        } else if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
          const code = event.error?.code
          const kind = code === 'invalid_api_key' ? 'bad_key' : code === 'model_not_found' ? 'model_unavailable' : 'failed'
          fail(kind, 'Realtime transcription failed')
        }
      })
      socket.on('unexpected-response', (_request: unknown, response: { statusCode?: number; resume?: () => void }) => {
        response.resume?.()
        fail(response.statusCode === 401 || response.statusCode === 403 ? 'bad_key' : 'network', 'Realtime connection rejected')
      })
      socket.on('error', () => fail('network', 'Realtime connection failed'))
      socket.on('close', () => { if (!settled) fail('network', 'Realtime connection closed before final transcript') })
    } catch { fail('network', 'Realtime connection failed') }
  }

  return {
    append(audio) {
      if (settled || released || !audio.byteLength) return
      if (audio.byteLength % 2 || total + audio.byteLength > maxBytes || (socket?.bufferedAmount ?? 0) > BYTES_PER_SECOND * 10) {
        fail('failed', 'Realtime audio limit exceeded'); return
      }
      total += audio.byteLength
      queue.push(Buffer.from(audio))
      flush()
    },
    finish() {
      if (!released && !settled) {
        released = true
        if (total < BYTES_PER_SECOND / 10) settle({ ok: false, error: 'no_speech' })
        else {
          clearTimeout(timer)
          timer = setTimeout(() => fail('network', 'Realtime final transcript timed out'), opts.timeoutMs ?? 30_000)
          flush()
        }
      }
      return result
    },
    abort() { settle({ ok: false, error: 'failed', detail: 'Realtime transcription cancelled' }) }
  }
}
