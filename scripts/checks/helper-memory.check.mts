/**
 * Persistent helper autorelease-pool regression (macOS, built helper required).
 * Runs 400 warm-up + 4,000 measured requests, 90% active-window / 10% all-windows,
 * sequentially awaiting and validating every request-ID-prefixed JSON reply.
 * Calibration on Apple silicon, 2026-10-30 (release builds, restricted session):
 * old origin/master e8e023c: 2,736,584 -> 4,473,288 B (+1,736,704 B);
 * new: 2,654,664 -> 2,671,048 B (+16,384 B). Repeat: old +1,720,320 B,
 * new +16,384 B. Limit: 1 MiB, between the observed old and new growth.
 * footprint/vmmap inspection is denied in that session; calibration used the
 * kernel ri_phys_footprint counter via proc_pid_rusage, also the fallback below.
 * These restricted-session runs do not replace a signed-in desktop soak.
 * Override HELPER_MEMORY_BINARY only to compare an independently built baseline.
 * Run: node scripts/checks/helper-memory.check.mts
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

if (process.platform !== 'darwin') {
  console.log('helper-memory check: skipped (not macOS)')
  process.exit(0)
}

const root = resolve(import.meta.dirname, '..', '..')
const build = join(root, 'sidecar', 'darwin', 'PeakFlowHelper', '.build')
const triple = process.arch === 'arm64' ? 'arm64-apple-macosx' : 'x86_64-apple-macosx'
const override = process.env['HELPER_MEMORY_BINARY']
const binary = override ?? [
  join(build, triple, 'release', 'PeakFlowHelper'),
  join(build, 'release', 'PeakFlowHelper'),
  join(build, 'PeakFlowHelper-universal'),
  join(root, 'resources', 'darwin', 'peakflow-helper'),
  join(build, triple, 'debug', 'PeakFlowHelper'),
  join(build, 'debug', 'PeakFlowHelper')
].find(existsSync)
if (!binary) {
  console.log('helper-memory check: skipped (built helper missing)')
  process.exit(0)
}
assert.ok(existsSync(binary), `helper binary missing: ${binary}`)

// footprint's task-read entitlement may be unavailable even for our own child.
// libproc exposes the physical-footprint counter without a Mach task port.
let probeDir: string | undefined
let fallbackAnnounced = false
function physicalFootprint(pid: number): number {
  const result = spawnSync('/usr/bin/footprint', [String(pid)], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024
  })
  if (result.status === 0) {
    const match = /\bFootprint:\s*([\d.]+)\s*(B|KB|MB|GB|TB)\b/.exec(result.stdout)
    assert.ok(match, `footprint summary missing:\n${result.stdout}`)
    const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
    return Number(match[1]) * scale[match[2] as keyof typeof scale]
  }
  if (!probeDir) {
    probeDir = mkdtempSync(join(tmpdir(), 'pf-memory-probe-'))
    const compile = spawnSync('/usr/bin/clang', ['-x', 'c', '-', '-o', join(probeDir, 'footprint')], {
      encoding: 'utf8', timeout: 30_000,
      input: `#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    struct rusage_info_v0 usage = {0};
    if (argc != 2 || proc_pid_rusage(atoi(argv[1]), RUSAGE_INFO_V0, (rusage_info_t *)&usage) != 0) {
        perror("proc_pid_rusage");
        return 1;
    }
    printf("%llu\\n", (unsigned long long)usage.ri_phys_footprint);
    return 0;
}`
    })
    assert.equal(compile.status, 0,
      `footprint unavailable (${result.error ?? result.stderr}); libproc probe build failed: ${compile.error ?? compile.stderr}`)
  }
  const probe = spawnSync(join(probeDir, 'footprint'), [String(pid)], { encoding: 'utf8', timeout: 5000 })
  assert.equal(probe.status, 0, `physical-footprint probe failed: ${probe.error ?? probe.stderr}`)
  const bytes = Number(probe.stdout.trim())
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0, `invalid physical footprint: ${probe.stdout}`)
  if (!fallbackAnnounced) {
    console.log('helper-memory: footprint unavailable; using proc_pid_rusage ri_phys_footprint (system C compiler)')
    fallbackAnnounced = true
  }
  return bytes
}

const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
const lines = createInterface({ input: child.stdout })
const replies = lines[Symbol.asyncIterator]()
let stderr = ''
child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096) })
// Observe errors immediately, including spawn failures before the first request.
const ended = new Promise<string>((resolve) => {
  child.once('error', (error) => resolve(error.message))
  child.once('close', (code, signal) => resolve(`exit ${code}, signal ${signal}`))
})
let requestId = 0
async function send(command: string): Promise<unknown> {
  const id = String(++requestId)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const reply = replies.next()
    child.stdin.write(`${id} ${command}\n`)
    const line = await Promise.race([
      reply,
      ended.then((reason) => { throw new Error(`helper ${reason}: ${stderr}`) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`helper timed out on ${command}: ${stderr}`)), 5000)
      })
    ])
    assert.ok(!line.done, `helper stdout closed: ${stderr}`)
    assert.ok(line.value.startsWith(`${id} `), `wrong request ID: ${line.value}`)
    return JSON.parse(line.value.slice(id.length + 1))
  } finally {
    clearTimeout(timer)
  }
}
async function poll(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const allWindows = i % 10 === 0
    const result = await send(allWindows ? 'all-windows' : 'active-window')
    if (allWindows) assert.ok(Array.isArray(result), 'all-windows must return an array')
    else assert.ok(result === null || (typeof result === 'object' && result !== null && 'pid' in result),
      'active-window must return window info or null')
  }
  // A following reply guarantees the preceding command's autorelease pool drained
  // before footprint samples a process otherwise waking up from its stdout write.
  assert.equal(await send('ping'), 'pong')
}

try {
  await poll(400)
  assert.ok(child.pid, 'helper PID missing')
  const before = physicalFootprint(child.pid)
  await poll(4000)
  const after = physicalFootprint(child.pid)
  const growth = after - before
  const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(2)
  console.log(`helper-memory: ${binary}`)
  console.log(`helper-memory: 400 warm-up + 4000 measured requests (3600 active-window, 400 all-windows); 2 ping barriers`)
  console.log(`helper-memory: footprint ${mib(before)} -> ${mib(after)} MiB; growth ${mib(growth)} MiB`)
  assert.ok(growth <= 1024 ** 2, `helper footprint grew ${mib(growth)} MiB (limit 1 MiB)`)
  child.stdin.end('exit\n')
  const reason = await Promise.race([
    ended,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('helper did not exit')), 2000)
      timer.unref()
    })
  ])
  assert.equal(reason, 'exit 0, signal null')
  console.log('helper-memory check: OK')
} finally {
  lines.close()
  child.stdin.destroy()
  child.stdout.destroy()
  child.stderr.destroy()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  if (probeDir) rmSync(probeDir, { recursive: true, force: true })
}
