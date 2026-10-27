import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'
import { normalizeKeyword, voiceSnippets, snippetSpans, exactSnippet, expandSnippets } from '../../src/main/dictation/snippets.ts'
import { fillPlaceholders } from '../../src/main/launcher/snippet-text.ts'

const saved = (keyword: string, text = keyword, id = keyword) => ({ keyword, text, id, name: 'Display name' })
const snippets = voiceSnippets([saved(';sig', 'Regards,\nJohn $& $$ $1 sig'), saved('email sig', 'LONG'), saved('a.b2', 'DOT'), saved('café', 'CAFE')])
const expand = (text: string) => expandSnippets(text, snippetSpans(text, snippets), (t) => t, (t) => t)

test('case, sentence punctuation, whitespace and the conventional semicolon alias', () => {
  assert.equal(normalizeKeyword('  ;Email   SIG. '), 'email sig')
  assert.equal(exactSnippet('“SIG!”', snippets)?.id, ';sig')
  assert.equal(exactSnippet(';sig.', snippets)?.id, ';sig')
  assert.equal(exactSnippet('Display name', snippets), undefined)
  assert.equal(expand('Use EMAIL   sig, then A.B2.'), 'Use LONG, then DOT.')
  assert.equal(exactSnippet('a b2', snippets), undefined)
})

test('Unicode whole words, internal punctuation and digits are significant', () => {
  assert.equal(expand('design sig2 éSig sigé _sig sig\u0301'), 'design sig2 éSig sigé _sig sig\u0301')
  assert.equal(expand('café cafés décafé a.b2 aXb2 a.b23'), 'CAFE cafés décafé DOT aXb2 a.b23')
})

test('all colliding normalized keywords are disabled', () => {
  assert.deepEqual(voiceSnippets([saved(';sig'), saved('SIG.'), saved(' ; ')]), [])
  assert.deepEqual(voiceSnippets([saved('two words'), saved('Two   Words')]), [])
})

test('longest span wins, repeated triggers expand once and inserted bodies stay literal', () => {
  assert.equal(expand('email sig sig; SIG'), 'LONG Regards,\nJohn $& $$ $1 sig; Regards,\nJohn $& $$ $1 sig')
  assert.equal(expandSnippets('hello sig', snippetSpans('hello sig', snippets), (s) => s.replace('hello', 'Hello'), (s) => s), 'Hello Regards,\nJohn $& $$ $1 sig')
})

test('shared placeholders preserve local dates, time and literal clipboard characters without recursion', () => {
  const now = new Date(2026, 9, 26, 13, 5)
  assert.equal(fillPlaceholders('{date} {time} {clipboard}', () => '$& $$ $1 {date} sig', now),
    `${now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} $& $$ $1 {date} sig`)
})

const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
test('setting defaults off, is published independently, and only accepts a trusted boolean mutation', async () => {
  assert.match(main, /defaults: \{[^\n]*voiceSnippets: false/)
  assert.match(main, /voiceSnippets: store.get\('voiceSnippets'\)/)
  const start = main.indexOf('serialised(IPC_INVOKE.DICTATION_SET,')
  const source = main.slice(start, main.indexOf('  serialised(IPC_INVOKE.DICTATION_SAVE_KEY', start))
  const js = transformSync(source, { loader: 'ts' }).code
  const boot = new Function(`
    const isMac=false; let commandSession=null;
    let handler; const data={voiceSnippets:false}
    const serialised=(channel,fn)=>handler=fn,IPC_INVOKE={},fromUi=e=>e.trusted===true
    const store={get:k=>data[k],set:(k,v)=>data[k]=v},settings=()=>({enabled:false}),settingsWithHint=()=>data
    const applyWatcher=()=>{},settingsChanged=()=>{}
    ${js}
    return {data,set:(trusted,value)=>handler({trusted},'voiceSnippets',value)}
  `)()
  await boot.set(false, true); assert.equal(boot.data.voiceSnippets, false)
  for (const value of ['true', 1, {}, null]) await boot.set(true, value)
  assert.equal(boot.data.voiceSnippets, false)
  await boot.set(true, true); assert.equal(boot.data.voiceSnippets, true)
  await boot.set(true, false); assert.equal(boot.data.voiceSnippets, false)
})
