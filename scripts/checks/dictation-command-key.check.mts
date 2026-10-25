import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeCommandKey,holdKeyFromCode } from '../../src/shared/dictation-key.ts'
import { commandHarness,tick } from './command-harness.mts'
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
test('Mac command allowlist rejects dictation key, spoofed keys and all Windows keys',()=>{
  assert.equal(normalizeCommandKey('fn','fn','darwin'),null)
  assert.equal(normalizeCommandKey(null,'fn','darwin'),null)
  assert.equal(normalizeCommandKey({platform:'darwin',code:0,label:'F13'},'fn','darwin'),null)
  assert.equal(normalizeCommandKey(holdKeyFromCode(105,'darwin'),'fn','darwin')?.label,'F13')
  assert.equal(normalizeCommandKey(holdKeyFromCode(112,'win32'),'rctrl','win32'),null)
})
test('command taps drop, consecutive taps never lock, and 30 seconds bounds recording',async()=>{
  const h=commandHarness()
  for(let n=0;n<2;n++){h.start();h.capture();await tick();await h.advance(50);h.up();assert.equal(h.snapshot().command,false)}
  assert.equal(h.requests.filter(r=>r.stage==='stt').length,0)
  h.start();h.capture();await tick();await h.advance(30000)
  assert.equal(h.snapshot().recording,false);assert.equal(h.snapshot().command,false)
  assert.match(h.phases.at(-1).message,/30 seconds/)
})
test('native command gestures have their own sessions and never acquire ordinary hands-free lock',()=>{
  const launcher=read('sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift')
  const state=launcher.slice(launcher.indexOf('private var commandKeyState'),launcher.indexOf('private func physicalKeyDown'))
  const source=read('sidecar/darwin/PeakFlowHelper/Sources/NativeKeyState.swift')
  const program=`
import Foundation
${source}
var mayRecord=true,recordingEscape=false,escapeLocked=false
var output:[[String:Any]]=[]
func emit(_ obj:[String:Any]){output.append(obj)}
${state}
func feed(_ code:Int64,_ down:Bool,_ repeated:Bool=false){
  let r=commandKeyState.feed(code:code,down:down,up:!down,repeated:repeated,modifier:false,suppress:true,otherModifier:false,physical:{_ in true})
  emitCommandEvents(r.events)
}
_ = commandKeyState.configure(key:105,capture:false,physical:[])
feed(105,true);feed(105,true,true);feed(105,false)
assert(output.map{$0["e"] as! String} == ["command-down","command-up"])
assert(commandPending);cancelCommandKey();assert(!commandPending)
let first=commandSessionId
feed(105,true);feed(105,false);cancelCommandKey();assert(commandSessionId==first+1 && !escapeLocked)
let count=output.count
escapeLocked=true;feed(105,true);feed(105,false);assert(output.count==count)
escapeLocked=false;mayRecord=false;feed(105,true);feed(105,false);assert(output.count==count)
mayRecord=true;feed(105,true);feed(0,true);assert(output.last?["e"] as? String == "command-cancel")
feed(105,false);feed(0,false);feed(105,true)
emitCommandEvents(commandKeyState.interrupt());cancelCommandKey();assert(!commandPending)
print("Swift command sessions/repeats/paired releases/cancellation/hands-free isolation passed")
`
  const dir=mkdtempSync(join(tmpdir(),'peakflow-command-key-'))
  try {
    const path=join(dir,'main.swift');writeFileSync(path,program)
    const result=spawnSync('swift',['-module-cache-path',process.env['SWIFTPM_MODULECACHE_OVERRIDE'] ?? process.env['CLANG_MODULE_CACHE_PATH'] ?? join(dir,'cache'),path],{encoding:'utf8',env:{...process.env,CLANG_MODULE_CACHE_PATH:join(dir,'clang')}})
    assert.equal(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim())
  } finally{rmSync(dir,{recursive:true,force:true})}
})
test('native physical-key and Esc gates persist after release and ignore injected events',()=>{
  const swift=read('sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift')
  assert.match(swift,/commandPhysical = event.getIntegerValueField\(.eventSourceStateID\) == Int64\(CGEventSourceStateID.hidSystemState.rawValue\)/)
  assert.match(swift,/commandPhysical && commandPending && isDown && code != commandKeyCode/)
  assert.match(swift,/id == commandSessionId && commandPending \{ commandAccepted = true/ )
  assert.match(swift,/let swallow = code == 53 && commandAccepted[\s\S]*cancelCommandKey\(\)[\s\S]*escapeDown = true/)
  const transition=swift.slice(swift.indexOf('private func emitCommandEvents'),swift.indexOf('private func physicalKeyDown'))
  assert.doesNotMatch(transition,/event == "up".*commandPending = false|escapeLocked = true/)
})
