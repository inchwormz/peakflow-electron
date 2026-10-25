import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { test } from 'node:test'

const source = readFileSync('src/main/dictation/index.ts', 'utf8')
const preview = source.slice(source.indexOf('export async function previewDictationPill('), source.indexOf('/**\n * Development-only check of the real path'))
const code = transformSync(preview.replace('export ', ''), { loader: 'ts' }).code

test('pill shots are dev-only and send real states without starting audio', async () => {
  let dev = true, packaged = false
  const sent: any[] = [], widths: number[] = []
  const win = { webContents: { isLoading: () => false, executeJavaScript: async (js: string) => sent.push(js) } }
  const run = new Function('is', 'app', 'getPill', 'showPill', 'state', 'setTimeout', `
    const recording=false,busy=false,PILL_W=220,PILL_ERROR_W=380,isMac=true
    const settings=()=>({holdKey:'fn'}),holdKeyName=()=> 'fn',ERROR_TEXT={no_speech:'No speech heard'}
    ${code}; return previewDictationPill
  `)({ get dev() { return dev } }, { get isPackaged() { return packaged } }, () => win, (w: number) => widths.push(w), (s: any) => sent.push(s), (fn: () => void) => fn())
  for (const phase of ['listening','locked','transcribing','cancelled','error']) {
    assert.equal(await run(phase), win)
    const state = sent.at(-1)
    assert.equal(state.phase, phase === 'locked' ? 'listening' : phase)
    if (phase === 'locked') assert.equal(state.message, 'Tap fn to finish')
  }
  assert.deepEqual(widths, [220,380,220,220,380])
  dev = false
  await assert.rejects(run('listening'), /development only/)
  dev = true; packaged = true
  await assert.rejects(run('listening'), /development only/)
  assert.doesNotMatch(preview, /DICTATION_START|onDown\(|transcribe\(/)
})
