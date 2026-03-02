/**
 * Persistent logger — monkey-patches console.log/warn/error to write
 * all main-process output to a log file in userData.
 *
 * Log file: userData/peakflow.log (~AppData/Roaming/peakflow-electron/peakflow.log)
 * Format: [ISO timestamp] [LEVEL] message
 * Max size: ~2 MB, auto-truncated to last ~1 MB at a newline boundary.
 *
 * Must be initialized before all other services so their log calls are captured.
 */

import { app } from 'electron'
import { join } from 'path'
import { appendFileSync } from 'fs'
import { writeFile, readFile, stat, open } from 'fs/promises'
import type { FileHandle } from 'fs/promises'

// ─── Constants ──────────────────────────────────────────────────────────────

const LOG_FILENAME = 'peakflow.log'
const MAX_LOG_BYTES = 2 * 1024 * 1024   // 2 MB
const TRUNCATE_TO = 1 * 1024 * 1024     // keep last ~1 MB after rotation
const ERROR_RING_SIZE = 50

// ─── State ──────────────────────────────────────────────────────────────────

let logPath = ''
let fileHandle: FileHandle | null = null
let writeChain: Promise<void> = Promise.resolve()
let initialized = false

/** Ring buffer of recent errors for instant access in bug reports */
const errorRing: string[] = []

/** Original console functions — called first so devtools/terminal still work */
const _log = console.log.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)

// ─── Internal Helpers ───────────────────────────────────────────────────────

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString()
  return `[${ts}] [${level}] ${formatArgs(args)}\n`
}

function enqueueWrite(line: string): void {
  writeChain = writeChain.then(async () => {
    if (!fileHandle) return
    try {
      await fileHandle.write(line)
    } catch {
      // Swallow write errors — never block the main process
    }
  })
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const stats = await stat(logPath)
    if (stats.size <= MAX_LOG_BYTES) return

    const content = await readFile(logPath, 'utf-8')
    // Find a newline boundary near the truncation point
    const start = content.length - TRUNCATE_TO
    const newlinePos = content.indexOf('\n', start)
    const truncated = newlinePos >= 0 ? content.slice(newlinePos + 1) : content.slice(start)

    // Close current handle, rewrite, reopen
    if (fileHandle) {
      await fileHandle.close()
      fileHandle = null
    }
    await writeFile(logPath, truncated, 'utf-8')
    fileHandle = await open(logPath, 'a')
  } catch {
    // Rotation failed — continue logging to the existing file
  }
}

function pushError(line: string): void {
  if (errorRing.length >= ERROR_RING_SIZE) {
    errorRing.shift()
  }
  errorRing.push(line)
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the persistent logger. Call once as the first thing in app.whenReady().
 * Monkey-patches console.log/warn/error globally.
 */
export async function initLogger(): Promise<void> {
  if (initialized) return
  initialized = true

  logPath = join(app.getPath('userData'), LOG_FILENAME)

  try {
    fileHandle = await open(logPath, 'a')
  } catch {
    // Can't open log file — logger will be a no-op for file writes
    _warn('[Logger] Failed to open log file at', logPath)
    return
  }

  // Session marker
  const marker = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] [SESSION] PeakFlow v${app.getVersion()} started\n${'='.repeat(60)}\n`
  enqueueWrite(marker)

  // Monkey-patch console
  console.log = (...args: unknown[]) => {
    _log(...args)
    const line = formatLine('INFO', args)
    enqueueWrite(line)
  }

  console.warn = (...args: unknown[]) => {
    _warn(...args)
    const line = formatLine('WARN', args)
    enqueueWrite(line)
    pushError(line)
  }

  console.error = (...args: unknown[]) => {
    _error(...args)
    const line = formatLine('ERROR', args)
    enqueueWrite(line)
    pushError(line)
  }

  // Schedule rotation check after a short delay (don't block startup)
  setTimeout(() => rotateIfNeeded(), 5000)

  _log('[Logger] Persistent logging initialized →', logPath)
}

/**
 * Flush pending writes and close the file handle. Call during before-quit.
 */
export async function flushLogger(): Promise<void> {
  try {
    await writeChain
    if (fileHandle) {
      await fileHandle.close()
      fileHandle = null
    }
  } catch {
    // Best-effort flush
  }
}

/** Get the absolute path to the log file. */
export function getLogPath(): string {
  return logPath
}

/**
 * Get the last N lines from the log file.
 * Reads from disk (not memory) to get the complete picture.
 */
export async function getRecentLogs(n = 200): Promise<string> {
  try {
    // Flush pending writes first so we read the latest
    await writeChain
    const content = await readFile(logPath, 'utf-8')
    const lines = content.split('\n')
    return lines.slice(-n).join('\n')
  } catch {
    return '(unable to read log file)'
  }
}

/** Get the error ring buffer contents (last 50 errors/warnings). */
export function getRecentErrors(): string[] {
  return [...errorRing]
}

/**
 * Synchronous write for crash-level events. Bypasses the async chain
 * so the line is guaranteed on disk even if the process is about to die.
 * Only use for uncaughtException / unhandledRejection / renderer crashes.
 */
export function crashWrite(level: string, ...args: unknown[]): void {
  if (!logPath) return
  const line = formatLine(level, args)
  pushError(line)
  try {
    appendFileSync(logPath, line)
  } catch {
    // Nothing we can do — process is dying
  }
}
