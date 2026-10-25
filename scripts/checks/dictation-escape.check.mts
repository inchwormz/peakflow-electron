import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

test('cancel path invalidates audio, drops pending start, and never sends a clip', () => {
  const s = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
  const cancel = s.slice(s.indexOf('function cancel()'), s.indexOf('async function onAudio'))
  assert.match(cancel, /send: false/)
  assert.match(cancel, /sessionId\+\+/)
  assert.match(cancel, /recordingStart.cancel\(\)/)
  assert.match(s, /onRecordingEscape\(\(id\) => \{/)
  assert.match(s, /phase: 'cancelled', message: 'Cancelled'/)
})

test('actual Windows hook Esc branch pairs interception and forwards every idle Esc', () => {
  const hook = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
  const start = hook.indexOf('            if (k.vkCode == 27)')
  const branch = hook.slice(start, hook.indexOf('            HashSet<uint> physical', start))
    .replace(/\brecordingEscape\b/g, 'state.recordingEscape').replace(/\bescapeDown\b/g, 'state.escapeDown').replace(/new IntPtr\(1\)/g, '1').replace(/EmitSession/g, 'Emit').replace(/escapeAccepted = false; escapeLocked = false; escapePressAt = -1; escapeTapUpAt = -1000;/g, '')
  const feed = new Function('state', 'k', 'isDown', 'isUp', 'Emit', branch + ';return 0')
  const state = { recordingEscape: false, escapeDown: false }
  const emitted: string[] = []
  const key = (down: boolean) => feed(state, { vkCode: 27 }, down, !down, (s: string) => emitted.push(s))
  assert.equal(key(true), 0); assert.equal(key(false), 0)
  state.recordingEscape = true
  assert.equal(key(true), 1); assert.equal(key(true), 1)
  assert.deepEqual(emitted, ['recording-escape'])
  assert.equal(state.recordingEscape, false)
  assert.equal(key(false), 1)
  assert.equal(key(true), 0)
})

test('queued native Esc maps to its audio session after release, without any drain', async () => {
  const { transformSync } = await import('esbuild')
  const source = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
  const code = transformSync(source.slice(source.indexOf('function onLine('), source.indexOf('const WIN_HOOK')), { loader: 'ts' }).code
  const events: number[] = []
  const feed = new Function('escapeListener', `
    const escapeBinding={native:8,audio:17}, process={env:{}}, capturingHoldKey=false
    const onKey=()=>{}
    ${code}; return onLine
  `)((id: number) => events.push(id))
  feed('{"e":"hold-up"}')
  feed('{"e":"recording-escape","sessionId":7}')
  feed('{"e":"recording-escape","sessionId":8}')
  assert.deepEqual(events, [17])
  assert.doesNotMatch(source, /escapeWaiters|recording-disarmed|disarmRecordingEscape/)
})

// Execute the hook's actual local state transitions with only C# syntax translated.
function nativeHook() {
  const clock = { now: 0 }
  const source = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
  const events = source.slice(source.indexOf('  static void EmitEvents('), source.indexOf('  static bool IsModifier('))
    .replace('static void EmitEvents(List<string> events)', 'function EmitEvents(events)')
    .replace('foreach (string e in events)', 'for (const e of events)')
    .replace('long now = escapeClock.ElapsedMilliseconds', 'const now = clock.now')
    .replace('bool tap =', 'const tap =')
  const start = source.indexOf('            if (k.vkCode == 27)')
  const esc = source.slice(start, source.indexOf('            HashSet<uint> physical', start)).replaceAll('new IntPtr(1)', '1')
  const armStart=source.indexOf('if (int.TryParse(line.Substring(4)')
  const arm=source.slice(armStart,source.indexOf('\n          }',armStart)).replace('int.TryParse(line.Substring(4).Trim(), out id) && ', '')
  const availableStart=source.indexOf('            if (!mayRecord)')
  const available=source.slice(availableStart,source.indexOf('\n          }',availableStart))
  return new Function('clock', `
    let mayRecord=false,escapeAccepted=false,dictate=true,recordingEscape=false,escapeLocked=false,escapePressAt=-1,escapeTapUpAt=-1000,escapeSecond=false,escapeId=0,escapeDown=false
    const emitted=[],EmitSession=e=>emitted.push({e,id:escapeId})
    ${events}
    function arm(id=escapeId) { ${arm} }
    function available(value) { mayRecord=value; ${available} }
    function escape(isDown) { const k={vkCode:27},isUp=!isDown; ${esc}; return 0 }
    return {key:e=>EmitEvents([e]),arm,available,escape,emitted,armed:()=>recordingEscape,time:n=>clock.now=n}
  `)(clock)
}

test('watcher arms only after acceptance and disarms on hold-up before any Electron round trip', () => {
  const hook = nativeHook()
  hook.available(true)
  hook.key('down')
  assert.equal(hook.armed(), false, 'passes Esc until Electron accepts')
  hook.arm()
  assert.equal(hook.armed(), true)
  hook.time(500); hook.key('up')
  assert.equal(hook.armed(), false)
  assert.equal(hook.escape(true), 0, 'post-release Esc passes to the app')
  assert.equal(hook.escape(false), 0)
  assert.deepEqual(hook.emitted.map((e: any) => e.e), ['hold-down', 'hold-up'])
})

test('watcher Esc while held reports the native session once and consumes its release', () => {
  const hook = nativeHook()
  hook.available(true)
  hook.key('down'); hook.arm()
  assert.equal(hook.escape(true), 1)
  assert.equal(hook.escape(true), 1)
  hook.key('up')
  assert.equal(hook.escape(false), 1)
  assert.deepEqual(hook.emitted.filter((e: any) => e.e === 'recording-escape'), [{e:'recording-escape',id:1}])
  assert.equal(hook.escape(true), 0)
})

test('watcher double tap stays armed hands-free; finishing tap disarms locally', () => {
  const hook = nativeHook()
  hook.available(true)
  hook.key('down'); hook.arm(); hook.key('up')
  hook.key('down'); hook.arm(); hook.key('up')
  assert.equal(hook.armed(), true)
  hook.key('down'); hook.arm(); hook.key('up')
  assert.equal(hook.armed(), false)
  assert.equal(hook.escape(true), 0)
})

test('safety disarm never waits on absent, crashed or unresponsive watcher', async () => {
  const { transformSync } = await import('esbuild')
  const source = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
  const code = transformSync(source.slice(source.indexOf('export function setRecordingEscape('), source.indexOf('/** Record physical keys')), {loader:'ts'}).code.replace('export ', '')
  for (const platform of ['win32','darwin']) for (const watcher of ['absent','crashed','unresponsive']) {
    const writes: string[] = []
    const child = watcher === 'absent' ? null : {stdin:{writable:true,write:(text:string)=>{
      writes.push(text)
      if(watcher==='crashed')throw new Error('broken pipe')
    }}}
    const disarm = new Function('child','process', `
      let nativeEscapeId=9,escapeBinding={native:9,audio:17}
      ${code};return setRecordingEscape
    `)(child,{platform})
    assert.equal(disarm(false),undefined)
    assert.equal(writes.length,watcher==='absent'?0:1)
  }
})

test('busy and default-off presses never arm Esc; stale on, late arm and availability races fail safe', () => {
  const hook=nativeHook()
  for(const event of ['down','up','down','up']) hook.key(event)
  hook.arm()
  assert.equal(hook.armed(),false)
  assert.equal(hook.escape(true),0)
  assert.equal(hook.escape(false),0)
  hook.available(true)
  hook.key('down') // stale availability: Electron rejects, so no ARM
  assert.equal(hook.escape(true),0)
  hook.available(false); hook.arm()
  assert.equal(hook.armed(),false)
  hook.key('up'); hook.available(true); hook.arm()
  assert.equal(hook.armed(),false,'late confirmation after release is ignored')
  hook.key('down'); hook.arm(0)
  assert.equal(hook.armed(),false,'old confirmation cannot arm a later press')
  hook.arm(); assert.equal(hook.armed(),true)
  hook.available(false)
  assert.equal(hook.escape(true),0)
})

test('Electron rejects busy and disabled presses without arming or advancing its gesture', async () => {
  const {transformSync}=await import('esbuild')
  const source=readFileSync(new URL('../../src/main/dictation/index.ts',import.meta.url),'utf8')
  const start=source.indexOf('  onHoldKey((e) => {')
  const callback=transformSync(source.slice(start,source.indexOf('  applyWatcher()',start)),{loader:'ts'}).code
  for(const busy of [false,true]) for(const enabled of [false,true]) {
    const calls:string[]=[]
    const feed=new Function('busy','enabled','calls',`
      let handler,recording=false
      const settings=()=>({enabled}),onHoldKey=fn=>handler=fn
      const gesture={locked:false,reset:()=>calls.push('reset'),feed:()=>{calls.push('feed');return 'start'}}
      const onDown=()=>calls.push('arm')
      ${callback};return handler
    `)(busy,enabled,calls)
    feed('down');feed('up')
    if(busy || !enabled) assert.deepEqual(calls,['reset','reset'])
    else assert.ok(calls.includes('arm'))
  }
})

test('availability updates cover every busy change and watcher enabled configuration', () => {
  const source=readFileSync(new URL('../../src/main/dictation/index.ts',import.meta.url),'utf8')
  assert.match(source,/setMayRecord\(s.enabled && !busy\)/)
  for(const match of source.matchAll(/(?<!let )busy = (true|false)\n([^\n]+)/g)) {
    assert.ok(match[2].includes(match[1]==='true'?'setMayRecord(false)':'setMayRecord(settings().enabled)'),match[0])
  }
  const watcher=readFileSync(new URL('../../src/main/launcher/expander.ts',import.meta.url),'utf8')
  assert.match(watcher,/let mayRecord = false/)
  assert.match(watcher,/function sendHold\(\)[\s\S]*?sendMayRecord\(\)/)
})
