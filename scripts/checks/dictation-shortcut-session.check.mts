import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { test } from 'node:test'

import { DictationGesture } from '../../src/main/dictation/gesture.ts'
const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const code = (start: string, end: string) => transformSync(
  main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start))), { loader: 'ts' }
).code

function boot(held = true) {
  let now = 1000
  const app = new Function('DictationGesture', 'held', 'Date', `
    let commandSession=null;
    const clipTiming=()=>({attempts:[]}),logTiming=()=>{},voiceSnippets=()=>[],exactSnippet=()=>undefined,snippetSpans=()=>[],expandSnippets=(text,spans,ordinary)=>ordinary(text);
    const gesture = new DictationGesture(); if(held)gesture.feed('down', Date.now()-1000)
    let connectionWarmup='unknown'; let uploadStarted=false; let sessionId=1,recording=held,busy=false,downAt=Date.now()-1000,releasedAt=0
    let maxTimer=null,stopTimer=null,showTimer=null,audioReceived=false,context=Promise.resolve({})
    let model='gpt-transcribe',keptClip=null,pastedAt=0,last=null,typed=0,kept=0,listener,escapeListener,resolveUpload,cap,phases=[]
    const PILL_ERROR_W=380,MIN_HOLD_MS=300,MAX_HOLD_MS=300000,RELEASE_PAD_MS=150,IPC_SEND={DICTATION_STOP:'stop'}
    const setMayRecord=()=>{},setRecordingEscape=()=>{};const recordingStart={isReady:true,cancel:()=>{},start:()=>{}},settings=()=>({enabled:true,holdKey:'fn'})
    const getPill=()=>{},showPill=()=>{},hidePill=()=>{},state=s=>phases.push(s),sendPill=()=>{},warmConnection=()=>{}
    const setTimeout=(fn,ms)=>{if(ms===MAX_HOLD_MS)cap=fn;return null},clearTimeout=()=>{},onHoldKey=fn=>listener=fn,onRecordingEscape=fn=>escapeListener=fn
    const isMac=true,holdKeyName=()=> 'fn'
    const transcribe=()=>new Promise(r=>resolveUpload=r),viaAddon=()=>false,addonAuth=()=>null
    const getCredential=()=>null,CRED_TOOL='',CRED_TYPE='',store={get:()=>false}
    const parseMyWords=()=>({replacements:[]}),transcriptionPrompt=()=>'',transcribeTimeoutMs=()=>1000
    const readContext=async()=>({}),rememberTyped=()=>{};const typeText=async()=>{typed++;return true},applyReplacements=t=>t
    const keepClip=clip=>{keptClip=clip;if(clip)kept++},keepsClip=()=>true,fail=()=>{busy=false}
    ${code('function onDown()', '/** The front app')}
    ${code('function clearShowTimer()', 'async function onAudio(')}
    ${code('async function runClipSteps(', '/** A kept clip')}
    ${code('  onRecordingEscape((id) => {', '  applyWatcher()')}
    return {
      release:()=>listener('up'),event:e=>listener(e),escape:(id=sessionId)=>escapeListener(id),cap:()=>cap(),phases:()=>phases,cancel,
      run:()=>runClipSteps({buf:new ArrayBuffer(2000),mime:'audio/webm',durationMs:1000,ctx:{}},sessionId),
      complete:r=>resolveUpload(r),snapshot:()=>({typed,kept,busy,recording,sessionId})
    }
  `)(DictationGesture, held, {now:()=>now})
  return {...app, time:(value:number)=>{now=value}}
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


test('real listener locks double tap, ignores shortcuts while locked, tap finishes, cap transcribes', () => {
  const app = boot(false)
  app.event('down'); app.time(1050); app.event('up')
  app.time(1200); app.event('down'); app.time(1250); app.event('up')
  assert.equal(app.snapshot().recording, true)
  assert.equal(app.phases().at(-1).message, 'Tap fn to finish')
  app.time(1400); app.event('down'); app.event('cancel'); app.event('up')
  assert.equal(app.snapshot().recording, true)
  app.time(1600); app.event('down'); app.time(1650); app.event('up')
  assert.equal(app.snapshot().recording, false); assert.equal(app.snapshot().busy, true)
  const capped=boot(false)
  capped.event('down');capped.time(1050);capped.event('up')
  capped.time(1200);capped.event('down');capped.time(1250);capped.event('up')
  capped.time(301200);capped.cap()
  assert.equal(capped.snapshot().recording,false);assert.equal(capped.snapshot().busy,true)
})

for (const locked of [false,true]) test(`real Esc listener discards ${locked?'hands-free':'held'} recording; idle Esc cannot cancel upload`, () => {
  const app=boot(false)
  app.event('down')
  if(locked){app.time(1050);app.event('up');app.time(1200);app.event('down');app.time(1250);app.event('up')}
  app.escape()
  assert.equal(app.snapshot().recording,false);assert.equal(app.snapshot().busy,false)
  assert.equal(app.snapshot().kept,0);assert.equal(app.snapshot().typed,0)
  assert.equal(app.phases().at(-1).message,'Cancelled')
  app.time(2000);app.event('down');app.time(2500);app.event('up')
  const session=app.snapshot().sessionId
  app.escape(-1);assert.equal(app.snapshot().sessionId,session);assert.equal(app.snapshot().busy,true)
})


test('real Esc listener cancels queued native Esc after release, but ignores a stale session', () => {
  const app=boot()
  app.release()
  app.escape(0)
  assert.equal(app.snapshot().busy,true)
  app.escape(1)
  assert.equal(app.snapshot().busy,false)
  assert.equal(app.snapshot().sessionId,2)
  assert.equal(app.phases().at(-1).message,'Cancelled')
})

test('swallowed Esc arriving after upload starts is ignored and the dictation completes', async () => {
  const app=boot()
  app.release()
  const pending=app.run()
  app.escape(1)
  assert.equal(app.snapshot().sessionId,1)
  assert.equal(app.snapshot().busy,true)
  app.complete({ok:true,text:'finished dictation'})
  await pending
  assert.equal(app.snapshot().typed,1)
  assert.equal(app.snapshot().busy,false)
})
