/**
 * Keychain waits outlive the ordinary dialog lease. Execute the actual inline
 * worker with a fake clock and kill target; no Electron or real Keychain access.
 * Run: node scripts/checks/watchdog-keychain.check.mts
 */
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

type Message = { type: string; unbounded?: boolean }
const g = globalThis as unknown as {
  __watchdog: { code: string; messages: Message[]; deny: boolean }
}
g.__watchdog = { code: '', messages: [], deny: false }
installTsHooks({
  electron: fake(`
    export const app = { getPath: () => '/unused' }
    export const powerMonitor = { on() {} }
    export const dialog = {}
    const paused = () => {
      const last = globalThis.__watchdog.messages.at(-1)
      if (last?.type !== 'modal-open' || last.unbounded !== true) throw Error('not paused')
      if (globalThis.__watchdog.deny) throw Error('Keychain denied')
    }
    export const safeStorage = {
      isEncryptionAvailable() { paused(); return true },
      encryptString(s) { paused(); return Buffer.from(s) },
      decryptString(b) { paused(); return b.toString() }
    }
  `),
  worker_threads: fake(`export class Worker {
    constructor(code) { globalThis.__watchdog.code = code }
    on() {}
    postMessage(msg) { globalThis.__watchdog.messages.push(msg) }
  }`),
  './logger': fake(`export const getLogPath = () => '/unused/log'`)
})

const watchdog = await import(srcUrl('src/main/services/watchdog.ts'))
const storage = await import(srcUrl('src/main/security/safe-storage.ts'))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
Object.defineProperty(process, 'platform', { value: 'darwin' })
try {
  watchdog.initWatchdog()
  assert.equal(storage.isAvailable(), true)
  assert.equal(storage.encryptString('test'), Buffer.from('test').toString('base64'))
  assert.equal(storage.decryptString(Buffer.from('test').toString('base64')), 'test')
  g.__watchdog.deny = true
  assert.equal(storage.isAvailable(), false)
  assert.equal(storage.encryptString('test'), null)
  assert.equal(storage.decryptString('test'), null)

  const pauses = g.__watchdog.messages.filter((m) => m.type.startsWith('modal-'))
  assert.equal(pauses.length, 16, 'all eight safeStorage calls must open and close')
  for (let i = 0; i < pauses.length; i += 2) {
    assert.deepEqual(pauses[i], { type: 'modal-open', unbounded: true })
    assert.deepEqual(pauses[i + 1], { type: 'modal-close', unbounded: true })
  }

  assert.throws(() => watchdog.withWatchdogPaused(() => {
    watchdog.withWatchdogPaused(() => 1, { unbounded: true })
    throw new Error('sync failure')
  }), /sync failure/)
  assert.deepEqual(g.__watchdog.messages.slice(-4), [
    { type: 'modal-open', unbounded: false },
    { type: 'modal-open', unbounded: true },
    { type: 'modal-close', unbounded: true },
    { type: 'modal-close', unbounded: false }
  ])
} finally {
  watchdog.destroyWatchdog()
  Object.defineProperty(process, 'platform', platform)
}

function monitor() {
  let now = 0
  let receive: (msg: Message | Record<string, unknown>) => void = () => {}
  let tick = () => {}
  let kills = 0
  runInNewContext(g.__watchdog.code, {
    require: (name: string) => name === 'worker_threads'
      ? { parentPort: { on: (_: string, fn: typeof receive) => { receive = fn } } }
      : { writeFileSync() {}, appendFileSync() {} },
    Date: class extends Date { static now() { return now } },
    setInterval: (fn: () => void) => { tick = fn; return 1 },
    clearInterval() {},
    process: { kill: () => { kills++ } }
  })
  receive({ type: 'init', freezeThreshold: 30_000, sleepGapMs: 120_000, modalMaxMs: 600_000, pid: 123 })
  return {
    send: (type: string, unbounded = false) => receive({ type, unbounded }),
    advance(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 5_000) { now += 5_000; tick() }
    },
    get kills() { return kills }
  }
}

// Ordinary dialogs still expire, and actual freezes still terminate.
const bounded = monitor()
bounded.send('modal-open')
bounded.advance(595_000)
assert.equal(bounded.kills, 0)
bounded.advance(40_000)
assert.ok(bounded.kills > 0, 'ordinary dialog must retain its ten-minute cap')

// Both nesting orders, multiple unbounded waits, and a bounded close must not
// cancel the remaining Keychain wait. Closing the last wait restores recovery.
for (const unboundedFirst of [false, true]) {
  const m = monitor()
  m.send('modal-open', unboundedFirst)
  m.send('modal-open', !unboundedFirst)
  m.send('modal-open', true)
  m.advance(1_200_000)
  assert.equal(m.kills, 0, 'Keychain wait survives beyond ten minutes')
  m.send('modal-close')
  m.send('modal-close', true)
  m.advance(1_200_000)
  assert.equal(m.kills, 0, 'one unbounded wait is still open')
  m.send('modal-close', true)
  m.advance(40_000)
  assert.ok(m.kills > 0, 'freeze recovery resumes after the last close')
}

// An expired outer bounded dialog stays expired once its Keychain wait closes.
const outer = monitor()
outer.send('modal-open')
outer.send('modal-open', true)
outer.advance(1_200_000)
outer.send('modal-close', true)
outer.advance(40_000)
assert.ok(outer.kills > 0, 'unbounded close must not renew the ordinary lease')

console.log('watchdog-keychain: OK')
