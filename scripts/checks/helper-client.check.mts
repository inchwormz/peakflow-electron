/**
 * Check: HelperClient (macOS helper process manager) never storms, never
 * hangs, never mis-pairs replies, and never respawns after destroy().
 * Uses a fake helper (fixtures/fake-helper.mjs) with short timings, then a
 * quick round trip against the real resources/darwin/peakflow-helper if built.
 * Run: node scripts/checks/helper-client.check.mts
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HelperClient, isValidBundleId, isValidPid } from '../../src/main/native/helper-client.ts'

const fake = join(import.meta.dirname, 'fixtures', 'fake-helper.mjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const logs: string[] = []

function client(mode: string, extra: Record<string, unknown> = {}) {
  return new HelperClient({
    getPath: () => mode,
    spawnFn: (_cmd, _args, opts) => spawn(process.execPath, [fake, mode], opts),
    restartBaseMs: 200,
    restartMaxMs: 800,
    requestTimeoutMs: 100,
    log: (level, msg) => logs.push(`${level} ${msg}`),
    ...extra
  })
}

// 1. Crashing helper: hammer it at 60 fps for 1 s; backoff caps the spawns.
{
  const c = client('crash')
  const t0 = Date.now()
  let rejected = 0
  while (Date.now() - t0 < 1000) {
    await c.send('active-window').catch(() => rejected++)
    await sleep(16)
  }
  // 200 + 400 + 800 ms backoff => at most 3 starts in 1 s (old code: ~60)
  assert.ok(c.spawnCount <= 3, `crash loop spawned ${c.spawnCount} times`)
  assert.ok(rejected > 30, 'requests while backing off are rejected at once')
  assert.equal(c.pendingCount, 0)
  c.destroy()
  console.log(`crash: ${c.spawnCount} spawns in 1 s, ${rejected} fast rejections`)
}

// 2. Missing binary (ENOENT): request rejects promptly instead of hanging.
{
  const c = new HelperClient({ getPath: () => '/nonexistent/peakflow-helper', restartBaseMs: 200, requestTimeoutMs: 5000, log: (l, m) => logs.push(`${l} ${m}`) })
  const t0 = Date.now()
  await assert.rejects(c.send('active-window'))
  assert.ok(Date.now() - t0 < 1000, 'ENOENT must not wait for the request timeout')
  assert.equal(c.isRunning, false)
  await assert.rejects(c.send('active-window'), /not available/) // backing off, no respawn
  assert.equal(c.spawnCount, 1)
  c.destroy()
  console.log('enoent: rejected in', Date.now() - t0, 'ms, 1 spawn attempt')
}

// 3. Timeout + late reply: the late reply must not be paired with a newer request.
{
  const c = client('slow')
  const slow = c.send('slow')
  await assert.rejects(slow, /timed out/)
  const next = c.send('next') // helper is still answering "slow" when this goes out
  await sleep(300) // the late "slow" reply arrives now
  const reply = JSON.parse(await next)
  assert.equal(reply.cmd, 'next', `newer request got ${reply.cmd}'s reply`)
  assert.equal(c.pendingCount, 0)
  c.destroy()
  console.log('timeout: late reply dropped, newer request got its own reply')
}

// 4. Wedged helper: consecutive timeouts restart it.
{
  const c = client('hang', { maxConsecutiveTimeouts: 3 })
  for (let i = 0; i < 3; i++) await assert.rejects(c.send('active-window'), /timed out/)
  await sleep(50)
  assert.equal(c.isRunning, false, 'wedged helper is killed')
  await sleep(250)
  await assert.rejects(c.send('active-window'), /timed out/) // respawned after backoff
  assert.equal(c.spawnCount, 2)
  c.destroy()
  console.log('hang: killed after 3 timeouts, respawned once after backoff')
}

// 5. destroy(): pending requests reject, nothing respawns afterwards.
{
  const c = client('hang')
  const p = c.send('active-window')
  c.destroy()
  await assert.rejects(p, /destroyed/)
  await sleep(300)
  await assert.rejects(c.send('active-window'), /destroyed/)
  assert.equal(c.spawnCount, 1)
  console.log('destroy: no respawn')
}

// 6. Commands are single lines.
{
  const c = client('echo')
  await assert.rejects(c.send('app-windows a\nexit'), /single line/)
  assert.equal(JSON.parse(await c.send('ping')).cmd, 'ping')
  c.destroy()
}

// 7. Argument validators used for app-windows / process-name.
assert.ok(isValidBundleId('com.apple.Safari'))
assert.ok(isValidBundleId('org.mozilla.firefox-esr'))
for (const bad of ['', 'com.x y', 'com.x\nexit', 'a;b', '../x', 42, null]) assert.ok(!isValidBundleId(bad), String(bad))
assert.ok(isValidPid(1) && isValidPid(98928))
for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 31, '12', null]) assert.ok(!isValidPid(bad), String(bad))

// 8. Real helper round trip (macOS, if built).
const real = join(import.meta.dirname, '..', '..', 'resources', 'darwin', 'peakflow-helper')
if (process.platform === 'darwin' && existsSync(real)) {
  const c = new HelperClient({ getPath: () => real })
  assert.equal(await c.send('ping'), '"pong"')
  assert.equal(await c.send(`process-name ${process.pid}`), 'null') // node is not a GUI app
  const windows = JSON.parse(await c.send('all-windows'))
  assert.ok(Array.isArray(windows))
  c.destroy()
  console.log(`real helper: ping ok, all-windows returned ${windows.length} windows`)
}

console.log('helper-client check: OK')
