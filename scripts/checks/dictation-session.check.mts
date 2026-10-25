import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { test } from 'node:test'
const main=readFileSync(new URL('../../src/main/dictation/index.ts',import.meta.url),'utf8')
const code=(start:string,end:string)=>transformSync(main.slice(main.indexOf(start),main.indexOf(end,main.indexOf(start))),{loader:'ts'}).code
const tick=()=>new Promise<void>(r=>setImmediate(r))

test('release sends current identity even before getUserMedia resolves', () => {
  const js=code('function onUp(', '/** The front app')
  const boot=new Function(`
    let recording=true, maxTimer=null, stopTimer=null,busy=false,releasedAt=0,downAt=Date.now()-400, sessionId=17
    const setRecordingEscape=()=>{};const recordingStart={isReady:true},MIN_HOLD_MS=300,RELEASE_PAD_MS=150,IPC_SEND={DICTATION_STOP:'stop'},sent=[]
    const clearShowTimer=()=>{},cancel=()=>{},fail=()=>{},showPill=()=>{},state=()=>{},sendPill=(...a)=>sent.push(a)
    const setTimeout=fn=>{fn();return null}
    ${js}
    onUp();return {sent,busy}
  `)()
  assert.equal(boot.busy,true)
  assert.deepEqual(boot.sent,[['stop',{send:true,sessionId:17}]])
})

test('cancel while context is pending never dispatches stale clip', async()=>{
  const js=code('function cancel()', '/** Speech to text, clean-up')
  const boot=new Function(`
    let uploadStarted=false; let sessionId=4,recording=false,busy=true,stopTimer=null,maxTimer=null,downAt=0,releasedAt=1000
    let finish,runs=0
    const context=new Promise(r=>finish=r),RELEASE_PAD_MS=150,IPC_SEND={},setRecordingEscape=()=>{},recordingStart={cancel:()=>{}}
    const runClip=async()=>runs++
    const clearShowTimer=()=>{},sendPill=()=>{},state=()=>{},hidePill=()=>{}
    ${js}
    return {audio:()=>onAudio(new ArrayBuffer(2000),'audio/webm'),cancel,complete:()=>finish({}),runs:()=>runs,busy:()=>busy}
  `)()
  const pending=boot.audio()
  await tick()
  boot.cancel()
  boot.complete()
  await pending
  assert.equal(boot.runs(),0)
  assert.equal(boot.busy(),false)
})

test('a canceled upload completion cannot paste or change a newer recording',async()=>{
  const js=code('async function runClipSteps(', '/** A kept clip')
  const boot=new Function(`
    let uploadStarted=false; let sessionId=1,busy=true,releasedAt=0,model='gpt-transcribe',keptClip=null,pastedAt=0,last=null,typed=0
    let resolveUpload
    const transcribe=()=>new Promise(r=>resolveUpload=r),viaAddon=()=>false,addonAuth=()=>null
    const getCredential=()=>null,CRED_TOOL='',CRED_TYPE='',store={get:()=>false}
    const parseMyWords=()=>({replacements:[]}),transcriptionPrompt=()=>'',transcribeTimeoutMs=()=>1000
    const readContext=async()=>({}),rememberTyped=()=>{};const typeText=async()=>{typed++;return true},applyReplacements=t=>t,keepClip=()=>{},state=()=>{},hidePill=()=>{}
    ${js}
    return {run:()=>runClipSteps({buf:new ArrayBuffer(2000),mime:'audio/webm',durationMs:1000,ctx:{}},1),
      cancel:()=>sessionId++,complete:()=>resolveUpload({ok:true,text:'stale text'}),typed:()=>typed,busy:()=>busy}
  `)()
  const pending=boot.run()
  boot.cancel();boot.complete();await pending
  assert.equal(boot.typed(),0)
  assert.equal(boot.busy(),true,'old job never releases a newer job')
})

for (const watcher of ['missing acknowledgement', 'absent watcher', 'crashed watcher']) {
  test(`audio uploads without waiting for ${watcher}`, async () => {
    const js=code('async function onAudio(', '/** Speech to text, clean-up')
    let runs=0
    const audio=new Function('runClip', `
      const sessionId=17,context=Promise.resolve({}),releasedAt=1000,downAt=0,RELEASE_PAD_MS=150
      ${js};return onAudio
    `)(async()=>{runs++})
    await audio(new ArrayBuffer(2000),'audio/webm')
    assert.equal(runs,1)
    assert.doesNotMatch(js,/disarm|setTimeout/)
  })
}
