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

import { BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'
import { IPC_SEND } from '@shared/ipc-types'
import { ToolId } from '@shared/tool-ids'
import { getConfig } from '../services/config-store'
import type { SoundSplitConfig } from '@shared/config-schemas'

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

// ─── PowerShell sidecar script ───────────────────────────────────────────────

const PS_SIDECAR_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'

# COM type definitions for WASAPI
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
    int NotImpl1();
    int NotImpl2();
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl {
    int GetState(out int pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
}

[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 : IAudioSessionControl {
    // IAudioSessionControl methods (inherited)
    new int GetState(out int pRetVal);
    new int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    new int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    new int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    new int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    new int GetGroupingParam(out Guid pRetVal);
    new int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    new int RegisterAudioSessionNotification(IntPtr NewNotifications);
    new int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    // IAudioSessionControl2 methods
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetProcessId(out uint pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
    int GetPeakValue(out float pfPeak);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
}

public class AudioBridge {
    private static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    private static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    private static Guid IID_IAudioMeterInformation = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    private static Guid GUID_NULL = Guid.Empty;

    public static string Poll() {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(0, 1, out device);

            // Get sessions
            object o;
            device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator sessionEnum;
            mgr.GetSessionEnumerator(out sessionEnum);
            int count; sessionEnum.GetCount(out count);

            var lines = new List<string>();
            for (int i = 0; i < count; i++) {
                try {
                    IAudioSessionControl ctl; sessionEnum.GetSession(i, out ctl);
                    var ctl2 = (IAudioSessionControl2)ctl;
                    uint pid; ctl2.GetProcessId(out pid);
                    if (pid == 0) continue;

                    int state; ctl2.GetState(out state);
                    // 0=Inactive, 1=Active, 2=Expired
                    if (state == 2) continue;

                    string procName = "";
                    try { procName = Process.GetProcessById((int)pid).ProcessName; }
                    catch { continue; } // process gone

                    var vol = (ISimpleAudioVolume)ctl;
                    float level; vol.GetMasterVolume(out level);
                    bool muted; vol.GetMute(out muted);

                    float peak = 0;
                    try { var meter = (IAudioMeterInformation)ctl; meter.GetPeakValue(out peak); }
                    catch {}

                    lines.Add(pid + "|" + procName + "|" + Math.Round(level, 4) + "|" + Math.Round(peak, 4) + "|" + (muted ? "1" : "0"));
                } catch {}
            }

            // Get master volume
            float masterVol = 1f, masterPeak = 0f;
            try {
                object epvObj;
                device.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out epvObj);
                var epv = (IAudioEndpointVolume)epvObj;
                epv.GetMasterVolumeLevelScalar(out masterVol);
            } catch {}
            try {
                object meterObj;
                device.Activate(ref IID_IAudioMeterInformation, 23, IntPtr.Zero, out meterObj);
                var meter = (IAudioMeterInformation)meterObj;
                meter.GetPeakValue(out masterPeak);
            } catch {}

            lines.Insert(0, "MASTER|" + Math.Round(masterVol, 4) + "|" + Math.Round(masterPeak, 4));
            return string.Join("\\\\n", lines);
        } catch (Exception ex) {
            return "ERROR|" + ex.Message;
        }
    }

    public static bool SetVolume(uint targetPid, float vol) {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            object o; device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator sessionEnum; mgr.GetSessionEnumerator(out sessionEnum);
            int count; sessionEnum.GetCount(out count);
            for (int i = 0; i < count; i++) {
                try {
                    IAudioSessionControl ctl; sessionEnum.GetSession(i, out ctl);
                    var ctl2 = (IAudioSessionControl2)ctl;
                    uint pid; ctl2.GetProcessId(out pid);
                    if (pid == targetPid) {
                        var sv = (ISimpleAudioVolume)ctl;
                        sv.SetMasterVolume(vol, ref GUID_NULL);
                        return true;
                    }
                } catch {}
            }
        } catch {}
        return false;
    }

    public static bool SetMute(uint targetPid, bool mute) {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            object o; device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator sessionEnum; mgr.GetSessionEnumerator(out sessionEnum);
            int count; sessionEnum.GetCount(out count);
            for (int i = 0; i < count; i++) {
                try {
                    IAudioSessionControl ctl; sessionEnum.GetSession(i, out ctl);
                    var ctl2 = (IAudioSessionControl2)ctl;
                    uint pid; ctl2.GetProcessId(out pid);
                    if (pid == targetPid) {
                        var sv = (ISimpleAudioVolume)ctl;
                        sv.SetMute(mute, ref GUID_NULL);
                        return true;
                    }
                } catch {}
            }
        } catch {}
        return false;
    }

    public static void SetMaster(float vol) {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 1, out device);
            object o; device.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out o);
            var epv = (IAudioEndpointVolume)o;
            epv.SetMasterVolumeLevelScalar(vol, ref GUID_NULL);
        } catch {}
    }
}
"@

