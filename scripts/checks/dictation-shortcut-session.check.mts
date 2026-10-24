import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { test } from 'node:test'

const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const code = (start: string, end: string) => transformSync(
  main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start))), { loader: 'ts' }
).code

function boot() {
  return new Function(`
    let sessionId=1,recording=true,busy=false,downAt=Date.now()-1000,releasedAt=0
    let maxTimer=null,stopTimer=null,showTimer=null,audioReceived=false,context=Promise.resolve({})
    let model='gpt-transcribe',keptClip=null,pastedAt=0,last=null,typed=0,kept=0,listener,resolveUpload
    const MIN_HOLD_MS=300,MAX_HOLD_MS=300000,RELEASE_PAD_MS=150,IPC_SEND={DICTATION_STOP:'stop'}
    const recordingStart={isReady:true,cancel:()=>{},start:()=>{}},settings=()=>({enabled:true})
    const getPill=()=>{},showPill=()=>{},hidePill=()=>{},state=()=>{},sendPill=()=>{},warmConnection=()=>{}
    const setTimeout=()=>null,clearTimeout=()=>{},onHoldKey=fn=>listener=fn
    const transcribe=()=>new Promise(r=>resolveUpload=r),viaAddon=()=>false,addonAuth=()=>null
    const getCredential=()=>null,CRED_TOOL='',CRED_TYPE='',store={get:()=>false}
    const parseMyWords=()=>({replacements:[]}),transcriptionPrompt=()=>'',transcribeTimeoutMs=()=>1000
    const typeText=async()=>{typed++;return true},applyReplacements=t=>t
    const keepClip=clip=>{keptClip=clip;if(clip)kept++},keepsClip=()=>true,fail=()=>{busy=false}
    ${code('function onDown()', '/** The front app')}
    ${code('function clearShowTimer()', 'async function onAudio(')}
    ${code('async function runClipSteps(', '/** A kept clip')}
    ${code('  onHoldKey((e) => {', '  applyWatcher()')}
    return {
      release:()=>listener('up'),event:e=>listener(e),cancel,
      run:()=>runClipSteps({buf:new ArrayBuffer(2000),mime:'audio/webm',durationMs:1000,ctx:{}},sessionId),
      complete:r=>resolveUpload(r),snapshot:()=>({typed,kept,busy,recording,sessionId})
    }
  `)()
}

for (const result of [{ ok: true, text: 'pending dictation' }, { ok: false, error: 'network' }]) {
  test(`shortcut from an ignored press preserves pending dictation (${result.ok ? 'pasted' : 'kept for retry'})`, async () => {
    const app = boot()
    app.release()
    const pending = app.run()
    app.event('down')
    app.event('cancel')
    app.event('up')
    app.complete(result)
    await pending
    const { typed, kept, busy, sessionId } = app.snapshot()
    assert.deepEqual({ typed, kept }, result.ok ? { typed: 1, kept: 0 } : { typed: 0, kept: 1 },
      'pending dictation must be pasted or kept; typed=0, kept=0 loses it')
    assert.equal(sessionId, 1)
    assert.equal(busy, false)
  })
}

test('a shortcut still cancels an active recording', () => {
  const app = boot()
  app.event('cancel')
  assert.deepEqual(app.snapshot(), { typed: 0, kept: 0, busy: false, recording: false, sessionId: 2 })
})

test('direct lifecycle cancellation still invalidates a pending transcription', async () => {
  const app = boot()
  app.release()
  const pending = app.run()
  app.cancel()
  app.complete({ ok: true, text: 'canceled dictation' })
  await pending
  assert.deepEqual(app.snapshot(), { typed: 0, kept: 0, busy: false, recording: false, sessionId: 2 })
})
