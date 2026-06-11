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
 * Sleep/hibernate protection (three layers — a kill requires a live freeze):
 *   1. powerMonitor suspend/resume messages mark the gap as sleep.
 *   2. Gaps longer than SLEEP_GAP_MS are treated as sleep even when the
 *      suspend event never fired.
 *   3. The worker watches its own tick cadence: worker timers freeze during
 *      suspend too, so a late tick proves the system slept (catches the
 *      30s–2min wake gaps Modern Standby produces without a suspend event).
 * Additionally, two consecutive over-threshold checks are required before
 * terminating, so a single anomalous tick can never kill the app.
 */

import { app, powerMonitor } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { getLogPath } from './logger'

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000
const FREEZE_THRESHOLD_MS = 30_000
/** Gaps longer than this are sleep/hibernate, not a live freeze — reset instead of killing. */
const SLEEP_GAP_MS = 2 * 60_000

// ─── State ──────────────────────────────────────────────────────────────────

let worker: Worker | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// ─── Worker Code ────────────────────────────────────────────────────────────

/**
 * Inline JS executed by the worker thread (eval: true).
 * Avoids electron-vite bundling issues with separate worker files.
 *
 * The worker receives { type, ... } messages from the main thread:
 *   - 'init': provides crashMarkerPath, logPath, freezeThreshold, sleepGapMs, pid
 *   - 'heartbeat': resets the last-seen timestamp
 *   - 'suspend': system is sleeping — ignore gap until next heartbeat
 *   - 'shutdown': graceful stop (clears interval, exits)
 */
const WORKER_CODE = `
const { parentPort } = require('worker_threads');
const fs = require('fs');

let lastHeartbeat = Date.now();
let crashMarkerPath = '';
let logPath = '';
let freezeThreshold = 30000;
let sleepGapMs = 120000;
let mainPid = 0;
let checkInterval = null;
let systemSuspended = false;
let lastTick = Date.now();
let missedChecks = 0;

const CHECK_INTERVAL_MS = 5000;
// A tick arriving this late means the worker itself was frozen — i.e. the
// whole process was suspended (or the clock jumped), not a main-thread freeze.
const TICK_GAP_SLEEP_MS = CHECK_INTERVAL_MS * 3;

parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    crashMarkerPath = msg.crashMarkerPath;
    logPath = msg.logPath;
    freezeThreshold = msg.freezeThreshold;
    sleepGapMs = msg.sleepGapMs;
    mainPid = msg.pid;
    lastHeartbeat = Date.now();
    lastTick = Date.now();
    systemSuspended = false;
    missedChecks = 0;

    // Check every 5s whether we've exceeded the freeze threshold
    checkInterval = setInterval(() => {
      const now = Date.now();
      const tickGap = now - lastTick;
      lastTick = now;
      const elapsed = now - lastHeartbeat;

      // Worker timers freeze during system suspend. A late tick proves the
      // system slept — reset instead of killing, even when no suspend event
      // fired and the gap is under sleepGapMs.
      if (tickGap > TICK_GAP_SLEEP_MS) {
        lastHeartbeat = now;
        systemSuspended = false;
        missedChecks = 0;
        return;
      }

      if (elapsed <= freezeThreshold) {
        missedChecks = 0;
        return;
      }

      // Sleep/hibernate: clock jumps forward while heartbeats were paused
      if (systemSuspended || elapsed > sleepGapMs) {
        lastHeartbeat = now;
        systemSuspended = false;
        missedChecks = 0;
        return;
      }

      // Require two consecutive over-threshold checks before declaring a freeze
      missedChecks++;
      if (missedChecks < 2) return;

      // Main process is frozen — write crash evidence synchronously
      const nowIso = new Date().toISOString();
      const marker = JSON.stringify({
        timestamp: nowIso,
        reason: 'main_process_freeze',
        elapsed: elapsed
      });

      try { fs.writeFileSync(crashMarkerPath, marker); } catch {}

      const logLine = '[' + nowIso + '] [FATAL] Watchdog: main process unresponsive for ' + elapsed + 'ms — terminating\\n';
      try { fs.appendFileSync(logPath, logLine); } catch {}

      // Kill the entire process tree (not just this worker)
      process.kill(mainPid);
    }, CHECK_INTERVAL_MS);
  }

  if (msg.type === 'heartbeat') {
    lastHeartbeat = Date.now();
    systemSuspended = false;
    missedChecks = 0;
  }

  if (msg.type === 'suspend') {
    systemSuspended = true;
    lastHeartbeat = Date.now();
    missedChecks = 0;
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
      sleepGapMs: SLEEP_GAP_MS,
      pid: process.pid
    })

    // Send heartbeats on a regular interval
    heartbeatTimer = setInterval(() => {
      if (worker) worker.postMessage({ type: 'heartbeat' })
    }, HEARTBEAT_INTERVAL_MS)

    // Sleep/hibernate: mark suspend so the worker ignores the gap; resume resets heartbeat
    powerMonitor.on('suspend', () => {
      if (worker) worker.postMessage({ type: 'suspend' })
    })
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