# Command loop — reads commands from stdin, writes results to stdout
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "READY"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq "exit") { break }

    if ($line -eq "poll") {
        $result = [AudioBridge]::Poll()
        Write-Host "RESULT:$result"
    }
    elseif ($line.StartsWith("set_volume ")) {
        $parts = $line.Split(" ")
        $pid = [uint32]$parts[1]
        $vol = [float]$parts[2]
        $ok = [AudioBridge]::SetVolume($pid, $vol)
        Write-Host "OK:$ok"
    }
    elseif ($line.StartsWith("set_mute ")) {
        $parts = $line.Split(" ")
        $pid = [uint32]$parts[1]
        $mute = $parts[2] -eq "1"
        $ok = [AudioBridge]::SetMute($pid, $mute)
        Write-Host "OK:$ok"
    }
    elseif ($line.StartsWith("set_master ")) {
        $vol = [float]$line.Split(" ")[1]
        [AudioBridge]::SetMaster($vol)
        Write-Host "OK:True"
    }
    else {
        Write-Host "ERR:Unknown command"
    }
}
`

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

  // ─── Sidecar lifecycle ──────────────────────────────────────────────────

  init(): void {
    if (this.pollInterval) return
    this.spawnSidecar()
  }

  private spawnSidecar(): void {
    if (this.ps) return

    this.ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', PS_SIDECAR_SCRIPT
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
      // Ignore non-critical errors (COM warnings, etc.)
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

      if (trimmed === 'READY') {
        this.ready = true
        console.log('[SoundSplit] Sidecar ready')
        // Start polling
        if (!this.pollInterval) {
          this.pollInterval = setInterval(() => this.poll(), 150)
        }
        continue
      }

      if (trimmed.startsWith('RESULT:')) {
        this.lastPollResult = trimmed.slice(7)
        this.parsePollResult(this.lastPollResult)
        this.broadcastSessions()
        continue
      }

      // OK responses from set_volume/set_mute/set_master — no action needed
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
    const sessions: AudioSession[] = []

    for (const line of raw.split('\\n')) {
      const parts = line.split('|')

      if (parts[0] === 'MASTER' && parts.length >= 3) {
        this.masterVolume = parseFloat(parts[1]) || 1
        this.masterPeak = parseFloat(parts[2]) || 0
        continue
      }

      if (parts[0] === 'ERROR') {
        console.warn('[SoundSplit] Poll error:', parts.slice(1).join('|'))
        continue
      }

      if (parts.length < 5) continue

      const pid = parseInt(parts[0])
      const name = parts[1]
      if (isNaN(pid) || pid === 0) continue

      const session: AudioSession = {
        pid,
        name,
        displayName: formatName(name),
        volume: parseFloat(parts[2]) || 0,
        peak: parseFloat(parts[3]) || 0,
        muted: parts[4] === '1',
        iconPath: null
      }

      // Restore saved preferences for newly-detected apps
      this.restorePrefs(session)

      sessions.push(session)
    }

    this.sessions = sessions
  }

  private poll(): void {
    if (!this.ready || !this.ps || this.ps.killed) return
    try {
      this.ps.stdin?.write('poll\n')
    } catch {
      // stdin may be closed
    }
  }

  private sendCommand(cmd: string): void {
    if (!this.ready || !this.ps || this.ps.killed) return
    try {
      this.ps.stdin?.write(cmd + '\n')
    } catch {
      console.warn('[SoundSplit] Failed to send command:', cmd)
    }
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    if (this.ps && !this.ps.killed) {
      try {
        this.ps.stdin?.write('exit\n')
      } catch {
        // Force kill if stdin is broken
      }
      setTimeout(() => {
        if (this.ps && !this.ps.killed) {
          this.ps.kill()
        }
        this.ps = null
      }, 1000)
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
    this.sendCommand(`set_volume ${pid} ${clamped.toFixed(4)}`)

    // Update local state immediately for responsive UI
    const session = this.sessions.find((s) => s.pid === pid)
    if (session) {
      session.volume = clamped
      if (session.muted && clamped > 0) session.muted = false
      // Persist preference keyed by process name
      this.savePrefs(session.name, session.volume, session.muted)
    }
    return true
  }

  setMute(pid: number, muted: boolean): boolean {
    this.sendCommand(`set_mute ${pid} ${muted ? '1' : '0'}`)

    const session = this.sessions.find((s) => s.pid === pid)
    if (session) {
      session.muted = muted
      // Persist preference keyed by process name
      this.savePrefs(session.name, session.volume, session.muted)
    }
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
