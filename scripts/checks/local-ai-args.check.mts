/**
 * Check: the ChatGPT (Codex) call switches off Codex's plugins, apps and tool
 * notes for our calls, uses our short instructions, and stays a read-only,
 * throwaway run. The Claude call is unchanged.
 * Run: node scripts/checks/local-ai-args.check.mts
 * Live (uses the signed-in Codex on this computer, about 16k tokens):
 *   PEAKFLOW_LIVE_AI=1 node scripts/checks/local-ai-args.check.mts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliArgs, CODEX_LEAN_CONFIG, CODEX_BASE_INSTRUCTIONS } from '../../src/main/services/local-ai-args.ts'

const codex = cliArgs('codex', { model: 'gpt-6-luna', system: 'sys', codexInstructionsFile: '/Users/a b/PeakFlow/local-ai/codex-instructions.md' })
const pairs = new Set(codex.flatMap((a, i) => (a === '-c' ? [codex[i + 1]] : [])))
for (const c of CODEX_LEAN_CONFIG) assert.ok(pairs.has(c), `missing -c ${c}`)
for (const c of ['features.plugins=false', 'features.apps=false', 'features.memories=false', 'include_environment_context=false']) assert.ok(pairs.has(c), c)
assert.ok(pairs.has('model_instructions_file="/Users/a b/PeakFlow/local-ai/codex-instructions.md"'))
assert.deepEqual(codex.slice(0, 6), ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only'])
assert.equal(codex.at(-1), '-')
assert.deepEqual(codex.slice(-3, -1), ['--model', 'gpt-6-luna'])
// Only config overrides were added, never new flags an older Codex might refuse
assert.deepEqual(codex.filter((a) => a.startsWith('-')), ['--json', '--skip-git-repo-check', '--ephemeral', '-s', ...Array(pairs.size).fill('-c'), '--model', '-'])

// Windows paths are escaped for TOML
const win = cliArgs('codex', { model: null, system: 's', codexInstructionsFile: 'C:\\Users\\Jo "x"\\codex.md' })
assert.ok(win.includes('model_instructions_file="C:\\\\Users\\\\Jo \\"x\\"\\\\codex.md"'))
assert.ok(!win.includes('--model'))
// No file (a .cmd install run through a shell): Codex keeps its own instructions
assert.ok(!cliArgs('codex', { model: null, system: 's', codexInstructionsFile: null }).some((a) => a.startsWith('model_instructions_file')))

const claude = cliArgs('claude', { model: 'haiku', system: 'sys' })
assert.deepEqual(claude, ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--no-session-persistence',
  '--strict-mcp-config', '--setting-sources', '', '--model', 'haiku', '--system-prompt', 'sys'])
console.log('local-ai-args: ok')

if (process.env.PEAKFLOW_LIVE_AI === '1') {
  const dir = mkdtempSync(join(tmpdir(), 'pf-ai-'))
  const file = join(dir, 'codex-instructions.md')
  writeFileSync(file, CODEX_BASE_INSTRUCTIONS)
  const r = spawnSync('codex', cliArgs('codex', { model: 'gpt-6-luna', system: '', codexInstructionsFile: file }), {
    cwd: dir, input: 'Reply with the word OK.', encoding: 'utf8', timeout: 120_000
  })
  const done = r.stdout.split('\n').find((l) => l.includes('"turn.completed"'))
  assert.ok(done, `no reply: ${r.stderr.slice(0, 300)}`)
  const used = (JSON.parse(done) as { usage: { input_tokens: number } }).usage.input_tokens
  console.log(`local-ai-args live: ${used} input tokens`)
  assert.ok(used < 22_000, `Codex call used ${used} input tokens`)
}
