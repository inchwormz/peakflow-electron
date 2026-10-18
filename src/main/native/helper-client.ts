/**
 * Line-protocol client for the persistent PeakFlowHelper process (macOS).
 *
 * No Electron imports, so scripts/checks can drive it with a fake helper.
 *
 * Protocol: each request is one line "<id> <command> [arg]"; the helper
 * answers with one line "<id> <json>". Replies are matched by ID, not by
 * order, so a request that timed out can never be paired with the reply to a
 * newer one (a late reply is simply dropped).
 *
 * Failure handling:
 * - spawn failure (e.g. ENOENT) and exit both mark the helper dead and reject
 *   every pending request immediately.
 * - respawn is gated by one exponential backoff (2 s doubling to 30 s) shared
 *   by every caller, so a helper that crashes on start cannot respawn 60x/s.
 *   The backoff resets once a helper has stayed up for STABLE_MS.
 * - each request has a timeout; several timeouts in a row means the helper is
 *   wedged, so it is killed and restarted (through the same backoff).
 * - after destroy() nothing ever respawns.
 */

import { spawn as nodeSpawn } from 'child_process'
import type { ChildProcess, SpawnOptions } from 'child_process'

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface HelperClientOptions {
  /** Resolves the helper binary path (called on every spawn). */
  getPath: () => string
  spawnFn?: SpawnFn
  args?: string[]
  restartBaseMs?: number
  restartMaxMs?: number
  requestTimeoutMs?: number
  /** Uptime after which a helper counts as healthy and the backoff resets. */
  stableMs?: number
  /** Consecutive timeouts after which the helper is killed and restarted. */
  maxConsecutiveTimeouts?: number
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

interface Pending {
  resolve: (data: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Values that are interpolated into a helper command line.
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]+$/

export function isValidBundleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && BUNDLE_ID_RE.test(value)
}

export function isValidPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff
}

export class HelperClient {
  private readonly opts: Required<Omit<HelperClientOptions, 'log' | 'args'>> & Pick<HelperClientOptions, 'log' | 'args'>
  private child: ChildProcess | null = null
  private buffer = ''
  private pending = new Map<number, Pending>()
  private nextId = 1
  private destroyed = false
  private backoffMs: number
  private nextSpawnAt = 0
  private spawnedAt = 0
  private consecutiveTimeouts = 0
  /** Number of times a helper process was started (for diagnostics/tests). */
  spawnCount = 0

  constructor(options: HelperClientOptions) {
    this.opts = {
      spawnFn: nodeSpawn as SpawnFn,
      restartBaseMs: 2000,
      restartMaxMs: 30000,
      requestTimeoutMs: 1000,
      stableMs: 30000,
      maxConsecutiveTimeouts: 3,
      ...options
    }
    this.backoffMs = this.opts.restartBaseMs
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }

  get pendingCount(): number {
    return this.pending.size
  }

  get isRunning(): boolean {
    return this.child !== null
  }

  /** Send one command; resolves with the helper's JSON reply text. */
  send(command: string): Promise<string> {
    if (/[\r\n]/.test(command)) {
      return Promise.reject(new Error('Helper command must be a single line'))
    }
    const child = this.ensureChild()
    if (!child || !child.stdin || !child.stdin.writable) {
      return Promise.reject(new Error(this.destroyed ? 'Helper destroyed' : 'Helper not available'))
    }

    const id = this.nextId++
    if (this.nextId > Number.MAX_SAFE_INTEGER - 1) this.nextId = 1
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.onTimeout(id, command), this.opts.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin!.write(`${id} ${command}\n`)
    })
  }

  /** Stop the helper for good (app quit). Never respawns afterwards. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.rejectAll(new Error('Helper destroyed'))
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.stdin?.write('exit\n')
    } catch {
      /* already gone */
    }
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }, 500)
    killTimer.unref?.()
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.opts.log?.(level, message)
  }

  private ensureChild(): ChildProcess | null {
    if (this.destroyed) return null
    if (this.child) return this.child
    if (Date.now() < this.nextSpawnAt) return null // backing off after a crash

    let child: ChildProcess
    try {
      child = this.opts.spawnFn(this.opts.getPath(), this.opts.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      this.log('error', `Failed to spawn helper: ${err instanceof Error ? err.message : String(err)}`)
      this.scheduleBackoff()
      return null
    }

    this.child = child
    this.buffer = ''
    this.spawnedAt = Date.now()
    this.consecutiveTimeouts = 0
    this.spawnCount++

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (this.child !== child) return
      this.buffer += chunk
      this.processOutput()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (data: string) => {
      this.log('warn', `Helper stderr: ${data.trim()}`)
    })
    // EPIPE when writing to a helper that just died: handled by exit/error.
    child.stdin?.on('error', () => {})
    child.on('error', (err) => this.onDeath(child, `error: ${err.message}`))
    child.on('exit', (code, signal) => this.onDeath(child, `exited (code ${code}, signal ${signal})`))
    return child
  }

  private onDeath(child: ChildProcess, reason: string): void {
    if (this.child !== child) return // already handled (error + exit both fire)
    this.child = null
    this.buffer = ''
    this.rejectAll(new Error(`Helper ${reason}`))
    if (this.destroyed) return
    if (Date.now() - this.spawnedAt >= this.opts.stableMs) {
      this.backoffMs = this.opts.restartBaseMs
    }
    const delay = this.scheduleBackoff()
    this.log('warn', `Helper ${reason}; next start allowed in ${delay} ms`)
  }

  /** Blocks respawn for the current backoff, then doubles it. Returns the delay. */
  private scheduleBackoff(): number {
    const delay = this.backoffMs
    this.nextSpawnAt = Date.now() + delay
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.restartMaxMs)
    return delay
  }

  private processOutput(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const match = /^(\d+) (.*)$/.exec(trimmed)
      if (!match) continue // reply without an ID: nothing to pair it with
      const id = Number(match[1])
      const req = this.pending.get(id)
      if (!req) continue // late reply to a timed-out request: drop it
      this.pending.delete(id)
      clearTimeout(req.timer)
      this.consecutiveTimeouts = 0
      req.resolve(match[2])
    }
  }

  private onTimeout(id: number, command: string): void {
    const req = this.pending.get(id)
    if (!req) return
    this.pending.delete(id)
    req.reject(new Error(`Helper request timed out: ${command.split(' ')[0]}`))
    this.consecutiveTimeouts++
    if (this.consecutiveTimeouts >= this.opts.maxConsecutiveTimeouts && this.child) {
      this.log('warn', `Helper unresponsive (${this.consecutiveTimeouts} timeouts in a row); restarting it`)
      this.consecutiveTimeouts = 0
      this.child.kill()
    }
  }

  private rejectAll(err: Error): void {
    const all = [...this.pending.values()]
    this.pending.clear()
    for (const req of all) {
      clearTimeout(req.timer)
      req.reject(err)
    }
  }
}
