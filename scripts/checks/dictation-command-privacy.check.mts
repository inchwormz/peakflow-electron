import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { commandHarness, tick } from './command-harness.mts'
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
const main=read('src/main/dictation/index.ts')
const commands=main.slice(main.indexOf('function commandDown()'),main.indexOf('function onDown()'))
test('command implementation has no persistent content, logs, retry, snippet or context entry point',()=>{
  assert.doesNotMatch(commands,/console\.|keepClip\(|keptClip|last\s*=|rememberTyped|addHistory|store\.set|readContext|transcriptionPrompt|parseMyWords|applyReplacements|expandSnippets|typeText\(/)
  assert.match(main,/if \(isMac && commandSession\) return runCommandAudio/)
  assert.match(main,/commandSession.abort.abort\(\)/)
  assert.match(main,/onCredentialsChanged\(\(\) => \{ if \(commandSession && clipOwner\(\) !== commandSession.owner\) cancelCommand\(\)/)
})
test('successful commands send no selection or surrounding context to transcription',async()=>{
  const h=commandHarness();h.start();h.capture();await tick();await h.advance(400);h.up();const audio=h.audio();await tick()
  const stt=h.requests.at(-1);assert.equal(stt.opts.prompt,undefined);assert.equal(stt.opts.durationMs,550)
  h.stt({ok:true,text:'Shorten'});await tick();h.rewrite({ok:true,text:'Short'});await tick();h.pasteStart();h.paste(true);await audio
  assert.equal(h.snapshot().busy,false);assert.equal(h.phases.at(-1).phase,'done')
})
test('Windows generated hook source and ordinary smart/history implementations are byte-for-byte unchanged from task base',()=>{
  const baseline=(p:string)=>execFileSync('git',['show',`f02382c:${p}`],{encoding:'utf8'})
  // The emitted script literal ends before the native watcher lifecycle.
  const literal=(s:string)=>{const start=s.indexOf('const WIN_HOOK =');return s.slice(start,s.indexOf('\n`',start)+2)}
  assert.equal(literal(read('src/main/launcher/expander.ts')),literal(baseline('src/main/launcher/expander.ts')))
  for(const p of ['src/main/launcher/windows-key-state.ts','src/main/dictation/smart.ts','src/main/dictation/history.ts'])assert.equal(read(p),baseline(p),p)
  const selection=(s:string)=>s.slice(s.indexOf('async function winSelection('),s.indexOf('export async function getSelectedText'))
  assert.equal(selection(read('src/main/launcher/selection.ts')),selection(baseline('src/main/launcher/selection.ts')))
  const ui=read('src/renderer/src/panel/tools/dictation/index.tsx');assert.match(ui,/isMac\(\) \? <>[\s\S]*label="Command mode"/)
  assert.match(main,/commandMode: isMac && store.get\('commandMode'\)/)
})
