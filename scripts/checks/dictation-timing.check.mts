import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildSync, transformSync } from 'esbuild'
import * as smart from '../../src/main/dictation/smart.ts'
import * as snippets from '../../src/main/dictation/snippets.ts'
import { fillPlaceholders } from '../../src/main/launcher/snippet-text.ts'
import { clipTiming, logTiming } from '../../src/main/dictation/timing.ts'
import { addWeekly } from '../../src/shared/dictation-stats.ts'
const history = { exports: {} as any }
new Function('module', 'exports', buildSync({ entryPoints: ['src/main/dictation/history.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(history, history.exports)
const { addHistory, mayKeepHistory } = history.exports

const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const extract = (source: string, start: string, end: string) => transformSync(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), { loader: 'ts' }).code
function boot(opts: Record<string, any> = {}) {
  const deps = { ...smart, ...snippets, fillPlaceholders, clipTiming, addWeekly, addHistory, mayKeepHistory }
  return new Function('deps', 'opts', `
    const {parseMyWords,transcriptionPrompt,needsTidy,localTidy,applyReplacements,CLEANUP_MODEL,CLEANUP_MAX_BYTES,
      voiceSnippets,exactSnippet,snippetSpans,expandSnippets,fillPlaceholders,clipTiming,addWeekly,addHistory,mayKeepHistory}=deps
    let now=300,sessionId=7,uploadStarted=false,busy=true,releasedAt=100,model='gpt-transcribe',keptClip=null,last=null,historyRevision=0
    const Date={now:()=>now},isMac=opts.mac!==false,CRED_TOOL='',CRED_TYPE='',RELEASE_PAD_MS=150,NOT_TYPED_MESSAGE='not typed'
    const data={words:'hello -> Hello\\nsecret -> CHANGED',voiceSnippets:true,tidy:true,keepHistory:true,history:[],...opts.data}
    const store={get:k=>data[k],set:(k,v)=>data[k]=v},settings=()=>({enabled:true}),settingsChanged=()=>{},setMayRecord=()=>{},state=()=>{},hidePill=()=>{}
    const logs=[],logTiming=t=>logs.push(structuredClone(t)),console={log:()=>{},warn:()=>{}}
    const library=opts.library??[{id:'sig',keyword:';sig',name:'Signature',text:'secret\\n$& {clipboard}'}]
    const launcherStore={snippets:()=>library},clipboard={readText:()=> 'clipboard $1 {date}'}
    const getCredential=()=> 'key',viaAddon=()=>!!opts.addon,addonAuth=()=>({}),refreshAddon=()=>{},addonTidyFetch=()=>()=>{}
    const requests=[],transcribeTimeoutMs=()=>1000
    let attempt=0
    const transcribe=async()=>{now+=40;return opts.results?.[attempt++]??{ok:true,text:opts.raw??'SIG.'}}
    const transcribeViaAddon=transcribe,keepsClip=()=>true,keepClip=()=>{},fail=()=>{}
    let finishTidy
    const cleanUp=async(raw)=>{requests.push(raw);if(opts.pauseTidy)await new Promise(r=>finishTidy=r);now+=60;return {text:opts.cleaned??raw,cleaned:true,ms:60}}
    const pasted=[]
    const pasteAndRestore=async(text,privacy,current)=>{
      if(!current())return false
      now+=25
      if(opts.pasteImpl)return opts.pasteImpl(text,privacy,current)
      if(typeof text!=='string'){const content=text;text=content.parts.map(p=>p.snippet?fillPlaceholders(p.text,clipboard.readText):p.text).join('');content.resolved(text)}
      if(opts.throwPaste)throw Error('paste failed')
      if(opts.failPaste)return false
      privacy?.capture(opts.target??{secure:false,app:'Mail'})
      pasted.push(text);return true
    }
    ${extract(main, 'function rememberTyped(', '/** Tap, or another key')}
    ${extract(main, 'async function typeText(', '// ─── IPC')}
    ${extract(main, 'async function runClipSteps(', '/** A kept clip')}
    return {data,logs,requests,pasted,last:()=>last,cancel:()=>sessionId++,finish:()=>finishTidy(),
      run:()=>runClipSteps({buf:new ArrayBuffer(2000),mime:'audio/webm',durationMs:1150,ctx:{secure:false,app:'Mail',historyRevision:0,...opts.ctx},releaseAt:100,audioReadyAt:250},7)}
  `)(deps, opts)
}

test('exact trigger bypasses tidy; raw stays as spoken, successful expanded output drives history and stats', async () => {
  const app = boot()
  await app.run()
  const text = 'secret\n$& clipboard $1 {date}'
  assert.deepEqual(app.requests, [])
  assert.deepEqual(app.pasted, [text])
  assert.equal(app.last().raw, 'SIG.')
  assert.equal(app.last().typed, text)
  assert.equal(app.data.history[0].text, text)
  assert.equal(app.data.weekly.spokenSeconds, 1)
  assert.equal(app.data.weekly.words, addWeekly(undefined, text, 1000).words)
  assert.equal(app.logs[0].tidy, 'exact snippet')
})

test('inline tidy only receives spoken text, expands shared triggers, and protects inserted text from My words', async () => {
  const app = boot({ raw: 'um hello sig', cleaned: 'hello sig.' })
  await app.run()
  assert.deepEqual(app.requests, ['um hello sig'])
  assert.deepEqual(app.pasted, ['Hello secret\n$& clipboard $1 {date}.'])
  assert.equal(app.last().raw, 'um Hello sig')
  for (const [raw, cleaned] of [['um hello there', 'hello sig.'], ['um hello sig', 'hello there.']]) {
    const other = boot({ raw, cleaned }); await other.run()
    assert.equal(other.pasted[0], cleaned.replace('hello', 'Hello'))
  }
})

test('default-off leaves keywords ordinary and snippet snapshots survive edits during tidy', async () => {
  const off = boot({ data: { voiceSnippets: false } }); await off.run()
  assert.deepEqual(off.pasted, ['SIG.'])
  const library = [{ id: 'sig', keyword: ';sig', text: 'ORIGINAL' }]
  const app = boot({ raw: 'um hello sig', cleaned: 'hello sig.', pauseTidy: true, library })
  const pending = app.run(); await new Promise(r => setImmediate(r))
  library[0].text = 'EDITED'; app.finish(); await pending
  assert.deepEqual(app.pasted, ['Hello ORIGINAL.'])
})

test('local eligible filler skips remote; corrections and guard-rejected cleanup preserve existing paths', async () => {
  const local = boot({ raw: 'Um, Please send it today.' }); await local.run()
  assert.deepEqual(local.requests, [])
  assert.equal(local.pasted[0], 'Please send it today.')
  assert.equal(local.logs[0].tidy, 'local-leading-filler')
  const correction = boot({ raw: 'Um, Send five no wait six.', cleaned: 'Send six.' }); await correction.run()
  assert.equal(correction.requests.length, 1)
  assert.equal(correction.pasted[0], 'Send six.')
})

test('failed and thrown pastes add neither history nor stats and are explicitly labelled unsuccessful', async () => {
  for (const opts of [{ failPaste: true }, { throwPaste: true }]) {
    const app = boot(opts); await app.run()
    assert.deepEqual(app.pasted, [])
    assert.deepEqual(app.data.history, [])
    assert.equal(app.data.weekly, undefined)
    assert.equal(app.logs[0].pasteSuccess, false)
    assert.equal(app.logs[0].pasteCompleteMs, 265)
  }
})

test('Windows and private source/destination still skip history while successful output counts', async () => {
  for (const opts of [{ mac: false }, { ctx: { secure: true } }, { target: { secure: true } }, { data: { keepHistory: false } }]) {
    const app = boot(opts); await app.run()
    assert.deepEqual(app.data.history, [])
    assert.ok(app.data.weekly.words > 0)
  }
})

test('cancelled tidy cannot expand, update last, paste, or count', async () => {
  const app = boot({ raw: 'um hello sig', pauseTidy: true })
  const pending = app.run(); await new Promise(r => setImmediate(r))
  app.cancel(); app.finish(); await pending
  assert.deepEqual(app.pasted, [])
  assert.equal(app.last(), null)
  assert.equal(app.data.weekly, undefined)
})

test('stage durations separate audio finalisation, each STT attempt, tidy, paste start and completion', async () => {
  const app = boot({ raw: 'um hello sig', cleaned: 'hello sig.' }); await app.run()
  const t = app.logs[0]
  assert.equal(t.clipId, 7)
  assert.equal(t.releaseToAudioReadyMs, 150)
  assert.equal(t.attempts[0].ms, 40)
  assert.equal(t.attempts[0].provider, 'own-key')
  assert.equal(t.tidyMs, 60)
  assert.equal(t.pasteStartMs, 300)
  assert.equal(t.pasteCompleteMs, 325)
  assert.equal(t.pasteSuccess, true)
  assert.equal(t.bytes, 2000)
  assert.equal(t.durationMs, 1150)
  const retry = boot({ addon: true, results: [{ ok: false, error: 'network' }, { ok: false, error: 'model_unavailable' }, { ok: true, text: 'SIG.' }] })
  await retry.run()
  assert.deepEqual(retry.logs[0].attempts.map((a: any) => [a.provider, a.model, a.ms]), [
    ['add-on', 'server-configured', 40], ['own-key', 'gpt-transcribe', 40], ['own-key', 'gpt-4o-mini-transcribe', 40]
  ])
})

test('timing records contain no transcript, snippet body, clipboard, app context or dynamic rejection text', async () => {
  const app = boot(); await app.run()
  const logs = JSON.stringify(app.logs)
  for (const secret of ['SIG', 'secret', 'clipboard', 'Mail']) assert.ok(!logs.includes(secret))
  const t = clipTiming(8, 1000, undefined, 5000, 2000)
  assert.equal(t.retry, true)
  assert.equal(t.warmup, 'unknown')
  assert.equal(clipTiming(9, 1000, 1200, 5000, 2000, 'complete').warmup, 'complete')
  assert.equal(t.releaseToAudioReadyMs, null, 'a retry cannot reuse old recording timings')
  const old = console.log
  const records: unknown[][] = []
  try { console.log = (...args) => { records.push(args) }; logTiming(t) } finally { console.log = old }
  assert.equal(JSON.parse(records[0][1] as string).clipId, 8)
})

test('a clip cancelled while queued for the clipboard lock never pastes', async () => {
  const selection = readFileSync(new URL('../../src/main/launcher/selection.ts', import.meta.url), 'utf8')
  const code = extract(selection, 'export function pasteAndRestore(', 'async function winSelection(').replace('export ', '')
  let queued: (() => Promise<boolean>) | undefined
  let pasted = false
  const paste = new Function('oneAtATime', 'process', 'runMacHelper', code + ';return pasteAndRestore')(
    (fn: () => Promise<boolean>) => { queued = fn; return Promise.resolve(false) }, { platform: 'darwin' }, async () => { pasted = true; return { ok: true } }
  )
  let current = true
  await paste('text', undefined, () => current)
  current = false
  assert.equal(await queued!(), false)
  assert.equal(pasted, false)
})


test('queued voice snippets resolve the restored clipboard and record exactly what was pasted', async () => {
  const selection = readFileSync(new URL('../../src/main/launcher/selection.ts', import.meta.url), 'utf8')
  const code = extract(selection, 'let roundTrip:', 'async function winSelection(').replace(/export /g, '')
  for (const mode of ['win32', 'darwin', 'darwin-external']) {
    const platform = mode === 'win32' ? 'win32' : 'darwin'
    for (const raw of ['SIG.', 'hello sig']) {
      let copied = 'original $1 {date}'
      let release!: () => void
      let started!: () => void
      const active = new Promise<void>(r => { started = r })
      const gate = new Promise<void>(r => { release = r })
      const pasted: string[] = []
      let first = true
      const roundTrip = async (text: string) => {
        const saved = copied
        copied = text
        pasted.push(text)
        if (first) { first = false; started(); await gate }
        copied = saved
        return { ok: true, text, dictationPrivacy: { secure: false, app: 'Mail' } }
      }
      let nativeQueue: Promise<unknown> = Promise.resolve()
      const nativePaste = (args: string[], _timeout: number, input: string) => {
        const run = nativeQueue.then(() => {
          const text = args[0] === 'paste-parts'
            ? JSON.parse(input).map((p: any) => p.snippet ? p.text.split('{clipboard}').join(copied) : p.text).join('') : input
          return roundTrip(text)
        })
        nativeQueue = run
        return run
      }
      const paste = new Function('process', 'withCapturePaused', 'fillPlaceholders', 'clipboard', 'ownerHwnd',
        'saveAndWriteOwnText', 'simulateCtrlV', 'sleep', 'restoreWinClipboard', 'runMacHelper', code + ';return pasteAndRestore')(
        { platform }, (fn: () => unknown) => fn(), fillPlaceholders, { readText: () => copied }, () => 0,
        async (_hwnd: unknown, text: string) => {
          const saved = copied; copied = text; pasted.push(text)
          if (first) { first = false; started(); await gate }
          return { saved, stamp: {} }
        }, async () => true, async () => {}, async (_hwnd: unknown, saved: string) => { copied = saved },
        nativePaste
      )
      const previous = mode === 'darwin-external'
        ? nativePaste(['paste-text'], 4000, 'temporary output') : paste('temporary output')
      await active
      const app = boot({ raw, mac: platform === 'darwin', data: { tidy: false }, pasteImpl: paste })
      const pending = app.run()
      await new Promise(r => setImmediate(r))
      assert.deepEqual(pasted, ['temporary output'])
      release(); await previous; await pending
      const expected = (raw === 'SIG.' ? '' : 'Hello ') + 'secret\n$& original $1 {date}'
      assert.equal(pasted[1], expected)
      assert.equal(app.last().typed, expected)
      if (platform === 'darwin') assert.equal(app.data.history[0].text, expected)
      else assert.deepEqual(app.data.history, [])
      assert.equal(app.data.weekly.words, addWeekly(undefined, expected, 1000).words)
      assert.equal(copied, 'original $1 {date}')
    }
  }
})

test('native snippet clipboard reads happen under the cross-process lock before the payload write', () => {
  const swift = readFileSync(new URL('../../sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift', import.meta.url), 'utf8')
  const body = swift.slice(swift.indexOf('func pasteTextRestoring'), swift.indexOf('/// Our own synthetic'))
  assert.ok(body.indexOf('guard let lock = lockPasteboard()') < body.indexOf('let copied = pb.string(forType: .string)'))
  assert.ok(body.indexOf('let copied = pb.string(forType: .string)') < body.indexOf('writeOwnText(text)'))
  assert.match(body, /if parts \{ result\["text"\] = text \}/)
})
