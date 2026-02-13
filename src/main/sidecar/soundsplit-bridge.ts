/**
 * SoundSplit Bridge — manages audio session data.
 *
 * Architecture: In production, this will spawn a Python sidecar process
 * that uses pycaw/WASAPI to control per-app volumes. Communication uses
 * JSON-RPC 2.0 over stdin/stdout.
 *
 * CURRENT: Mock implementation returning fake audio session data for UI
 * development and testing. The real Python sidecar will be swapped in later.
 *
 * Mock data simulates 4 apps with realistic volume and peak-level behavior.
 */

import { BrowserWindow } from 'electron'
import { IPC_SEND } from '@shared/ipc-types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AudioSession {
  pid: number
  name: string
  displayName: string
  volume: number // 0.0 - 1.0
  peak: number // 0.0 - 1.0 (VU meter level)
  muted: boolean
  iconPath: string | null
}

export interface MasterAudio {
  volume: number // 0.0 - 1.0
  peak: number // 0.0 - 1.0
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_APPS = [
  { pid: 1234, name: 'Spotify', displayName: 'Spotify', icon: null },
  { pid: 2345, name: 'chrome', displayName: 'Chrome', icon: null },
  { pid: 3456, name: 'Discord', displayName: 'Discord', icon: null },
  { pid: 4567, name: 'vlc', displayName: 'VLC Media Player', icon: null }
]

// ─── Service ────────────────────────────────────────────────────────────────

class SoundSplitBridge {
  private sessions: AudioSession[] = []
  private masterVolume = 0.8
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private savedVolumes: Record<string, number> = {}

  constructor() {
    // Initialize mock sessions
    this.sessions = MOCK_APPS.map((app) => ({
      pid: app.pid,
      name: app.name,
      displayName: app.displayName,
      volume: 0.6 + Math.random() * 0.4, // 60-100%
      peak: 0,
      muted: false,
      iconPath: app.icon
    }))

    // Make Teams muted by default for variety
    if (this.sessions.length >= 4) {
      this.sessions[3].muted = true
      this.sessions[3].volume = 0.45
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  init(): void {
    if (this.pollInterval) return

    // Simulate VU meter updates every 100ms
    this.pollInterval = setInterval(() => {
      this.updatePeakLevels()
      this.broadcastSessions()
    }, 100)

    console.log(`[SoundSplit] Bridge initialized (mock mode, ${this.sessions.length} sessions)`)
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    console.log('[SoundSplit] Bridge destroyed')
  }

  // ─── Mock VU meter simulation ───────────────────────────────────────────

  private updatePeakLevels(): void {
    for (const session of this.sessions) {
      if (session.muted) {
        session.peak = 0
        continue
      }

      // Simulate realistic audio peak levels:
      // Base level proportional to volume, with random fluctuation
      const base = session.volume * this.masterVolume
      const fluctuation = (40 + Math.random() * 60) / 100
      session.peak = Math.min(1.0, base * fluctuation)

      // Occasionally spike
      if (Math.random() < 0.05) {
        session.peak = Math.min(1.0, session.peak * 1.5)
      }

      // Occasionally drop to near-zero (silence between sounds)
      if (Math.random() < 0.15) {
        session.peak = session.peak * 0.1
      }
    }
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
    const session = this.sessions.find((s) => s.pid === pid)
    if (!session) return false

    session.volume = Math.max(0, Math.min(1, volume))

    // Auto-unmute when volume is changed
    if (session.muted && session.volume > 0) {
      session.muted = false
    }

    // Remember volume
    this.savedVolumes[session.name] = session.volume

    return true
  }

  setMute(pid: number, muted: boolean): boolean {
    const session = this.sessions.find((s) => s.pid === pid)
    if (!session) return false

    session.muted = muted
    return true
  }

  getMaster(): MasterAudio {
    // Simulate master peak level
    const activeSessions = this.sessions.filter((s) => !s.muted)
    let masterPeak = 0
    if (activeSessions.length > 0) {
      const avgPeak =
        activeSessions.reduce((sum, s) => sum + s.peak, 0) / activeSessions.length
      masterPeak = Math.min(1.0, avgPeak * 1.2)
    }

    return {
      volume: this.masterVolume,
      peak: masterPeak
    }
  }

  setMaster(volume: number): boolean {
    this.masterVolume = Math.max(0, Math.min(1, volume))
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
