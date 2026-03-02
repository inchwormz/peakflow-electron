/**
 * Watchdog — worker thread heartbeat monitor for main process freezes.
 *
 * Spawns a worker_threads Worker that expects heartbeat messages every 5s.
 * If no heartbeat arrives for 30s, the worker assumes the main process is
 * frozen and:
 *   1. Writes a crash marker file (userData/crash-marker.json)
 *   2. Appends a FATAL line to the log file
 *   3. Calls process.kill(process.pid) to terminate the entire process tree
 *
 * process.kill(process.pid) is used instead of process.exit() because
 * process.exit() from a worker only kills the worker thread — it does NOT
 * terminate the main process. process.kill() sends SIGTERM which on Windows
 * calls TerminateProcess() and kills the whole process.
 *
 * Sleep/hibernate protection: powerMonitor.on('resume') sends an immediate
 * heartbeat so the worker doesn't false-positive after waking.
 */

import { app, powerMonitor } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { getLogPath } from './logger'

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000
const FREEZE_THRESHOLD_MS = 30_000

// ─── State ──────────────────────────────────────────────────────────────────

let worker: Worker | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// ─── Worker Code ────────────────────────────────────────────────────────────

/**
 * Inline JS executed by the worker thread (eval: true).
 * Avoids electron-vite bundling issues with separate worker files.
 *
 * The worker receives { type, ... } messages from the main thread:
 *   - 'init': provides crashMarkerPath, logPath, freezeThreshold, pid
 *   - 'heartbeat': resets the last-seen timestamp
 *   - 'shutdown': graceful stop (clears interval, exits)
 */
const WORKER_CODE = `
const { parentPort } = require('worker_threads');
const fs = require('fs');

let lastHeartbeat = Date.now();
let crashMarkerPath = '';
let logPath = '';
let freezeThreshold = 30000;
let mainPid = 0;
let checkInterval = null;

parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    crashMarkerPath = msg.crashMarkerPath;
    logPath = msg.logPath;
    freezeThreshold = msg.freezeThreshold;
    mainPid = msg.pid;
    lastHeartbeat = Date.now();

    // Check every 5s whether we've exceeded the freeze threshold
    checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed > freezeThreshold) {
        // Main process is frozen — write crash evidence synchronously
        const now = new Date().toISOString();
        const marker = JSON.stringify({
          timestamp: now,
          reason: 'main_process_freeze',
          elapsed: elapsed
        });

        try { fs.writeFileSync(crashMarkerPath, marker); } catch {}

        const logLine = '[' + now + '] [FATAL] Watchdog: main process unresponsive for ' + elapsed + 'ms — terminating\\n';
        try { fs.appendFileSync(logPath, logLine); } catch {}

        // Kill the entire process tree (not just this worker)
        process.kill(mainPid);
      }
    }, 5000);
  }

  if (msg.type === 'heartbeat') {
    lastHeartbeat = Date.now();
  }

  if (msg.type === 'shutdown') {
    if (checkInterval) clearInterval(checkInterval);
    process.exit(0);
  }
});
`

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the crash marker file.
 * Can be called before initWatchdog() — uses app.getPath() directly.
 */
export function getCrashMarkerPath(): string {
  return join(app.getPath('userData'), 'crash-marker.json')
}

/**
 * Start the watchdog worker and begin sending heartbeats.
 * Call once, after initLogger(), in app.whenReady().
 */
export function initWatchdog(): void {
  if (worker) return

  try {
    worker = new Worker(WORKER_CODE, { eval: true })

    worker.on('error', (err) => {
      console.error('[Watchdog] Worker error:', err.message)
      cleanup()
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[Watchdog] Worker exited with code ${code}`)
      }
      worker = null
    })

    // Tell the worker where to write crash data
    worker.postMessage({
      type: 'init',
      crashMarkerPath: getCrashMarkerPath(),
      logPath: getLogPath(),
      freezeThreshold: FREEZE_THRESHOLD_MS,
      pid: process.pid
    })

    // Send heartbeats on a regular interval
    heartbeatTimer = setInterval(() => {
      if (worker) worker.postMessage({ type: 'heartbeat' })
    }, HEARTBEAT_INTERVAL_MS)

    // Send an immediate heartbeat after waking from sleep/hibernate
    // to prevent false positives (system clock jumps forward on resume)
    powerMonitor.on('resume', () => {
      if (worker) worker.postMessage({ type: 'heartbeat' })
    })

    console.log('[Watchdog] Main process heartbeat monitor started')
  } catch (err) {
    console.error('[Watchdog] Failed to start:', err)
  }
}

/**
 * Gracefully stop the watchdog. Call as the FIRST thing in before-quit
 * so the worker doesn't false-positive during the shutdown sequence.
 */
export function destroyWatchdog(): void {
  cleanup()
  console.log('[Watchdog] Stopped')
}

// ─── Internal ───────────────────────────────────────────────────────────────

function cleanup(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (worker) {
    try {
      worker.postMessage({ type: 'shutdown' })
    } catch {
      // Worker may already be dead
    }
    worker = null
  }
}
