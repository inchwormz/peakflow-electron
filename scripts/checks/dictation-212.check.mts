import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeHoldKey, holdKeyFromCode } from '../../src/shared/dictation-key.ts'
import { autoEnable, toggleChoice } from '../../src/main/dictation/activation.ts'
import { serial } from '../../src/main/dictation/serial.ts'
const src = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('first usable transition enables once; refreshes and a deliberate Off never enable', () => {
  assert.equal(autoEnable(false, true, false), true)
  assert.equal(autoEnable(true, true, false), false)
  assert.equal(autoEnable(true, false, false), false)
  assert.equal(autoEnable(false, true, true), false)
  assert.deepEqual(toggleChoice(false), { enabled: false, userOff: true })
  assert.deepEqual(toggleChoice(true), { enabled: true, userOff: false })
})
test('native key allowlist: every modifier, fn, F keys; no typing/navigation/media/Caps Lock', () => {
  for (const code of [54,55,56,60,58,61,59,62,63,122,120,99,118,96,97,98,100,101,109,103,111,105,107,113,106,64,79,80,90]) assert.ok(holdKeyFromCode(code, 'darwin'), String(code))
  for (const code of [160,161,162,163,164,165,91,92,...Array.from({length:24}, (_,i)=>112+i)]) assert.ok(holdKeyFromCode(code, 'win32'), String(code))
  for (const code of [0,1,18,49,36,48,53,123,124,125,126,57,72]) assert.equal(holdKeyFromCode(code,'darwin'), null)
  for (const code of [65,48,32,13,9,27,37,38,39,40,20,2,173,255]) assert.equal(holdKeyFromCode(code,'win32'), null)
})
test('legacy presets preserve native codes; renderer labels/kinds/platform cannot bypass validation', () => {
  for (const [preset,code] of [['fn',63],['rcmd',54],['ropt',61],['rctrl',62]] as const) assert.equal(normalizeHoldKey(preset,'darwin')?.code,code)
  assert.equal(normalizeHoldKey('rctrl','win32')?.code,163)
  assert.equal(normalizeHoldKey('ralt','win32')?.code,165)
  assert.equal(normalizeHoldKey({code:0,kind:'mod',label:'F13',platform:'darwin'},'darwin'),null)
  assert.equal(normalizeHoldKey({code:63,kind:'mod',label:'fn',platform:'win32'},'darwin'),null)
  assert.equal(normalizeHoldKey({code:63,kind:'key',label:'bad',platform:'darwin'},'darwin')?.label,'fn')
})
test('one settings queue preserves order and survives rejection', async () => {
  const run = serial(); const log: number[] = []
  let release!: () => void
  const gate = new Promise<void>(r => {release=r})
  const a=run(async()=>{log.push(1);await gate;log.push(2)})
  const b=run(()=>{log.push(3);throw Error('expected')})
  const caught=assert.rejects(b,/expected/)
  const c=run(()=>log.push(4))
  await Promise.resolve();assert.deepEqual(log,[1]);release();await a;await caught;await c
  assert.deepEqual(log,[1,2,3,4])
})
test('main validates renderer key and remembers UI toggle, all snapshots queued', () => {
  const main=src('src/main/dictation/index.ts')
  assert.ok(main.includes('normalizeHoldKey(value,'))
  assert.ok(main.includes('toggleChoice(value)'))
  assert.ok(main.includes("store.set('userOff'"))
  for(const ch of ['DICTATION_SETTINGS','DICTATION_SET','DICTATION_SAVE_KEY','DICTATION_SET_WORDS','DICTATION_REMOVE_KEY']) assert.ok(main.includes(`serialised(IPC_INVOKE.${ch},`),ch)
  assert.ok(main.includes('autoEnable(wasUsable,'))
})

test('native configuration refresh never resets the same active hold; Win suppresses Start', () => {
  const hook=src('src/main/launcher/expander.ts')
  assert.ok(hook.includes('JSON.stringify(holdKey) === JSON.stringify(key) && dictating === dictate) return'))
  assert.ok(hook.includes("onKey('cancel')\n  holdKey = key"))
  assert.ok(hook.includes('holdVk == 0x5B || holdVk == 0x5C) ThreadPool'))
  const main=src('src/main/dictation/index.ts')
  for (const event of ['blur','hide']) assert.ok(main.includes(`owner?.once('${event}', cancelCapture)`))
})

