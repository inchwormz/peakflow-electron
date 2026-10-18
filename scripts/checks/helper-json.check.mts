/**
 * Check: every helper reply is exactly one line of valid JSON, even when a
 * window title contains newlines, quotes or backslashes.
 *  1. Compiles the Swift encoder (JSON.swift + ActiveWindow.swift) with a
 *     small driver and round-trips tricky strings.
 *  2. If resources/darwin/peakflow-helper exists, asks the real binary for an
 *     unknown command with a newline in it (exercises respondError).
 * Run: node scripts/checks/helper-json.check.mts   (macOS only; skips elsewhere)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('helper-json check: skipped (not macOS)')
  process.exit(0)
}

const root = join(import.meta.dirname, '..', '..', 'sidecar', 'darwin', 'PeakFlowHelper')
const tricky = 'Line one\nline two "quoted" back\\slash\ttab   é 🎉'
const dir = mkdtempSync(join(tmpdir(), 'pf-json-check-'))
try {
  const bin = join(dir, 'json-check')
  const build = spawnSync('swiftc', [
    '-O', '-o', bin,
    join(root, 'Sources', 'JSON.swift'),
    join(root, 'Sources', 'ActiveWindow.swift'),
    join(root, 'Checks', 'JSONCheck', 'main.swift')
  ], { encoding: 'utf8' })
  assert.equal(build.status, 0, `swiftc failed:\n${build.stderr}`)

  const run = spawnSync(bin, [], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const lines = run.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 6, `expected 6 reply lines, got ${lines.length}:\n${run.stdout}`)
  const [win, rects, apps, proc, err, nan] = lines.map((l) => JSON.parse(l))
  assert.deepEqual(win, { pid: 42, x: 1.5, y: -2, w: 800, h: 600, title: tricky, bundleId: 'com.example.app', appName: 'App "X"\n' })
  assert.deepEqual(rects, [{ x: 0, y: 0, w: 10, h: 10 }])
  assert.deepEqual(apps, [{ exe: 'com.example.app', name: tricky }])
  assert.deepEqual(proc, { name: tricky, bundleId: 'com.example.app' })
  assert.deepEqual(err, { error: `Unknown command: ${tricky}` })
  assert.deepEqual(nan, { error: 'json encoding failed' })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const helper = join(import.meta.dirname, '..', '..', 'resources', 'darwin', 'peakflow-helper')
if (existsSync(helper)) {
  const r = spawnSync(helper, [`bad"cmd\\\nx`], { encoding: 'utf8' })
  const lines = r.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 1, `helper reply split across lines:\n${r.stdout}`)
  assert.deepEqual(JSON.parse(lines[0]), { error: 'Unknown command: bad"cmd\\\nx' })
}
console.log('helper-json check: OK')
