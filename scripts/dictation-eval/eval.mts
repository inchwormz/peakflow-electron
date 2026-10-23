/**
 * Dictation test set: 12 spoken cases (made with macOS `say`, no microphone)
 * through the app's own transcribe.ts and smart.ts, against OpenAI.
 *
 *   OPENAI_API_KEY=… node --experimental-strip-types scripts/dictation-eval/eval.mts [models|latency|all]
 *
 * Reports word errors, name errors and intent errors per setup, and timings.
 * Costs about 2 US cents per full run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { transcribe, warmConnection } from '../../src/main/dictation/transcribe.ts'
import { parseMyWords, transcriptionPrompt, cleanUp, intentGuard, needsTidy, type MyWords } from '../../src/main/dictation/smart.ts'

const here = dirname(fileURLToPath(import.meta.url))
const key = process.env.OPENAI_API_KEY ?? ''
if (!key) throw new Error('OPENAI_API_KEY not set')
const mode = process.argv[2] ?? 'all'

interface Case { id: string; voice: string; say: string; ref: string; must: string[]; mustNot?: string[]; cleanMustNot?: string[]; ctx?: { app?: string; before?: string } }
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf-8')) as Case[]
const words: MyWords = parseMyWords(readFileSync(join(here, 'words.txt'), 'utf-8'))

mkdirSync(join(here, 'audio'), { recursive: true })
const audio = (c: Case): Uint8Array => {
  const f = join(here, 'audio', `${c.id}.wav`)
  if (!existsSync(f)) execFileSync('say', ['-v', c.voice, '-o', f, '--data-format=LEI16@16000', c.say])
  return new Uint8Array(readFileSync(f))
}

// ─── scoring ─────────────────────────────────────────────────────────────────

const NUM: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twelve: '12', fifteen: '15', thirty: '30', fourteenth: '14th' }
const norm = (t: string): string[] =>
  t.toLowerCase().replace(/p\.m\./g, 'pm').replace(/(\d),(\d)/g, '$1$2').replace(/[$.,:;!?"“”]/g, ' ').replace(/['’]/g, "'")
    .split(/\s+/).filter(Boolean).map((w) => NUM[w] ?? w)

function wer(hyp: string, ref: string): number {
  const h = norm(hyp), r = norm(ref)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)] as number[])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}

/** Listed names that the reference contains but the output misspells (exact spelling). */
const nameErrors = (out: string, c: Case): string[] => words.hints.filter((h) => new RegExp(`\\b${h}\\b`).test(c.ref) && !new RegExp(`\\b${h}\\b`).test(out))

function intentErrors(out: string, c: Case, cleaned: boolean): string[] {
  const errs: string[] = []
  for (const m of c.must) if (!new RegExp(m, 'i').test(out)) errs.push(`missing /${m}/`)
  for (const m of c.mustNot ?? []) if (new RegExp(m).test(out)) errs.push(`has /${m}/`)
  if (cleaned) for (const m of c.cleanMustNot ?? []) if (new RegExp(m, 'i').test(out)) errs.push(`kept /${m}/`)
  if (/^\s*(hi|hello|dear|subject)/i.test(out) && !/^\s*(hi|hello|dear)/i.test(c.ref)) errs.push('added greeting')
  return errs
}

// ─── runs ────────────────────────────────────────────────────────────────────

interface Row { id: string; out: string; ms: number; wer: number; names: string[]; intent: string[]; note?: string }
const results: Record<string, Row[]> = {}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function setup(name: string, fn: (c: Case) => Promise<{ out: string; ms: number; cleaned?: boolean; note?: string }>): Promise<void> {
  const rows: Row[] = []
  for (const c of cases) {
    const r = await fn(c)
    rows.push({ id: c.id, out: r.out, ms: r.ms, wer: wer(r.out, c.ref), names: nameErrors(r.out, c), intent: intentErrors(r.out, c, !!r.cleaned), note: r.note })
  }
  results[name] = rows
  const n = rows.length
  const avg = (f: (r: Row) => number): number => rows.reduce((s, r) => s + f(r), 0) / n
  console.log(`\n## ${name}\nword error ${(avg((r) => r.wer) * 100).toFixed(1)}% · name errors ${rows.reduce((s, r) => s + r.names.length, 0)} · intent errors ${rows.reduce((s, r) => s + r.intent.length, 0)} · avg ${Math.round(avg((r) => r.ms))} ms`)
  for (const r of rows) console.log(`  ${r.id.padEnd(20)} ${String(r.ms).padStart(5)}ms  ${r.intent.length || r.names.length ? '✗' : '✓'} ${JSON.stringify(r.out)}${r.names.length ? ` names:${r.names}` : ''}${r.intent.length ? ` intent:${r.intent.join('; ')}` : ''}${r.note ? ` (${r.note})` : ''}`)
}

