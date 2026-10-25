import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
const mod = { exports: {} as any }
new Function('module', 'exports', buildSync({ entryPoints: ['src/main/dictation/history.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(mod, mod.exports)
const { addHistory, mayKeepHistory } = mod.exports

test('history keeps only newest 25 typed texts, without audio or context', () => {
  let list: ReturnType<typeof addHistory> = []
  for (let i = 0; i < 30; i++) list = addHistory(list, { text: `text ${i}`, at: i, app: 'Mail', buf: 'audio' } as any)
  assert.equal(list.length, 25); assert.equal(list[0].text, 'text 29'); assert.equal(list[24].text, 'text 5')
  assert.deepEqual(Object.keys(list[0]).sort(), ['app', 'at', 'text'])
})
test('off, password fields, unknown security and privacy apps skip history', () => {
  const safe = { secure: false, app: 'Mail', appId: 'com.apple.mail', title: 'Hello' }
  assert.equal(mayKeepHistory(true, safe), true)
  assert.equal(mayKeepHistory(false, safe), false)
  assert.equal(mayKeepHistory(true, { ...safe, secure: true }), false)
  assert.equal(mayKeepHistory(true, { app: 'Mail' }), false)
  for (const ctx of [{ ...safe, appId: 'com.1password.1password' }, { ...safe, title: 'ANZ Internet Banking - Chrome' }]) assert.equal(mayKeepHistory(true, ctx), false)
})

const { readFileSync } = await import('node:fs')
const { transformSync } = await import('esbuild')
const main = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const extract = (source: string, start: string, end: string) => transformSync(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), { loader: 'ts' }).code

test('actual history writer honors off, clear generation, private paste target; stats remain independent', () => {
  const run = new Function('addHistory', 'mayKeepHistory', `
    let historyRevision=1, changes=0
    const data={keepHistory:true,history:[],weekly:undefined}
    const store={get:k=>data[k],set:(k,v)=>data[k]=v},settingsChanged=()=>changes++
    const addWeekly=(s,text,ms)=>({words:(s?.words??0)+text.split(' ').length,spokenSeconds:ms/1000})
    ${extract(main, 'function rememberTyped(', '/** Tap, or another key')}
    return {data,write:rememberTyped,clear:()=>{historyRevision++;data.history=[]}}
  `)(addHistory, mayKeepHistory)
  const safe = { secure: false, app: 'Mail', historyRevision: 1 }
  run.write('hello there', safe, safe, 1000)
  assert.equal(run.data.history.length, 1)
  run.write('private target', safe, { secure: true }, 1000)
  assert.equal(run.data.history.length, 1)
  run.clear(); run.write('old pending', safe, safe, 1000)
  assert.equal(run.data.history.length, 0, 'clear cannot be undone by pending clip')
  run.data.keepHistory = false
  run.write('off now', { ...safe, historyRevision: 2 }, safe, 1000)
  assert.equal(run.data.history.length, 0)
  assert.equal(run.data.weekly.words, 8, 'counts work with history off, without text retention')
})

test('Windows privacy is sampled inside serialized paste after clipboard setup', async () => {
  const selection = readFileSync(new URL('../../src/main/launcher/selection.ts', import.meta.url), 'utf8')
  const code = extract(selection, 'export function pasteAndRestore(', 'async function winSelection(').replace('export ', '')
  let destination = { secure: false, app: 'Mail' }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let captured: any
  const paste = new Function('process', 'oneAtATime', 'ownerHwnd', 'saveAndWriteOwnText', 'simulateCtrlV', 'sleep', 'restoreWinClipboard', code + ';return pasteAndRestore')(
    { platform: 'win32' }, async (fn: () => unknown) => { await gate; return fn() }, () => 0,
    async () => ({ saved: {}, stamp: {} }), async () => true, async () => {}, async () => true
  )
  const pending = paste('example', { read: async () => destination, capture: (p: any) => { captured = p } })
  destination = { secure: true, app: '1Password' }; release()
  assert.equal(await pending, true)
  assert.notEqual(captured.secure, false)
  assert.equal(mayKeepHistory(true, captured), false)
  const swift = readFileSync(new URL('../../sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift', import.meta.url), 'utf8')
  const body = swift.slice(swift.indexOf('func pasteTextRestoring'), swift.indexOf('/// Our own synthetic'))
  assert.ok(body.indexOf('guard let lock = lockPasteboard()') < body.indexOf('dictationContext(includeText: false)'))
  assert.ok(body.indexOf('dictationContext(includeText: false)') < body.indexOf('var result = sendPaste()'))
})

test('Windows history requires the same confirmed non-password element before and after paste', async () => {
  const selection = readFileSync(new URL('../../src/main/launcher/selection.ts', import.meta.url), 'utf8')
  const code = extract(selection, 'export function pasteAndRestore(', 'async function winSelection(').replace('export ', '')
  const safe = { secure: false, focusId: '100:200:1,2', app: 'Mail' }
  for (const after of [safe, { ...safe, secure: true }, { ...safe, focusId: '100:200:1,3' }, { ...safe, focusId: undefined }, {}]) {
    let reads = 0, captured: any, typed = 0
    const paste = new Function('process', 'oneAtATime', 'ownerHwnd', 'saveAndWriteOwnText', 'simulateCtrlV', 'sleep', 'restoreWinClipboard', code + ';return pasteAndRestore')(
      { platform: 'win32' }, async (fn: () => unknown) => fn(), () => 0,
      async () => ({ saved: {}, stamp: {} }), async () => { typed++; return true }, async () => {}, async () => true
    )
    assert.equal(await paste('secret', { read: async () => reads++ === 0 ? safe : after, capture: (p: any) => { captured = p } }), true)
    assert.equal(typed, 1)
    assert.equal(reads, 2)
    assert.equal(mayKeepHistory(true, captured), after === safe)
  }
  assert.match(main, /GetRuntimeId/)
  assert.match(main, /focusId:/)
})

test('temporary password focus cannot retain secret-shaped text; sentences still count and persist', async () => {
  const selection = readFileSync(new URL('../../src/main/launcher/selection.ts', import.meta.url), 'utf8')
  const pasteCode = extract(selection, 'export function pasteAndRestore(', 'async function winSelection(').replace('export ', '')
  const writer = new Function('addHistory', 'mayKeepHistory', `
    const historyRevision=1,data={keepHistory:true,history:[],weekly:0}
    const store={get:k=>data[k],set:(k,v)=>data[k]=v},settingsChanged=()=>{}
    const addWeekly=(n)=>n+1
    ${extract(main, 'function rememberTyped(', '/** Tap, or another key')}
    return {data,write:rememberTyped}
  `)(addHistory, mayKeepHistory)
  const editor = { secure: false, focusId: 'editor', app: 'Editor', historyRevision: 1 }
  for (const text of ['Password123!', 'ordinary words in a sentence']) {
    let destination: any = editor, captured: any
    const order: string[] = []
    const paste = new Function('process', 'oneAtATime', 'ownerHwnd', 'saveAndWriteOwnText', 'simulateCtrlV', 'sleep', 'restoreWinClipboard', pasteCode + ';return pasteAndRestore')(
      { platform: 'win32' }, async (fn: () => unknown) => fn(), () => 0,
      async () => ({ saved: {}, stamp: {} }), async () => {
        order.push('paste')
        // Password gets the paste, then focus returns before either sampler can see it.
        destination = { secure: true, focusId: 'password' }
        destination = editor
        return true
      }, async () => { order.push('clipboard wait') }, async () => true
    )
    assert.equal(await paste(text, { read: async () => { order.push('sample'); return destination }, capture: (p: any) => { captured = p } }), true)
    assert.deepEqual(order, ['sample', 'paste', 'sample', 'clipboard wait'])
    writer.write(text, editor, captured, 1000)
  }
  assert.deepEqual(writer.data.history.map((entry: any) => entry.text), ['ordinary words in a sentence'])
  assert.equal(writer.data.weekly, 2, 'stats count both pastes without retaining the secret')
})

test('secret shape requires eight characters, one token, and two character classes', () => {
  const safe = { secure: false, app: 'Editor' }
  for (const text of ['password1', 'Password', '1234567!', 'éÉéééééé', 'abcdefg!']) assert.equal(mayKeepHistory(true, safe, text), false, text)
  for (const text of ['short1!', 'ordinary', '12345678', 'ordinary sentence', 'Hello world!']) assert.equal(mayKeepHistory(true, safe, text), true, text)
})
