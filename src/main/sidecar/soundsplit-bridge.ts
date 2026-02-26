/**
 * SoundSplit Bridge — real per-app audio control via Windows WASAPI.
 *
 * Spawns a persistent PowerShell process that uses C# COM interop to
 * enumerate audio sessions, control volumes, and report VU peaks.
 *
 * Communication: JSON-RPC over stdin/stdout. The PowerShell process
 * runs a loop that:
 *   1. On "poll" command: returns all sessions with volume + peak data
 *   2. On "set_volume pid vol": sets volume for a specific session
 *   3. On "set_mute pid 0|1": sets mute state for a specific session
 *   4. On "set_master vol": sets master volume
 *   5. On "exit": terminates the sidecar
 */

import { BrowserWindow, app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { appendFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Store from 'electron-store'
import { IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import { getConfig } from '../services/config-store'
import type { SoundSplitConfig } from '@shared/config-schemas'

// Debug logging — writes to app's userData dir, not a hardcoded path
const DEBUG_LOG = join(app.getPath('userData'), 'soundsplit-debug.log')
const MAX_LOG_SIZE = 1024 * 1024 // 1 MB
function dbg(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23)
  try {
    // Truncate log when it exceeds 1 MB to prevent unbounded disk growth
    try { if (statSync(DEBUG_LOG).size > MAX_LOG_SIZE) writeFileSync(DEBUG_LOG, '') } catch { }
    appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`)
  } catch { }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AudioSession {
  pid: number
  name: string
  displayName: string
  volume: number
  peak: number
  muted: boolean
  iconPath: string | null
}

export interface MasterAudio {
  volume: number
  peak: number
}

// ─── Display name mapping ────────────────────────────────────────────────────

const DISPLAY_NAMES: Record<string, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  msedge: 'Microsoft Edge',
  spotify: 'Spotify',
  discord: 'Discord',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  vlc: 'VLC Media Player',
  brave: 'Brave',
  opera: 'Opera',
  zoom: 'Zoom',
  obs64: 'OBS Studio',
  steam: 'Steam',
  steamwebhelper: 'Steam',
  explorer: 'File Explorer',
  wmplayer: 'Windows Media Player',
  foobar2000: 'foobar2000',
  audacity: 'Audacity',
  thunderbird: 'Thunderbird'
}

function formatName(name: string): string {
  return DISPLAY_NAMES[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1)
}

// External PowerShell script is located at resources/soundsplit-bridge.ps1

// ─── Service ────────────────────────────────────────────────────────────────

// ─── Volume preference types ─────────────────────────────────────────────────

interface SavedVolumePrefs {
  volume: number
  muted: boolean
}

// ─── Preferences store (keyed by process name, not PID) ─────────────────────

const prefsStore = new Store<Record<string, SavedVolumePrefs>>({
  name: 'soundsplit-prefs',
  clearInvalidConfig: true
})

class SoundSplitBridge {
  private sessions: AudioSession[] = []
  private masterVolume = 1.0
  private masterPeak = 0
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private ps: ChildProcess | null = null
  private ready = false
  private pendingData = ''
  private lastPollResult = ''
  /** Track which process names have already had prefs restored this session */
  private restoredApps = new Set<string>()
  /** Guard against overlapping poll commands */
  private pollInFlight = false
  /** PIDs with recent volume/mute changes — skip overwriting from poll for 800ms */
  private recentlyChanged = new Map<number, number>()
  /** Accumulates multi-line RESULT data (C# joins with real newlines) */
  private resultLines: string[] | null = null

  // ─── Sidecar lifecycle ──────────────────────────────────────────────────

  init(): void {
    dbg('SoundSplitBridge.init() called')
    if (this.pollInterval) return
    this.spawnSidecar()
  }

  private spawnSidecar(): void {
    if (this.ps) return

    // Path to the PowerShell script. In production, it's inside app.asar.unpacked or resources.
    const isPackaged = app.isPackaged
    // We put it in resources/soundsplit-bridge.ps1
    const scriptPath = isPackaged
      ? join(process.resourcesPath, 'soundsplit-bridge.ps1')
      : join(__dirname, '../../resources/soundsplit-bridge.ps1')

    this.ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-STA',
      '-File', scriptPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.pendingData = ''
    this.ready = false

    this.ps.stdout?.setEncoding('utf8')
    this.ps.stdout?.on('data', (chunk: string) => {
      this.pendingData += chunk
      this.processOutput()
    })

    this.ps.stderr?.setEncoding('utf8')
    this.ps.stderr?.on('data', (data: string) => {
      // Log ALL stderr to debug file for diagnosis
      dbg(`STDERR: ${data.trim().slice(0, 500)}`)
      if (data.includes('Exception') || data.includes('Error')) {
        console.warn('[SoundSplit] PS stderr:', data.trim().slice(0, 200))
      }
    })

    this.ps.on('exit', (code) => {
      console.log(`[SoundSplit] Sidecar exited with code ${code}`)
      this.ps = null
      this.ready = false

      // Restart if we didn't intentionally destroy
      if (this.pollInterval) {
        console.log('[SoundSplit] Restarting sidecar...')
        setTimeout(() => this.spawnSidecar(), 2000)
      }
    })

    this.ps.on('error', (err) => {
      console.error('[SoundSplit] Failed to spawn sidecar:', err.message)
      this.ps = null
    })

    console.log('[SoundSplit] Spawning PowerShell sidecar...')
  }

  private processOutput(): void {
    const lines = this.pendingData.split('\n')
    // Keep the last incomplete line in the buffer
    this.pendingData = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Check if this is a known command prefix (not continuation data)
      const isCommand = trimmed === 'READY' ||
        trimmed.startsWith('RESULT:') ||
        trimmed.startsWith('OK:') ||
        trimmed.startsWith('ERR:')

      // If we're accumulating RESULT lines and hit a command, flush first
      if (this.resultLines && isCommand) {
        this.pollInFlight = false
        this.parsePollResult(this.resultLines.join('\n'))
        this.broadcastSessions()
        this.resultLines = null
      }

      if (trimmed === 'READY') {
        this.ready = true
        dbg('Sidecar READY')
        console.log('[SoundSplit] Sidecar ready')
        // Start polling
        if (!this.pollInterval) {
          this.pollInterval = setInterval(() => this.poll(), 150)
        }
        continue
      }

      if (trimmed.startsWith('RESULT:')) {
        // Start collecting multi-line result (C# joins with real newlines)
        this.resultLines = [trimmed.slice(7)]
        continue
      }

      // If we're collecting result lines, pipe-delimited data is continuation
      if (this.resultLines && trimmed.includes('|')) {
        this.resultLines.push(trimmed)
        continue
      }

      // If we were collecting but got a non-data line, flush
      if (this.resultLines) {
        this.pollInFlight = false
        this.parsePollResult(this.resultLines.join('\n'))
        this.broadcastSessions()
        this.resultLines = null
      }

      // OK responses from set_volume/set_mute/set_master
      if (trimmed.startsWith('OK:')) {
        dbg(`Sidecar response: ${trimmed}`)
        if (trimmed === 'OK:False') {
          console.warn('[SoundSplit] Set failed:', trimmed)
        }
        continue
      }
    }

    // If we have pending result lines and no more data to process,
    // flush them (the poll result is complete)
    if (this.resultLines && this.pendingData === '') {
      this.pollInFlight = false
      this.parsePollResult(this.resultLines.join('\n'))
      this.broadcastSessions()
      this.resultLines = null
    }
  }

  /** Check if remember_volumes is enabled in config */
  private shouldRememberVolumes(): boolean {
    try {
      const config = getConfig(ToolId.SoundSplit) as SoundSplitConfig
      return config.remember_volumes
    } catch {
      return true // default to remembering
    }
  }

  /** Save volume prefs for a process name */
  private savePrefs(processName: string, volume: number, muted: boolean): void {
    if (!this.shouldRememberVolumes()) return
    const key = processName.toLowerCase()
    prefsStore.set(key, { volume, muted })
  }

  /** Restore saved prefs for a newly-detected app */
  private restorePrefs(session: AudioSession): void {
    if (!this.shouldRememberVolumes()) return
    const key = session.name.toLowerCase()
    if (this.restoredApps.has(key)) return // already restored this session

    this.restoredApps.add(key)
    const saved = prefsStore.get(key) as SavedVolumePrefs | undefined
    if (!saved) return

    // Only restore if the current values differ from saved
    const volDiff = Math.abs(session.volume - saved.volume) > 0.01
    const muteDiff = session.muted !== saved.muted

    if (volDiff) {
      this.sendCommand(`set_volume ${session.pid} ${saved.volume.toFixed(4)}`)
      session.volume = saved.volume
      console.log(`[SoundSplit] Restored volume for ${session.name}: ${Math.round(saved.volume * 100)}%`)
    }
    if (muteDiff) {
      this.sendCommand(`set_mute ${session.pid} ${saved.muted ? '1' : '0'}`)
      session.muted = saved.muted
      console.log(`[SoundSplit] Restored mute for ${session.name}: ${saved.muted}`)
    }
  }

  private parsePollResult(raw: string): void {
    // Deduplicate sub-sessions by PID — Chromium apps spawn multiple WASAPI
    // sessions under the same PID (ghost sessions). Merge them: take highest
    // peak, highest volume, only muted if ALL sub-sessions are muted.
    const sessionMap = new Map<number, AudioSession>()

    for (const line of raw.split('\n')) {
      const parts = line.split('|')

      if (parts[0] === 'MASTER' && parts.length >= 4) {
        this.masterVolume = parseFloat(parts[2]) || 1
        this.masterPeak = parseFloat(parts[3]) || 0
        continue
      }

      if (parts[0] === 'ERROR') {
        console.warn('[SoundSplit] Poll error:', parts.slice(1).join('|'))
        continue
      }

      if (parts.length < 5) continue

      const pid = parseInt(parts[0], 10)
      const name = parts[1]
      if (isNaN(pid) || pid === 0) continue

      const volume = parseFloat(parts[2]) || 0
      const peak = parseFloat(parts[3]) || 0
      const muted = parts[4] === '1'

      if (sessionMap.has(pid)) {
        const existing = sessionMap.get(pid)!
        existing.peak = Math.max(existing.peak, peak)
        existing.volume = Math.max(existing.volume, volume)
        existing.muted = existing.muted && muted // only muted if ALL sub-sessions muted
      } else {
        sessionMap.set(pid, {
          pid, name,
          displayName: formatName(name),
          volume, peak, muted,
          iconPath: null
        })
      }
    }

    const sessions = Array.from(sessionMap.values())
    const now = Date.now()

    for (const session of sessions) {
      // Restore saved preferences for newly-detected apps
      this.restorePrefs(session)

      // Preserve optimistic volume/mute for recently-changed PIDs so the
      // poll doesn't overwrite user-initiated slider changes.
      const changedAt = this.recentlyChanged.get(session.pid)
      if (changedAt) {
        const existing = this.sessions.find((s) => s.pid === session.pid)
        if (now - changedAt < 800 && existing) {
          session.volume = existing.volume
          session.muted = existing.muted
        }
      }
    }

    // Clean up expired entries from recentlyChanged
    for (const [pid, ts] of this.recentlyChanged) {
      if (now - ts >= 800) this.recentlyChanged.delete(pid)
    }

    // Clear restoredApps entries for apps that are no longer present,
    // so prefs get re-applied if the app relaunches with a new PID
    const currentNames = new Set(sessions.map((s) => s.name.toLowerCase()))
    for (const name of this.restoredApps) {
      if (!currentNames.has(name)) {
        this.restoredApps.delete(name)
      }
    }

    this.sessions = sessions
  }

  private poll(): void {
    if (!this.ready || !this.ps || this.ps.killed) return
    if (this.pollInFlight) return // skip if previous poll hasn't returned yet
    this.pollInFlight = true
    try {
      this.ps.stdin?.write('poll\n')
    } catch {
      this.pollInFlight = false // reset on write failure
    }
  }

  private sendCommand(cmd: string): void {
    if (!this.ready || !this.ps || this.ps.killed) {
      dbg(`sendCommand SKIPPED (ready=${this.ready} ps=${!!this.ps}): ${cmd}`)
      return
    }
    dbg(`sendCommand: ${cmd}`)
    try {
      this.ps.stdin?.write(cmd + '\n')
    } catch {
      dbg(`sendCommand FAILED: ${cmd}`)
    }
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.ps && !this.ps.killed) {
      // Capture reference to avoid killing a respawned process in the timeout
      const proc = this.ps
      this.ps = null
      try {
        proc.stdin?.write('exit\n')
      } catch {
        // Force kill if stdin is broken
      }
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill()
        }
      }, 1000)
    } else {
      this.ps = null
    }
    this.ready = false
    console.log('[SoundSplit] Bridge destroyed')
  }

  // ─── Broadcasting ───────────────────────────────────────────────────────

  private broadcastSessions(): void {
    const data = this.sessions.map((s) => ({
      pid: s.pid,
      name: s.name,
      displayName: s.displayName,
      volume: s.volume,
      peak: s.peak,
      muted: s.muted,
      iconPath: s.iconPath
    }))

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_SEND.SOUNDSPLIT_SESSIONS_UPDATED, data)
      }
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  getSessions(): AudioSession[] {
    return this.sessions.map((s) => ({ ...s }))
  }

  setVolume(pid: number, volume: number): boolean {
    const clamped = Math.max(0, Math.min(1, volume))
    dbg(`setVolume pid=${pid} vol=${clamped.toFixed(3)} ready=${this.ready} ps=${!!this.ps}`)
    this.sendCommand(`set_volume ${pid} ${clamped.toFixed(4)}`)
    this.poll() // instant refresh

    // Update local state immediately for responsive UI
    const session = this.sessions.find((s) => s.pid === pid)
    if (session) {
      session.volume = clamped
      if (session.muted && clamped > 0) session.muted = false
      // Persist preference keyed by process name
      this.savePrefs(session.name, session.volume, session.muted)
    }
    // Suppress poll overwrites for this PID for 800ms
    this.recentlyChanged.set(pid, Date.now())
    return true
  }

  setMute(pid: number, muted: boolean): boolean {
    this.sendCommand(`set_mute ${pid} ${muted ? '1' : '0'}`)
    this.poll() // instant refresh

    const session = this.sessions.find((s) => s.pid === pid)
    if (session) {
      session.muted = muted
      // Persist preference keyed by process name
      this.savePrefs(session.name, session.volume, session.muted)
    }
    // Suppress poll overwrites for this PID for 800ms
    this.recentlyChanged.set(pid, Date.now())
    return true
  }

  getMaster(): MasterAudio {
    return {
      volume: this.masterVolume,
      peak: this.masterPeak
    }
  }

  setMaster(volume: number): boolean {
    const clamped = Math.max(0, Math.min(1, volume))
    this.sendCommand(`set_master ${clamped.toFixed(4)}`)
    this.poll() // instant refresh
    this.masterVolume = clamped
    return true
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let instance: SoundSplitBridge | null = null

export function getSoundSplitBridge(): SoundSplitBridge {
  if (!instance) {
    instance = new SoundSplitBridge()
  }
  return instance
}

export function initSoundSplit(): void {
  getSoundSplitBridge().init()
}

export function destroySoundSplit(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
