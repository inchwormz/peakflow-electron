/** Protocol checks with a fake socket: no audio device, network or credentials. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRealtimeTranscription, realtimeEnabled } from '../../src/main/dictation/realtime.ts'

class Socket extends EventEmitter {
  sent: any[] = []
  closed = false
  readyState = 0
  bufferedAmount = 0
  send(value: string) { this.sent.push(JSON.parse(value)) }
  close() { this.closed = true }
  terminate() { this.closed = true }
  open() { this.readyState = 1; this.emit('open') }
  event(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))) }
}
const setup = (extra = {}) => {
  const socket = new Socket()
  const stream = createRealtimeTranscription({ key: 'fake-test-key', socketFactory: () => socket, ...extra })
  return { socket, stream }
}
const configured = (socket: Socket) => { socket.open(); socket.event({ type: 'session.updated' }) }
assert.equal(realtimeEnabled(false, true, '1'), true)
assert.equal(realtimeEnabled(true, true, '1'), false)
assert.equal(realtimeEnabled(false, false, '1'), false)
assert.equal(realtimeEnabled(false, true, undefined), false)
{
  const { socket, stream } = setup()
  stream.append(new Uint8Array(4800))
  const done = stream.finish()
  assert.equal(socket.sent.length, 0, 'first samples buffered before handshake')
  socket.open()
  assert.equal(socket.sent.length, 1, 'wait for server configuration acknowledgement')
  assert.equal(socket.sent[0].session.audio.input.transcription.model, 'gpt-live-transcribe')
  assert.equal(socket.sent[0].session.audio.input.turn_detection, null)
  socket.event({ type: 'session.updated' })
  assert.deepEqual(socket.sent.map(e => e.type), ['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit'])
  assert.equal(Buffer.from(socket.sent[1].audio, 'base64').length, 4800)
  socket.event({ type: 'input_audio_buffer.committed', item_id: 'actual' })
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'unrelated', transcript: 'Wrong' })
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'actual', transcript: ' Hello ' })
  assert.deepEqual(await done, { ok: true, text: 'Hello' })
  assert.equal(socket.closed, true)
}
{
  let partial = ''
  const { socket, stream } = setup({ onDelta: (text: string) => { partial += text } })
  configured(socket)
  stream.append(new Uint8Array(4800))
  socket.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'Hello' })
  assert.equal(partial, 'Hello', 'incremental transcript arrives before key release')
  const done = stream.finish()
  socket.event({ type: 'input_audio_buffer.committed', item_id: 'a' })
  socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'Hello world' })
  assert.equal((await done).text, 'Hello world', 'final completion replaces partial text')
}
{
  const { socket, stream } = setup()
  stream.append(new Uint8Array(200))
  assert.equal((await stream.finish()).error, 'no_speech', 'no invalid sub-100ms commit')
  assert.equal(socket.closed, true)
}
for (const error of ['error', 'close']) {
  const { socket, stream } = setup()
  socket.emit(error, new Error('fake-test-key must never escape'))
  const result = await stream.finish()
  assert.equal(result.error, 'network')
  assert.ok(!JSON.stringify(result).includes('fake-test-key'))
}
{
  const { socket, stream } = setup()
  stream.abort()
  configured(socket)
  stream.append(new Uint8Array(4800))
  assert.equal((await stream.finish()).error, 'failed')
  assert.equal(socket.sent.length, 0, 'cancel during connection never sends audio')
}
{
  const { stream } = setup({ timeoutMs: 5 })
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal((await stream.finish()).error, 'network')
}
{
  const { socket, stream } = setup({ maxBytes: 4800 })
  stream.append(new Uint8Array(4800))
  stream.append(new Uint8Array(4800))
  assert.equal((await stream.finish()).error, 'failed')
  assert.equal(socket.closed, true, 'bounded queue, no unbounded audio retention')
}
console.log('dictation-streaming: ok (fake socket; no live API latency measured)')

const { fixturePcm, pcmWav } = await import('../dictation-streaming-benchmark.mts')
const fixture = Buffer.alloc(30 * 48_000)
assert.deepEqual(fixturePcm(pcmWav(fixture)), fixture)
assert.throws(() => fixturePcm(pcmWav(Buffer.alloc(100))), /30 seconds/)
const stereo = pcmWav(fixture); stereo.writeUInt16LE(2, 22)
assert.throws(() => fixturePcm(stereo), /PCM16 mono 24kHz/)
assert.throws(() => fixturePcm(Buffer.from('bad')), /RIFF WAV/)
assert.throws(() => fixturePcm(pcmWav(fixture).subarray(0, 100)), /Truncated/)
