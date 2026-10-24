import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { transformSync } from 'esbuild'
import { csharpNativeKeyDecision, nativeKeyDecision } from '../../src/main/launcher/native-key-state.ts'
import { NativeKeyState } from '../../src/main/launcher/native-key-state.ts'
import { KeyTaps } from '../../src/main/launcher/key-taps.ts'
const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8')
const ev=(code:number,down:boolean,physical:number[]=[],repeat=false)=>({code,down,up:!down,repeat,physical:new Set(physical),modifier:code===163,suppress:code!==163,otherModifier:false})
test('[K1] repeat during capture forwards both repeat and release, then records fresh press',()=>{
 const s=new NativeKeyState();s.feed(ev(65,true,[65]));s.configure(163,true,new Set([65]));
 assert.equal(s.feed(ev(65,true,[65],true)).swallow,false)
 assert.equal(s.feed(ev(65,false)).swallow,false)
 assert.equal(s.feed(ev(112,true,[112])).recorded,112)
 s.configure(163,false,new Set([112]));assert.equal(s.feed(ev(112,false)).swallow,true)
})
test('[K1] held before watcher/capture start is ignored even without observed initial down',()=>{
 const s=new NativeKeyState();s.configure(163,true,new Set([65]));
 assert.equal(s.feed(ev(65,true,[65])).recorded,undefined)
 assert.equal(s.feed(ev(65,false)).swallow,false)
 assert.equal(s.feed(ev(27,true,[27])).recorded,27,'Esc cancels through main');assert.equal(s.feed(ev(27,false)).swallow,true)
})
test('[K2] lost release recovers modifier hold and double tap',()=>{
 const s=new NativeKeyState();s.configure(163,false,new Set());s.feed(ev(65,true,[65]))
 const taps=new KeyTaps();const actions:string[]=[];let time=1000
 for(const down of [true,false,true,false]) for(const a of s.feed(ev(163,down,down?[163]:[])).events) actions.push(...taps.feed(a,time+=50))
 assert.deepEqual(actions,['down','up','double'])
})
test('[K6] settings change and interruption cancel holds; unmatched releases pass',()=>{
 const s=new NativeKeyState();s.configure(163,false,new Set());assert.deepEqual(s.feed(ev(163,true,[163])).events,['down'])
 assert.deepEqual(s.configure(112,false,new Set([163])),['cancel']);assert.deepEqual(s.feed(ev(163,false)).events,[])
 assert.equal(s.feed(ev(112,false)).swallow,false)
 s.feed(ev(112,true,[112]));assert.deepEqual(s.interrupt(),['cancel']);assert.deepEqual(s.feed(ev(112,false)).events,[])
})
function windowsScript(): string {
 const shell=read('src/main/launcher/windows-key-state.ts')
 const mod={exports:{} as any}
 new Function('module','exports','require',transformSync(shell,{loader:'ts',format:'cjs'}).code)(mod,mod.exports,()=>({csharpNativeKeyDecision}))
 const hook=read('src/main/launcher/expander.ts')
 const start=hook.indexOf('const WIN_HOOK =')
 const literal=hook.slice(start,hook.indexOf('\n`',start)+2)
 return new Function('windowsKeyStateSource',literal+';return WIN_HOOK')(mod.exports.windowsKeyStateSource)
}
test('[K6] unchanged configuration preserves a hold; chords cancel and releases stay paired',()=>{
 const s=new NativeKeyState();s.configure(163,false,new Set())
 assert.deepEqual(s.feed(ev(163,true,[163])).events,['down'])
 assert.deepEqual(s.configure(163,false,new Set([163])),[])
 assert.deepEqual(s.feed(ev(65,true,[163,65])).events,['cancel'])
 assert.deepEqual(s.feed(ev(163,false,[65])).events,[])
 const f=new NativeKeyState();f.configure(112,false,new Set())
 assert.equal(f.feed(ev(112,true,[112])).swallow,true)
 f.configure(113,false,new Set([112]))
 assert.equal(f.feed(ev(112,false)).swallow,true)
 const capture=new NativeKeyState();capture.configure(163,true,new Set())
 assert.equal(capture.feed(ev(65,true,[65],true)).recorded,undefined)
 assert.equal(capture.feed(ev(65,false)).swallow,false)
})
test('[K5] Windows generated source compiles when tools exist; otherwise assembly coverage',()=>{
 const script=windowsScript()
 const refs=script.match(/-ReferencedAssemblies ([^\n]+)/)?.[1]??''
 const namespaces:Record<string,string>={System:'mscorlib', 'System.Collections.Generic':'System.Core', 'System.Diagnostics':'System', 'System.Runtime.InteropServices':'mscorlib', 'System.Text':'mscorlib', 'System.Threading':'mscorlib', 'System.Windows.Forms':'System.Windows.Forms'}
 for(const ns of script.matchAll(/^using ([\w.]+);/gm)) {
   const assembly=namespaces[ns[1]];assert.ok(assembly,`unmapped namespace ${ns[1]}`)
   if(assembly!=='mscorlib') assert.ok(refs.split(/[ ,]/).includes(assembly),`missing reference ${assembly} (${ns[1]})`)
 }
 assert.match(script,/HashSet<uint>/);assert.match(refs,/System.Core/)
 const compiler=['mcs','csc','dotnet'].find(tool=>spawnSync('which',[tool],{encoding:'utf8'}).status===0)
 if(!compiler) {console.log('No dotnet, mcs or csc available: Windows compilation/runtime unverified; assembly coverage checked');return}
 const dir=mkdtempSync(join(tmpdir(),'peakflow-csharp-'))
 try {
   const cs=script.split('$src = @"')[1].split('"@')[0]
   writeFileSync(join(dir,'Hook.cs'),cs)
   let result
   if(compiler==='dotnet') {
     // Full hook needs Windows Forms targeting packs; fail rather than silently skipping it.
     writeFileSync(join(dir,'Hook.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0-windows</TargetFramework><EnableWindowsTargeting>true</EnableWindowsTargeting><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>')
     result=spawnSync('dotnet',['build',join(dir,'Hook.csproj'),'--nologo'],{encoding:'utf8'})
   } else {
     result=spawnSync(compiler,['-target:library','-r:System.dll','-r:System.Core.dll','-r:System.Windows.Forms.dll',`-out:${join(dir,'Hook.dll')}`,join(dir,'Hook.cs')],{encoding:'utf8'})
   }
   assert.equal(result.status,0,result.stdout+result.stderr)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('[K6] generated C# decision table matches executable TS for every boolean combination',()=>{
 const cs=csharpNativeKeyDecision(), names=[...cs.matchAll(/bool (\w+)/g)].map(m=>m[1])
 const js=cs.slice(cs.indexOf('{')+1,cs.lastIndexOf('}')).replace('int result','let result')
 const decide=new Function(...names,js)
 for(let bits=0;bits<2**names.length;bits++) {
   const values=names.map((_,i)=>!!(bits&(1<<i)))
   assert.equal(decide(...values),nativeKeyDecision(Object.fromEntries(names.map((n,i)=>[n,values[i]])) as any))
 }
 const script=windowsScript()
 assert.ok(script.includes(csharpNativeKeyDecision()),'the actual hook includes shared decisions')
 assert.match(script,/keyState.Feed/);assert.match(script,/GetAsyncKeyState/);assert.match(script,/lock \(keyLock\)/)
 const swift=read('sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift')
 assert.match(swift,/nativeKeyState.feed/);assert.match(swift,/nativeKeyState.interrupt/)
 assert.match(swift,/keyboardEventAutorepeat/);assert.match(swift,/CGEventSource.keyState\(.combinedSessionState/)
})
test('[K6] standalone Swift state machine executes the native sequences',()=>{
 const dir=mkdtempSync(join(tmpdir(),'peakflow-key-state-'))
 try{
 const source=read('sidecar/darwin/PeakFlowHelper/Sources/NativeKeyState.swift')
 writeFileSync(join(dir,'main.swift'),source+'\n'+read('scripts/checks/native-key-state.swift'))
 const r=spawnSync('swift',['-module-cache-path',join(dir,'cache'),join(dir,'main.swift')],{encoding:'utf8',env:{...process.env,CLANG_MODULE_CACHE_PATH:join(dir,'clang')}})
 assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim())
 }finally{rmSync(dir,{recursive:true,force:true})}
})