const raw: Record<string, string> = {}

if (mode === 'all' || mode === 'models') {
  await setup('A: today (gpt-transcribe, no hints)', async (c) => {
    const t0 = Date.now()
    const r = await transcribe(audio(c), { key, mime: 'audio/wav' })
    return { out: r.text ?? `[${r.error}]`, ms: Date.now() - t0 }
  })
  await setup('B: + My words and app context as hints', async (c) => {
    const t0 = Date.now()
    const r = await transcribe(audio(c), { key, mime: 'audio/wav', prompt: transcriptionPrompt(words, c.ctx ?? {}) })
    raw[c.id] = r.text ?? ''
    return { out: r.text ?? `[${r.error}]`, ms: Date.now() - t0 }
  })
  for (const model of (process.env.CLEANUP_MODELS ?? 'gpt-4.1-nano,gpt-5.4-nano,gpt-4.1-mini').split(',')) {
    await setup(`C: B + light clean-up (${model})`, async (c) => {
      const r = await cleanUp(raw[c.id], { key, words, ctx: c.ctx ?? {}, model })
      return { out: r.text, ms: r.ms, cleaned: r.cleaned, note: r.rejected ? `guard used raw: ${r.rejected}` : undefined }
    })
  }
  await setup('D: shipped (hints + clean-up only when needed, gpt-4.1-nano)', async (c) => {
    if (!needsTidy(raw[c.id], words)) return { out: raw[c.id], ms: 0, cleaned: false, note: 'clean-up not needed' }
    const r = await cleanUp(raw[c.id], { key, words, ctx: c.ctx ?? {} })
    return { out: r.text, ms: r.ms, cleaned: r.cleaned, note: r.rejected ? `guard used raw: ${r.rejected}` : undefined }
  })
  // The guard itself on known-bad rewrites (no API)
  const bad: Array<[string, string]> = [
    ['Please do not send the contract.', 'Please send the contract.'],
    ['The quote is $4,250 plus GST.', 'The quote is $4,000 plus GST.'],
    ['Ask Siobhan to review it.', 'Ask her to review it.'],
    ['Move the launch to next week.', 'Hi, move the launch to next week.'],
    ['Book the meeting for Tuesday, no wait, Wednesday.', 'Book the meeting for Wednesday.']
  ]
  console.log('\n## Guard on hand-made rewrites (should block the first four, allow the last)')
  for (const [r, c] of bad) console.log(`  ${intentGuard(r, c, words) ?? 'allowed'}  ←  ${JSON.stringify(c)}`)
}

if (mode === 'all' || mode === 'latency') {
  console.log('\n## Latency: release → final text (6 cases each)')
  const pick = cases.slice(0, 6)
  const time = async (label: string, opts: { stream: boolean; warm: boolean }): Promise<void> => {
    const ms: number[] = []
    for (const c of pick) {
      await sleep(opts.warm ? 300 : 6500) // cold: let the kept-alive connection close first
      if (opts.warm) {
        warmConnection(key)
        await sleep(1200) // the person is still talking
      }
      const t0 = Date.now()
      const r = await transcribe(audio(c), { key, mime: 'audio/wav', prompt: transcriptionPrompt(words, c.ctx ?? {}), stream: opts.stream })
      ms.push(Date.now() - t0)
      if (!r.ok) console.log(`   ${c.id}: ${r.error} ${r.detail ?? ''}`)
    }
    ms.sort((a, b) => a - b)
    console.log(`  ${label.padEnd(26)} median ${ms[Math.floor(ms.length / 2)]} ms  (${ms.join(', ')})`)
  }
  await time('cold, not streamed', { stream: false, warm: false })
  await time('cold, streamed', { stream: true, warm: false })
  await time('warmed, not streamed', { stream: false, warm: true })
  await time('warmed, streamed', { stream: true, warm: true })
}

writeFileSync(join(here, 'last-results.json'), JSON.stringify(results, null, 2))
