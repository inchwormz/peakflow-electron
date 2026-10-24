import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const messages: any[] = []
let Processor: any
class BaseProcessor {
  port = { postMessage: (message: any) => messages.push(message), onmessage: null as any }
}
vm.runInNewContext(readFileSync(new URL('../../src/renderer/public/dictation-capture-worklet.js', import.meta.url), 'utf8'), {
  AudioWorkletProcessor: BaseProcessor,
  registerProcessor: (_: string, ctor: any) => { Processor = ctor },
  sampleRate: 24000, Date, Int16Array, Math
})
const capture = new Processor()
capture.process([[new Float32Array([0.5, -0.5, 1, -1])]])
assert.equal(messages[0].firstSampleAt > 0, true, 'first sample timing is emitted before waiting for a chunk')
assert.equal(messages.length, 1, 'short input is buffered, not discarded')
capture.port.onmessage({ data: { flush: true } })
assert.deepEqual(Array.from(new Int16Array(messages[1].pcm)), [16384, -16384, 32767, -32768], 'flush includes the very first input samples and clips PCM16 safely')
assert.equal(messages[2].drained, true, 'drained follows all PCM messages')
capture.process([[new Float32Array(2400).fill(0.25)]])
assert.equal(messages.length, 3, 'no chunks appear after flush')
console.log('dictation-capture: first sample timing, PCM buffering and ordered final flush passed')

// Exercise the actual pill effect with fake devices: no microphone is opened.
const { transformSync } = await import('esbuild')
const pill = readFileSync(new URL('../../src/renderer/src/launcher/DictationPill.tsx', import.meta.url), 'utf8')
const effect = pill.slice(pill.indexOf('    document.documentElement.style.background'), pill.indexOf('  }, [])'))
const js = transformSync(effect, { loader: 'ts' }).code
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const boot = (moduleReady: Promise<void> = Promise.resolve(), failure?: 'constructor' | 'start') => {
  const listeners = new Map<string, (raw?: unknown) => void>()
  const calls: unknown[][] = []
  const opens: Array<{ resolve: (stream: any) => void; reject: (error: unknown) => void }> = []
  const tracks: Array<{ stopped: boolean; stop: () => void }> = []
  const recorders: any[] = []
  const worklets: any[] = []
  class Context {
    audioWorklet = { addModule: () => moduleReady }
    destination = {}
    suspend = async () => {}
    resume = async () => {}
    close = async () => {}
    createAnalyser = () => ({ fftSize: 0, disconnect: () => {} })
    createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} })
  }
  class Recorder {
    static isTypeSupported() { return true }
    state = 'inactive'
    mimeType = 'audio/webm'
    onstop?: () => void
    ondataavailable?: (event: any) => void
    constructor() { if (failure === 'constructor') throw Error('recorder construction failed'); recorders.push(this) }
    start() { if (failure === 'start') throw Error('recorder start failed'); this.state = 'recording' }
    stop() { this.state = 'inactive' } // deliberately do not deliver onstop yet
  }
  class Worklet {
    port = { onmessage: null as any, postMessage: () => { queueMicrotask(() => this.port.onmessage?.({ data: { drained: true } })) } }
    constructor() { worklets.push(this) }
    connect() {}
    disconnect() {}
  }
  const ipc = Object.fromEntries(['DICTATION_READY', 'DICTATION_MIC_ERROR', 'DICTATION_AUDIO', 'DICTATION_PCM', 'DICTATION_START', 'DICTATION_STOP', 'DICTATION_STATE'].map((name) => [name, name]))
  const cleanup = new Function('document', 'navigator', 'AudioContext', 'MediaRecorder', 'AudioWorkletNode', 'captureWorkletUrl', 'invoke', 'IPC_INVOKE', 'IPC_SEND', 'window', 'rec', 'ctxRef', 'startId', 'phase', 'phaseAt', 'setSt', js)(
    { documentElement: { style: {} }, body: { style: {} } },
    { mediaDevices: { enumerateDevices: async () => [], getUserMedia: () => new Promise((resolve, reject) => opens.push({ resolve, reject })) } },
    Context, Recorder, Worklet, 'processor-url', async (...args: unknown[]) => calls.push(args), ipc, ipc,
    { peakflow: { on: (event: string, callback: (raw: unknown) => void) => { listeners.set(event, callback); return () => listeners.delete(event) } } },
    { current: null }, { current: null }, { current: 0 }, { current: 'idle' }, { current: 0 }, () => {}
  )
  const resolveOpen = (index: number) => {
    const track = { stopped: false, stop() { this.stopped = true } }
    tracks.push(track)
    opens[index].resolve({ getTracks: () => [track] })
    return track
  }
  return { listeners, calls, opens, tracks, recorders, worklets, cleanup, resolveOpen }
}
{
  const r = boot()
  assert.equal(r.opens.length, 0, 'prewarming never requests the microphone')
  r.listeners.get('DICTATION_START')!({ at: 100, sessionId: 1 })
  assert.equal(r.opens.length, 1, 'START asks for the microphone immediately')
  r.listeners.get('DICTATION_STOP')!({ send: false, sessionId: 1 })
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(track.stopped, true, 'release before getUserMedia resolves still closes every track')
  assert.equal(r.recorders.length, 0, 'late acquisition never starts a recorder')
  r.cleanup()
}
{
  const r = boot()
  r.listeners.get('DICTATION_START')!({ at: 100, realtime: true, sessionId: 2 })
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(r.recorders[0].state, 'recording')
  assert.equal(r.calls.some(([channel]) => channel === 'DICTATION_READY' && r.calls.length > 1), false, 'device open alone is not first-sample timing')
  const pcm = new ArrayBuffer(2)
  r.worklets[0].port.onmessage({ data: { firstSampleAt: 142, pcm } })
  await tick()
  assert.deepEqual(r.calls.find(([channel, value]) => channel === 'DICTATION_READY' && value), ['DICTATION_READY', { micMs: 42, sessionId: 2 }])
  r.listeners.get('DICTATION_STOP')!({ send: true, sessionId: 2 })
  assert.equal(track.stopped, true, 'microphone closes before delayed recorder onstop')
  r.recorders[0].onstop()
  await tick()
  assert.equal(r.calls.findIndex(([ch]) => ch === 'DICTATION_PCM') < r.calls.findIndex(([ch]) => ch === 'DICTATION_AUDIO'), true, 'PCM drain precedes complete fallback audio')
  assert.equal(r.calls.find(([ch]) => ch === 'DICTATION_AUDIO')?.[3], 2, 'completed audio keeps its session identity')
  r.cleanup()
}
{
  const r = boot()
  r.listeners.get('DICTATION_START')!({ sessionId: 3 })
  r.cleanup()
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(track.stopped, true, 'unmount invalidates a pending microphone request')
  assert.equal(r.recorders.length, 0)
}
console.log('dictation-capture: idle prewarm, early release/unmount races, prompt track shutdown and session ordering passed')

