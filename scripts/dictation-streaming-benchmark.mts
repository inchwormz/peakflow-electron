/**
 * Opt-in, billable benchmark using an explicitly supplied fixture; never uses a microphone.
 * OPENAI_API_KEY=… node scripts/dictation-streaming-benchmark.mts --run --wav /absolute/fixture.wav
 * Supply a 30s+ PCM16 little-endian mono 24kHz WAV. Logs metrics only; no transcript or key.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { createRealtimeTranscription } from '../src/main/dictation/realtime.ts'
import { transcribe, warmConnection } from '../src/main/dictation/transcribe.ts'

export function fixturePcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a RIFF WAV fixture')
  let pcm: Buffer | undefined
  let validFormat = false
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > wav.length) throw new Error('Truncated WAV fixture')
    const tag = wav.toString('ascii', offset, offset + 4)
    if (tag === 'fmt ') {
      validFormat = size >= 16 && wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 && wav.readUInt32LE(start + 4) === 24_000 && wav.readUInt16LE(start + 14) === 16
    } else if (tag === 'data') pcm = wav.subarray(start, start + size)
    offset = start + size + (size % 2)
  }
  if (!validFormat || !pcm || pcm.length % 2) throw new Error('Fixture must be PCM16 mono 24kHz')
  if (pcm.length < 30 * 48_000) throw new Error('Fixture must contain at least 30 seconds of audio')
  return pcm
}
export function pcmWav(pcm: Buffer): Buffer {
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(24_000, 24); head.writeUInt32LE(48_000, 28); head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fixture = args[args.indexOf('--wav') + 1]
  if (!args.includes('--run') || !args.includes('--wav') || !fixture) {
    console.log('No API calls made. Billable opt-in: --run --wav /path/to/30s-pcm16-mono-24khz.wav and OPENAI_API_KEY in environment.')
    return
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is required for the explicitly requested benchmark')
  const pcm = fixturePcm(await readFile(fixture))
  console.log(JSON.stringify({ kind: 'benchmark', source: 'explicit fixture', repeats: 1, durationsSeconds: [3, 10, 30], liveModel: 'gpt-live-transcribe', uploadModel: 'gpt-transcribe', note: 'Paced PCM replay; excludes microphone and paste; one sample per duration, no percentile claim' }))
  for (const seconds of [3, 10, 30]) {
    const clip = pcm.subarray(0, seconds * 48_000)
    let firstPartialMs: number | null = null
    const started = performance.now()
    const live = createRealtimeTranscription({ key, onDelta: () => { firstPartialMs ??= Math.round(performance.now() - started) } })
    try {
      for (let offset = 0; offset < clip.length; offset += 4800) {
        live.append(clip.subarray(offset, offset + 4800))
        await delay(Math.max(0, started + (offset + 4800) / 48 - performance.now()))
      }
      const released = performance.now()
      const answer = await live.finish()
      console.log(JSON.stringify({ seconds, path: 'realtime', ok: answer.ok, error: answer.error, firstPartialMs, releaseToTextMs: Math.round(performance.now() - released) }))
    } finally { live.abort() }
    // Today's hold path warms REST transport while recording. Give it the same hold time.
    warmConnection(key)
    await delay(seconds * 1000)
    const released = performance.now()
    const answer = await transcribe(pcmWav(clip), { key, model: 'gpt-transcribe', mime: 'audio/wav', stream: true })
    console.log(JSON.stringify({ seconds, path: 'upload_on_release', ok: answer.ok, error: answer.error, releaseToTextMs: Math.round(performance.now() - released) }))
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Benchmark failed. Check explicit WAV fixture, API access and connection. No secret or transcript logged.'); process.exitCode = 1 })
}