test('real main add-on refresh enables fresh purchase once, broadcasts, and honors later Off through transitions', async () => {
  const {transformSync}=await import('esbuild')
  const main=src('src/main/dictation/index.ts')
  const path=main.slice(main.indexOf('const viaAddon ='),main.indexOf('function settings():'))
  const code=transformSync(path,{loader:'ts',format:'cjs'}).code
  const boot = (userOff: boolean) => new Function('serial','autoEnable','userOff',`
    let addon={state:'none'}, addonCheckedAt=0, addonRefresh=null, addonRetry=null
    const settingsQueue=serial(), counts={mic:0,watcher:0,pill:0,changed:0}
    const data={enabled:false,userOff};const store={get:k=>data[k],set:(k,v)=>data[k]=v}
    let next={state:'none'}
    const fetchAddonStatus=async()=>next, addonAuth=()=>({})
    const ensureMediaAccess=()=>counts.mic++, retryExpansion=()=>{}
    const applyWatcher=()=>counts.watcher++, settings=()=>({enabled:data.enabled&&viaAddon()}), getPill=()=>counts.pill++
    const BrowserWindow={getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:()=>counts.changed++}}]},IPC_SEND={}
    ${code}
    return {data,counts,refresh:async(n)=>{next=n;await refreshAddon(true)}}
  `)(serial,autoEnable,userOff)
  const ok={state:'ok',balanceMicros:5_000_000,disabled:false,blocked:null}
  const r=boot(false)
  await r.refresh(ok);assert.equal(r.data.enabled,true);assert.equal(r.counts.mic,1);assert.equal(r.counts.pill,1);assert.ok(r.counts.changed>=2)
  await r.refresh(ok);assert.equal(r.counts.mic,1);assert.equal(r.counts.watcher,1)
  await r.refresh({...ok,balanceMicros:4_000_000});assert.equal(r.counts.watcher,1,'balance-only refresh preserves active native hold')
  Object.assign(r.data,toggleChoice(false))
  await r.refresh({state:'none'});await r.refresh(ok)
  assert.equal(r.data.enabled,false);assert.equal(r.counts.mic,1)
  const off=boot(true);await off.refresh(ok);assert.equal(off.data.enabled,false);assert.equal(off.counts.mic,0)
})
test('real main IPC handler rejects typing keys and untrusted senders; UI toggle sets/clears userOff', async () => {
  const {transformSync}=await import('esbuild')
  const main=src('src/main/dictation/index.ts')
  const code=transformSync(main.slice(main.indexOf('function registerIpc('),main.indexOf('export function initDictation')),{loader:'ts',format:'cjs'}).code
  const {IPC_INVOKE}=await import('../../src/shared/launcher/ipc.ts').then(m=>({IPC_INVOKE:m.LAUNCHER_INVOKE}))
  const {EventEmitter}=await import('node:events')
  const boot=new Function('serial','toggleChoice','normalizeHoldKey','holdKeyFromCode','EventEmitter','IPC_INVOKE',`
    const ui=new EventEmitter(), owner=new EventEmitter(), handlers={},data={enabled:true,userOff:false,holdKey:'fn'}
    const BrowserWindow={fromWebContents:()=>owner}
    let recorder=null,captureState=false
    const onHoldKeyRecorded=fn=>{recorder=fn;return()=>recorder=null}
    const setHoldKeyCapture=v=>captureState=v,cancel=()=>{}
    const store={get:k=>data[k],set:(k,v)=>data[k]=v},settingsQueue=serial()
    const ipcMain={handle:(ch,fn)=>handlers[ch]=fn}, getPanel=()=>({webContents:ui}),pill=null,isMac=true
    const settings=()=>({...data}),settingsWithHint=async()=>settings(),settingsChanged=()=>{},applyWatcher=()=>{},getPill=()=>{}
    const ensureMediaAccess=()=>{},retryExpansion=()=>{},refreshAddon=()=>Promise.resolve()
    ${code}
    registerIpc(()=>ui)
    return {data,handlers,ui,owner,record:code=>recorder?.(code),capturing:()=>captureState}
  `)(serial,toggleChoice,normalizeHoldKey,holdKeyFromCode,EventEmitter,IPC_INVOKE)
  await boot.handlers[IPC_INVOKE.DICTATION_SET]({sender:boot.ui},'enabled',false)
  assert.equal(boot.data.userOff,true);assert.equal(boot.data.enabled,false)
  await boot.handlers[IPC_INVOKE.DICTATION_SET]({sender:boot.ui},'enabled',true)
  assert.equal(boot.data.userOff,false);assert.equal(boot.data.enabled,true)
  const bad={platform:process.platform,code:0,kind:'mod',label:'F13'}
  await boot.handlers[IPC_INVOKE.DICTATION_SET]({sender:boot.ui},'holdKey',bad)
  assert.equal(boot.data.holdKey,'fn')
  await boot.handlers[IPC_INVOKE.DICTATION_SET]({sender:{}},'enabled',false)
  assert.equal(boot.data.enabled,true)
  const capture=()=>boot.handlers[IPC_INVOKE.DICTATION_RECORD_KEY]({sender:boot.ui},true)
  const chosen=capture();assert.equal(boot.capturing(),true);boot.record(63)
  assert.equal((await chosen).label,'fn');assert.equal(boot.capturing(),false)
  const rejected=capture();boot.record(0);assert.equal(await rejected,'rejected')
  const escape=capture();boot.record(53);assert.equal(await escape,null)
  for (const event of ['blur','hide']) {
    const pending=capture();boot.owner.emit(event);assert.equal(await pending,null);assert.equal(boot.capturing(),false)
    assert.equal(boot.owner.listenerCount(event),0)
  }
})