{
  let load!: () => void
  const r = boot(new Promise<void>((resolve) => { load = resolve }))
  r.listeners.get('DICTATION_START')!({ realtime: true, sessionId: 4 })
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(r.recorders[0].state, 'recording', 'cold worklet does not postpone preserving microphone audio')
  assert.deepEqual(r.calls.find(([ch, value]) => ch === 'DICTATION_READY' && value), ['DICTATION_READY', { realtimeCapture: false, sessionId: 4 }], 'cold worklet opts into intact upload instead of missing opening words')
  load()
  await tick()
  r.worklets[0].port.onmessage({ data: { pcm: new ArrayBuffer(2) } })
  await tick()
  assert.equal(r.calls.some(([ch]) => ch === 'DICTATION_PCM'), false)
  r.cleanup()
  assert.equal(track.stopped, true)
}
{
  const r = boot()
  r.listeners.get('DICTATION_START')!({ sessionId: 5 })
  r.listeners.get('DICTATION_STOP')!({ send: false, sessionId: 5 })
  r.opens[0].reject({ name: 'NotAllowedError' })
  await tick()
  assert.equal(r.calls.some(([ch]) => ch === 'DICTATION_MIC_ERROR'), false, 'a cancelled pending request cannot replace a later session with an error')
  r.cleanup()
}
console.log('dictation-capture: cold graph preserves full fallback, late permission errors ignored')

for (const failure of ['constructor', 'start'] as const) {
  const r = boot(Promise.resolve(), failure)
  r.listeners.get('DICTATION_START')!({ sessionId: 6 })
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(track.stopped, true, `${failure} failure closes microphone without waiting for STOP`)
  assert.deepEqual(r.calls.find(([ch]) => ch === 'DICTATION_MIC_ERROR'), ['DICTATION_MIC_ERROR', 'failed', 6])
  r.cleanup()
}
{
  const r = boot()
  r.listeners.get('DICTATION_START')!({ sessionId: 7 })
  r.listeners.get('DICTATION_STOP')!({ send: false, sessionId: 6 })
  const track = r.resolveOpen(0)
  await tick()
  assert.equal(track.stopped, false, 'stale STOP cannot cancel a pending newer microphone request')
  r.listeners.get('DICTATION_STOP')!({ send: false, sessionId: 6 })
  assert.equal(track.stopped, false, 'stale STOP cannot close a newer active recording')
  r.cleanup()
  assert.equal(track.stopped, true)
}
console.log('dictation-capture: recorder failures close microphone and stale STOP cannot cancel newer sessions')
