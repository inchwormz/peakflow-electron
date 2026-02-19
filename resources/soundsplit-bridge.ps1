# Do NOT set $ErrorActionPreference = 'SilentlyContinue' globally —
# it masks Add-Type compilation errors, making C# failures invisible.
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(ref Guid AudioSessionGuid, uint StreamFlags, out IntPtr SessionControl);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid AudioSessionGuid, uint StreamFlags, out IntPtr AudioVolume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int SessionCount);
    [PreserveSig] int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl {
    [PreserveSig] int GetState(out int pRetVal);
}

[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int pRetVal);
    [PreserveSig] int GetDisplayName(out IntPtr pRetVal);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    [PreserveSig] int GetIconPath(out IntPtr pRetVal);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    [PreserveSig] int GetGroupingParam(out Guid pRetVal);
    [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    [PreserveSig] int GetSessionIdentifier(out IntPtr pRetVal);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr pRetVal);
    [PreserveSig] int GetProcessId(out uint pRetVal);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
}

[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float fLevel, ref Guid EventContext);
    [PreserveSig] int GetMasterVolume(out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float pfPeak);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public class AudioBridge {
    private static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    private static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    private static Guid GUID_NULL = Guid.Empty;
    private const int S_OK = 0;

    public static string Poll() {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        IAudioSessionManager2 mgr = null;
        IAudioSessionEnumerator sessionEnum = null;
        try {
            enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice deviceOut;
            enumerator.GetDefaultAudioEndpoint(0, 1, out deviceOut);
            device = deviceOut;
            object o;
            device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            mgr.GetSessionEnumerator(out se);
            sessionEnum = se;

            int count;
            sessionEnum.GetCount(out count);
            var lines = new List<string>();

            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctl = null;
                try {
                    IAudioSessionControl c;
                    sessionEnum.GetSession(i, out c);
                    ctl = c;
                    var ctl2 = ctl as IAudioSessionControl2;
                    if (ctl2 == null) continue;

                    uint pid = 0;
                    ctl2.GetProcessId(out pid);
                    if (pid == 0) continue;

                    int state;
                    ctl2.GetState(out state);

                    string procName = "Unknown";
                    try { procName = Process.GetProcessById((int)pid).ProcessName.ToLower(); } catch {}

                    var vol = ctl as ISimpleAudioVolume;
                    float level = 0f;
                    vol.GetMasterVolume(out level);

                    bool muted = false;
                    vol.GetMute(out muted);

                    float peak = 0f;
                    try {
                        var meter = ctl as IAudioMeterInformation;
                        meter.GetPeakValue(out peak);
                    } catch {}

                    if (state == 2 && peak < 0.001f) continue;

                    string strLevel = Math.Round(level, 4).ToString(CultureInfo.InvariantCulture);
                    string strPeak = Math.Round(peak, 4).ToString(CultureInfo.InvariantCulture);
                    lines.Add(pid + "|" + procName + "|" + strLevel + "|" + strPeak + "|" + (muted ? "1" : "0"));
                } finally {
                    if (ctl != null) Marshal.ReleaseComObject(ctl);
                }
            }

            // Master volume
            try {
                object oAev;
                device.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out oAev);
                var aev = (IAudioEndpointVolume)oAev;
                float masterVol = 0f;
                aev.GetMasterVolumeLevelScalar(out masterVol);
                bool masterMute = false;
                aev.GetMute(out masterMute);
                string mVol = Math.Round(masterVol, 4).ToString(CultureInfo.InvariantCulture);
                lines.Insert(0, "MASTER|Master Volume|" + mVol + "|0.0|" + (masterMute ? "1" : "0"));
                Marshal.ReleaseComObject(aev);
            } catch {
                lines.Insert(0, "MASTER|Master Volume|1.0|0.0|0");
            }

            return string.Join("\\n", lines);
        } finally {
            if (sessionEnum != null) Marshal.ReleaseComObject(sessionEnum);
            if (mgr != null) Marshal.ReleaseComObject(mgr);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static bool SetVolume(uint pid, float vol) {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        IAudioSessionManager2 mgr = null;
        IAudioSessionEnumerator sessionEnum = null;
        try {
            enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice deviceOut;
            enumerator.GetDefaultAudioEndpoint(0, 1, out deviceOut);
            device = deviceOut;
            object o;
            device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            mgr.GetSessionEnumerator(out se);
            sessionEnum = se;

            int count;
            sessionEnum.GetCount(out count);

            bool success = false;
            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctl = null;
                try {
                    IAudioSessionControl c;
                    sessionEnum.GetSession(i, out c);
                    ctl = c;
                    var ctl2 = ctl as IAudioSessionControl2;
                    if (ctl2 == null) continue;

                    uint p = 0;
                    ctl2.GetProcessId(out p);

                    if (p == pid) {
                        var sv = ctl as ISimpleAudioVolume;
                        if (sv != null) {
                            int hr = sv.SetMasterVolume(vol, ref GUID_NULL);
                            if (hr == S_OK) success = true;
                        }
                    }
                } finally {
                    if (ctl != null) Marshal.ReleaseComObject(ctl);
                }
            }
            return success;
        } finally {
            if (sessionEnum != null) Marshal.ReleaseComObject(sessionEnum);
            if (mgr != null) Marshal.ReleaseComObject(mgr);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static bool SetMute(uint pid, bool mute) {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        IAudioSessionManager2 mgr = null;
        IAudioSessionEnumerator sessionEnum = null;
        try {
            enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice deviceOut;
            enumerator.GetDefaultAudioEndpoint(0, 1, out deviceOut);
            device = deviceOut;
            object o;
            device.Activate(ref IID_IAudioSessionManager2, 23, IntPtr.Zero, out o);
            mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator se;
            mgr.GetSessionEnumerator(out se);
            sessionEnum = se;

            int count;
            sessionEnum.GetCount(out count);

            bool found = false;
            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctl = null;
                try {
                    IAudioSessionControl c;
                    sessionEnum.GetSession(i, out c);
                    ctl = c;
                    var ctl2 = ctl as IAudioSessionControl2;
                    if (ctl2 == null) continue;

                    uint p = 0;
                    ctl2.GetProcessId(out p);
                    if (p == pid) {
                        var sv = ctl as ISimpleAudioVolume;
                        if (sv != null) {
                            sv.SetMute(mute, ref GUID_NULL);
                            found = true;
                        }
                    }
                } finally {
                    if (ctl != null) Marshal.ReleaseComObject(ctl);
                }
            }
            return found;
        } finally {
            if (sessionEnum != null) Marshal.ReleaseComObject(sessionEnum);
            if (mgr != null) Marshal.ReleaseComObject(mgr);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }

    public static bool SetMaster(float vol) {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        try {
            enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
            IMMDevice deviceOut;
            enumerator.GetDefaultAudioEndpoint(0, 1, out deviceOut);
            device = deviceOut;
            object oAev;
            device.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out oAev);
            var aev = (IAudioEndpointVolume)oAev;
            aev.SetMasterVolumeLevelScalar(vol, ref GUID_NULL);
            Marshal.ReleaseComObject(aev);
            return true;
        } finally {
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
    }
}
"@
}
catch {
    [Console]::Error.WriteLine("FATAL: Add-Type failed: $_")
    [Console]::Out.WriteLine("ERR:Add-Type compilation failed")
    exit 1
}
# Verify the type loaded
try {
    $null = [AudioBridge].GetType()
    [Console]::Error.WriteLine("DBG: AudioBridge type loaded OK")
}
catch {
    [Console]::Error.WriteLine("FATAL: AudioBridge type not available: $_")
    [Console]::Out.WriteLine("ERR:AudioBridge type missing")
    exit 1
}
# Command loop — use [Console]::Out.WriteLine instead of Write-Host
# because Write-Host goes to the Information stream, not stdout,
# when PowerShell runs with -File or -Command mode.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.WriteLine("READY")
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { exit 0 }
    $line = $line.Trim()
    if ($line -eq "exit") { break }
    if ($line -eq "poll") {
        try {
            $result = [AudioBridge]::Poll()
            [Console]::Out.WriteLine("RESULT:$result")
        }
        catch {
            [Console]::Error.WriteLine("ERR poll: $_")
            [Console]::Out.WriteLine("RESULT:MASTER|Master Volume|1.0|0.0|0")
        }
    }
    elseif ($line.StartsWith("set_volume ")) {
        try {
            $parts = $line.Split(" ")
            $targetPid = [uint32]$parts[1]
            $vol = [float]::Parse($parts[2], [System.Globalization.CultureInfo]::InvariantCulture)
            $ok = [AudioBridge]::SetVolume($targetPid, $vol)
            [Console]::Out.WriteLine("OK:$ok")
        }
        catch {
            [Console]::Error.WriteLine("ERR set_volume: $_")
            [Console]::Out.WriteLine("OK:False")
        }
    }
    elseif ($line.StartsWith("set_mute ")) {
        try {
            $parts = $line.Split(" ")
            $targetPid = [uint32]$parts[1]
            $mute = $parts[2] -eq "1"
            $ok = [AudioBridge]::SetMute($targetPid, $mute)
            [Console]::Out.WriteLine("OK:$ok")
        }
        catch {
            [Console]::Error.WriteLine("ERR set_mute: $_")
            [Console]::Out.WriteLine("OK:False")
        }
    }
    elseif ($line.StartsWith("set_master ")) {
        try {
            $vol = [float]::Parse($line.Split(" ")[1], [System.Globalization.CultureInfo]::InvariantCulture)
            $ok = [AudioBridge]::SetMaster($vol)
            [Console]::Out.WriteLine("OK:$ok")
        }
        catch {
            [Console]::Error.WriteLine("ERR set_master: $_")
            [Console]::Out.WriteLine("OK:False")
        }
    }
    else {
        [Console]::Out.WriteLine("ERR:Unknown command")
    }
}
