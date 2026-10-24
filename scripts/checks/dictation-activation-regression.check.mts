import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { serial } from '../../src/main/dictation/serial.ts'
import { autoEnable } from '../../src/main/dictation/activation.ts'
const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const code = transformSync(main.slice(main.indexOf('const viaAddon ='), main.indexOf('function settings():')), {loader:'ts',format:'cjs'}).code
function rig() {
  return new Function('serial','autoEnable', `
    let addon={state:'none'},addonCheckedAt=0,addonRefresh=null,addonRetry=null
    const settingsQueue=serial(), data={enabled:false,userOff:false},counts={mic:0,watcher:0}
    const store={get:k=>data[k],set:(k,v)=>data[k]=v}
    let auth={licence:'A',deviceId:'one'};const calls=[]
    const addonAuth=()=>auth,fetchAddonStatus=a=>new Promise(resolve=>calls.push({auth:a,resolve}))
    const ensureMediaAccess=()=>counts.mic++,retryExpansion=()=>{},applyWatcher=()=>counts.watcher++
    const settings=()=>({enabled:data.enabled&&viaAddon()}),getPill=()=>{}
    const BrowserWindow={getAllWindows:()=>[]},IPC_SEND={}
    ${code}
    return {data,counts,calls,refresh:()=>refreshAddon(true),switch:a=>auth=a,status:()=>addon}
  `)(serial,autoEnable)
}
const positive={state:'ok',balanceMicros:10,disabled:false,blocked:null}
const tick=()=>new Promise(r=>setImmediate(r))
test('[K3] empty, negative, disabled never ask for mic; first positive does, only once',async()=>{
  for(const status of [{...positive,state:'empty',balanceMicros:0},{...positive,balanceMicros:-1},{...positive,disabled:true},{...positive,blocked:'disabled'},{...positive,state:'low',balanceMicros:0}]){
    const r=rig();let p=r.refresh();r.calls[0].resolve(status);await p
    assert.equal(r.data.enabled,false,JSON.stringify(status));assert.equal(r.counts.mic,0)
    const beforeWatcher=r.counts.watcher
    p=r.refresh();r.calls[1].resolve({...positive,state:status.state==='low'?'low':'ok'});await p
    assert.equal(r.counts.watcher,beforeWatcher+1,'first positive activates the hold watcher even if state stays low')
    assert.equal(r.data.enabled,true);assert.equal(r.counts.mic,1)
    p=r.refresh();r.calls[2].resolve(positive);await p;assert.equal(r.counts.mic,1)
  }
})
test('[K4] licence/device switch discards old answer and refreshes current identity',async()=>{
  for(const auth of [{licence:'B',deviceId:'one'},{licence:'A',deviceId:'two'},null]){
    const r=rig();const p=r.refresh();r.switch(auth);r.calls[0].resolve(positive);await tick()
    assert.equal(r.counts.mic,0);assert.equal(r.data.enabled,false);assert.equal(r.status().state,'none')
    assert.equal(r.calls.length,2);assert.deepEqual(r.calls[1].auth,auth)
    r.calls[1].resolve({state:'none'});await p;await tick();assert.equal(r.counts.mic,0)
  }
})
test('[K4] identity checked again inside settings queue',async()=>{
  // Promise resolution and the queued settings callback are separate microtasks.
  const r=rig();const p=r.refresh();r.calls[0].resolve(positive)
  queueMicrotask(()=>r.switch({licence:'B',deviceId:'one'}));await tick()
  assert.equal(r.counts.mic,0);assert.equal(r.calls.length,2)
  r.calls[1].resolve({state:'none'});await p
})
