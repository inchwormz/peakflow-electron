/**
 * Mic Mute Service — toggle system microphone mute via Windows WASAPI.
 *
 * Uses async PowerShell `execFile` with -EncodedCommand to invoke C# COM interop
 * on the default capture device (eCapture, eCommunications). Same API that
 * Windows Settings uses.
 *
 * No persistent sidecar — mic mute is an infrequent toggle, so one-shot
 * PowerShell per call is fine.
 */

import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import { IPC_SEND } from '@shared/ipc-types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MicMuteResult {
  muted: boolean
  error: string | null
}

// ─── C# script (compiled once per PowerShell invocation) ────────────────────
//
// IMPORTANT: This goes into a @'...'@ single-quoted here-string in the
// PowerShell wrapper, so $ is literal (no PS variable expansion).
// Uses String.Format / concatenation instead of C# string interpolation.

const CSHARP_SOURCE = `
using System;
using System.Runtime.InteropServices;

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

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int NotImpl1();
    int NotImpl2();
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public class MicMuteHelper {
    private static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    private static Guid GUID_NULL = Guid.Empty;

    public static IAudioEndpointVolume GetCaptureEndpointVolume() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice device;
        // eCapture=1, eCommunications=1
        enumerator.GetDefaultAudioEndpoint(1, 1, out device);
        object o;
        device.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out o);
        return (IAudioEndpointVolume)o;
    }

    public static bool GetMute() {
        var vol = GetCaptureEndpointVolume();
        bool muted;
        vol.GetMute(out muted);
        return muted;
    }

    public static bool SetMute(bool mute) {
        var vol = GetCaptureEndpointVolume();
        vol.SetMute(mute, ref GUID_NULL);
        bool result;
        vol.GetMute(out result);
        return result;
    }

    public static bool Toggle() {
        var vol = GetCaptureEndpointVolume();
        bool current;
        vol.GetMute(out current);
        vol.SetMute(!current, ref GUID_NULL);
        bool result;
        vol.GetMute(out result);
        return result;
    }
}
`

// ─── PowerShell wrappers ────────────────────────────────────────────────────

function buildScript(action: 'get' | 'set' | 'toggle', muted?: boolean): string {
  // Use @'...'@ (single-quoted here-string) so PowerShell does NOT expand $
  const addType = `try {\n  Add-Type -TypeDefinition @'\n${CSHARP_SOURCE}\n'@\n} catch {\n  if ($_.Exception.Message -notmatch 'already exists') { throw }\n}`

  let call: string
  if (action === 'get') {
    call = '[MicMuteHelper]::GetMute()'
  } else if (action === 'set') {
    call = `[MicMuteHelper]::SetMute([bool]::Parse("${muted}"))`
  } else {
    call = '[MicMuteHelper]::Toggle()'
  }

  return `${addType}\ntry {\n  [Console]::Out.WriteLine(${call})\n} catch {\n  [Console]::Error.WriteLine($_.Exception.Message)\n  exit 1\n}`
}

function runPowerShellAsync(script: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: 5000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          // Check for ENOENT (PowerShell not found)
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error('PowerShell not found'))
          } else {
            reject(new Error(stderr?.trim() || error.message))
          }
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        }
      }
    )
  })
}

// ─── Broadcast helper ───────────────────────────────────────────────────────

function broadcastMuteState(muted: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_SEND.MIC_MUTE_CHANGED, muted)
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getMicMuteState(): Promise<MicMuteResult> {
  try {
    const { stdout } = await runPowerShellAsync(buildScript('get'))
    return { muted: stdout.toLowerCase() === 'true', error: null }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('E_NOTFOUND') || msg.includes('No audio')) {
      return { muted: false, error: 'No microphone found' }
    }
    return { muted: false, error: msg }
  }
}

export async function setMicMute(muted: boolean): Promise<MicMuteResult> {
  try {
    const { stdout } = await runPowerShellAsync(buildScript('set', muted))
    const result = stdout.toLowerCase() === 'true'
    broadcastMuteState(result)
    return { muted: result, error: null }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('E_NOTFOUND') || msg.includes('No audio')) {
      return { muted: false, error: 'No microphone found' }
    }
    return { muted: false, error: msg }
  }
}

export async function toggleMicMute(): Promise<MicMuteResult> {
  try {
    const { stdout } = await runPowerShellAsync(buildScript('toggle'))
    const result = stdout.toLowerCase() === 'true'
    broadcastMuteState(result)
    return { muted: result, error: null }
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('E_NOTFOUND') || msg.includes('No audio')) {
      return { muted: false, error: 'No microphone found' }
    }
    return { muted: false, error: msg }
  }
}
