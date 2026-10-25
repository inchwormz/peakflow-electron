import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
const swift=read('sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift')
const snapshot=swift.slice(swift.indexOf('private func commandSnapshot'),swift.indexOf('private func sameCommandSelection'))

test('native command text reads follow permission, excluded-app, known safety and editable checks',()=>{
  const textRead=snapshot.indexOf('kAXSelectedTextAttribute')
  for(const gate of ['AXIsProcessTrusted()', 'excluded', 'kAXSecureTextFieldSubrole', 'Unknown field safety','AXUIElementIsAttributeSettable','kAXEnabledAttribute','ranges.count != 1','range.length > 0']) {
    const at=snapshot.indexOf(gate);assert.ok(at>=0 && at<textRead,gate)
  }
  assert.doesNotMatch(snapshot,/kAXValueAttribute\)|kAXValueAttribute\) as\?|dictationContext|previousApp|postKey|pasteboard|\.activate/)
  assert.match(snapshot,/text.utf8.count <= 2000/)
  assert.match(snapshot,/focusedWindow.*CFEqual\(focusedWindow, window\)/)
})
test('native validation is inside clipboard lock and precedes one normal paste, with no fallback',()=>{
  const worker=swift.slice(swift.indexOf('func runCommandSelection()'))
  const lock=worker.indexOf('lockPasteboard()'),validate=worker.indexOf('commandSnapshot(excluded:',lock),paste=worker.indexOf('down.post(')
  assert.ok(lock<validate && validate<paste)
  assert.ok(worker.indexOf('gate.waitForApproval()',lock)<validate)
  assert.match(worker,/sameCommandSelection\(snapshot, current\)/)
  assert.match(worker,/!physicalKeyDown\(Int64\(code\)\)/)
  assert.match(worker,/gate.begin[\s\S]*writeOwnText\(text\)[\s\S]*commandSelectionUnchanged\(snapshot, pasteboard: pb, changeCount: ours\)[\s\S]*down.post/)
  const lastCheck=worker.indexOf('commandSelectionUnchanged(snapshot,')
  assert.match(worker.slice(lastCheck,paste),/^commandSelectionUnchanged\(snapshot, pasteboard: pb, changeCount: ours\) else \{ return \}\s*\/\/ Global paste cannot close the sub-millisecond window between the last read and the synthetic keystroke\.\s*$/)
  assert.equal((worker.match(/down.post\(/g)??[]).length,1)
  assert.match(worker,/began && pb.changeCount == ours \{ restorePasteboard\(saved\) \}/)
  assert.doesNotMatch(worker,/sendPaste|postKey\(8|previousApp|\.activate|kAXValueAttribute|kAXSelectedTextRangeAttribute/)
  const equality=swift.slice(swift.indexOf('private func sameCommandSelection'),swift.indexOf('private final class CommandPasteGate'))
  for(const field of ['a.pid == b.pid','CFEqual(a.window, b.window)','CFEqual(a.element, b.element)','a.range.location == b.range.location','a.range.length == b.range.length','a.text == b.text'])assert.ok(equality.includes(field),field)
})

function nativeHarness(platform='darwin') {
  const source=read('src/main/native/command-selection.ts')
  const fn=source.slice(source.indexOf('export function captureNativeCommandSelection'))
  const code=transformSync(fn,{loader:'ts'}).code.replace('export ','')
  const child:any=new EventEmitter(),writes:any[]=[],stdout:any=new EventEmitter()
  stdout.setEncoding=(s:string)=>assert.equal(s,'utf8')
  child.stdout=stdout;child.stdin=new EventEmitter();child.stdin.writable=true;child.stdin.write=(s:string)=>writes.push(JSON.parse(s));child.stdin.end=()=>child.emit('exit',0)
  const calls:any[]=[]
  const capture=new Function('spawn','getMacHelperPath','EXCLUDED_APPS','process',code+';return captureNativeCommandSelection')((...args:any[])=>{calls.push(args);return child},()=>'/helper',['1password'],{platform})
  return {capture,writes,calls,close:()=>child.emit('exit',0),reply:(data:object)=>stdout.emit('data',JSON.stringify(data)+'\n')}
}
test('unsupported platforms and already-cancelled captures never spawn',async()=>{
  for(const platform of ['win32','linux']) {
    const h=nativeHarness(platform);assert.equal((await h.capture(new AbortController().signal)).ok,false);assert.equal(h.calls.length,0)
  }
  const h=nativeHarness(),controller=new AbortController();controller.abort();assert.equal((await h.capture(controller.signal)).ok,false);assert.equal(h.calls.length,0)
})
for(const error of ['Password field','Unknown field safety','Select text first','Read-only field','Select less text','Select one text range','Allow Accessibility'])test(`capture refusal releases native session: ${error}`,async()=>{
  const h=nativeHarness(),pending=h.capture(new AbortController().signal);h.reply({stage:'capture',error})
  assert.deepEqual(await pending,{ok:false,error});assert.equal(h.writes.filter(w=>'text' in w).length,0)
})
test('ownership revalidation after native lock refuses changed account and abort sends native cancel',async()=>{
  const h=nativeHarness(),controller=new AbortController();const capture=h.capture(controller.signal)
  h.reply({stage:'capture',text:'Siobhán 42'});const r=await capture;assert.equal(r.ok,true)
  let valid=true,started=0
  const replacement=r.selection.replace('“Do not cancel.”',105,()=>started++,()=>valid)
  valid=false;h.reply({stage:'validate'})
  assert.deepEqual(h.writes.at(-1),{authorize:false});controller.abort();assert.deepEqual(h.writes.at(-1),{cancel:true})
  h.reply({stage:'result',ok:false});assert.equal(await replacement,false);assert.equal(started,0);h.close()
  assert.deepEqual(h.calls[0][1],['command-selection'],'argv contains no source/instruction/result')
})
test('success preserves result formatting, exposes native paste boundary, rejects duplicate replacement',async()=>{
  const h=nativeHarness(),capture=h.capture(new AbortController().signal);h.reply({stage:'capture',text:'Original'})
  const r=await capture;let started=0
  const pending=r.selection.replace('“No.”\n- 42',105,()=>started++,()=>true)
  h.reply({stage:'validate'});assert.deepEqual(h.writes.at(-1),{authorize:true})
  h.reply({stage:'pasting'});assert.equal(started,1)
  h.reply({stage:'result',ok:true});assert.equal(await pending,true)
  assert.equal(await r.selection.replace('again',105,()=>{},()=>true),false);h.close()
})
test('queued command rechecks cancellation before touching native clipboard operation',async()=>{
  const s=read('src/main/launcher/selection.ts'),start=s.indexOf('export function replaceCommandSelection')
  const code=transformSync(s.slice(start),{loader:'ts'}).code.replace('export ','')
  let queued!:()=>Promise<boolean>,cancelled=0,replaced=0,valid=true
  const replace=new Function('oneAtATime','process',code+';return replaceCommandSelection')((fn:()=>Promise<boolean>)=>new Promise(resolve=>{queued=async()=>{const r=await fn();resolve(r);return r}}),{platform:'darwin'})
  const pending=replace({cancel:()=>cancelled++,replace:async()=>{replaced++;return true}},'result',105,()=>valid,()=>{})
  valid=false;await queued();assert.equal(await pending,false);assert.equal(cancelled,1);assert.equal(replaced,0)
})

test('actual Swift paste gate arbitrates cancellation and the native paste boundary',async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs')
  const {spawnSync}=await import('node:child_process')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const validation=swift.slice(swift.indexOf('private func validateCommandSelection'),swift.indexOf('private func commandSelectionUnchanged'))
  const gate=swift.slice(swift.indexOf('private final class CommandPasteGate'),swift.indexOf('/// Dedicated stdin protocol'))
  const code=`import Foundation
${gate}
${validation}
// The delayed focus/window AX replies let a person switch apps or move the range.
func validate(_ change: String) -> Bool {
    var pid=42, location=10, text="Original", focused=true
    return validateCommandSelection(focus: {
        Thread.sleep(forTimeInterval: 0.01)
        if change == "app" { pid=99 }
        if change == "range" { location=20 }
        if change == "text" { text="Changed" }
        if change == "focus" { focused=false }
        return focused
    }, range: { location == 10 }, text: { text == "Original" }, frontmost: { pid == 42 })
}
assert(validate("unchanged"))
for change in ["app", "range", "text", "focus"] { assert(!validate(change)) }
// AX range/text replies can describe the original element after focus or range moves.
for change in ["same-app-field", "same-text-offset"] {
    for blockingRead in ["range", "text"] {
        var focused=1, location=10, reads: [String]=[]
        let valid = validateCommandSelection(focus: {
            reads.append("focus")
            return focused == 1
        }, range: {
            reads.append("range")
            let originalRange = location == 10
            if blockingRead == "range" && reads.filter({ $0 == "range" }).count == 1 {
                Thread.sleep(forTimeInterval: 0.01)
                if change == "same-app-field" { focused=2 } else { location=20 }
            }
            return originalRange
        }, text: {
            reads.append("text")
            Thread.sleep(forTimeInterval: 0.01)
            if blockingRead == "text" {
                if change == "same-app-field" { focused=2 } else { location=20 }
            }
            return true // Identical text, including at the new offset.
        }, frontmost: { reads.append("pid"); return true })
        assert(!valid, "Must refuse \\(change) during \\(blockingRead)")
    }
}
var reads: [String]=[]
assert(validateCommandSelection(focus: { reads.append("focus"); return true },
    range: { reads.append("range"); return true }, text: { reads.append("text"); return true },
    frontmost: { reads.append("pid"); return true }))
assert(reads == ["pid", "focus", "range", "text", "pid", "focus", "range"])
enum AXFailure: Error { case timeout }
for failed in 0..<7 {
    var checks=0
    let read: () throws -> Bool = {
        defer { checks += 1 }
        if checks == failed { throw AXFailure.timeout }
        return true
    }
    assert(!validateCommandSelection(focus: read, range: read, text: read, frontmost: read))
}
var writes=0
private let cancelled=CommandPasteGate()
cancelled.cancel()
cancelled.authorize(true)
assert(!cancelled.waitForApproval())
assert(!cancelled.begin { writes += 1 })
assert(writes==0)
private let denied=CommandPasteGate()
denied.authorize(false)
assert(!denied.waitForApproval())
private let pasted=CommandPasteGate()
pasted.authorize(true)
assert(pasted.waitForApproval())
assert(pasted.begin { writes += 1 })
pasted.cancel()
assert(writes==1)
print("Swift delayed AX selection validation and cancellation/approval/paste-boundary gate passed")
`
  const dir=mkdtempSync(join(tmpdir(),'peakflow-command-gate-'))
  try{
    const path=join(dir,'main.swift');writeFileSync(path,code)
    const result=spawnSync('swift',['-module-cache-path',process.env['SWIFTPM_MODULECACHE_OVERRIDE'] ?? process.env['CLANG_MODULE_CACHE_PATH'] ?? join(dir,'cache'),path],{encoding:'utf8',env:{...process.env,CLANG_MODULE_CACHE_PATH:join(dir,'clang')}})
    assert.equal(result.status,0,result.stdout+result.stderr);console.log(result.stdout.trim())
  }finally{rmSync(dir,{recursive:true,force:true})}
})
