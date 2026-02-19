# SoundSplit Roadmap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform SoundSplit from a basic per-app volume mixer into a full system audio control panel (matching/exceeding macOS SoundSource), delivered as a tray-attached popover with device routing, presets, settings, and eventually per-app EQ.

**Architecture:** Tray-attached popover window positioned near the system tray icon. Backend extends the existing PowerShell/C# COM sidecar with new commands for device enumeration and per-app output routing (via undocumented IPolicyConfig COM interface). Presets and settings persist via electron-store. UI rebuilt as React with the existing DS token system, inspired by the approved `prototypes/soundsplit-phase1.html` prototype.

**Tech Stack:** Electron (main process), React (renderer), PowerShell sidecar with C# COM interop (WASAPI + IPolicyConfig), electron-store (persistence), TypeScript strict mode throughout.

**Prototype Reference:** `prototypes/soundsplit-phase1.html` — approved by user, use as visual reference for all UI work.

---

## Phase 1: Tray-Attached Popover Window

Transform SoundSplit from a standard BrowserWindow to a tray-attached popover that appears near the system tray icon (like macOS menu bar apps). This is the foundation for all subsequent work.

### Task 1.1: Export tray accessor from tray.ts

**Files:**
- Modify: `src/main/tray.ts:13` (add getTray export)

**Step 1: Add getTray() accessor**

Add after line 13 (`let tray: Tray | null = null`):

```typescript
/** Get the tray instance for positioning windows relative to tray icon */
export function getTray(): Tray | null {
  return tray
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/main/tray.ts
git commit -m "feat(soundsplit): export getTray accessor for popover positioning"
```

---

### Task 1.2: Update SoundSplit window config for popover behavior

**Files:**
- Modify: `src/main/windows.ts:47` (SoundSplit config line)
- Modify: `src/main/windows.ts:163-177` (ready-to-show handler)

**Step 1: Update WINDOW_CONFIGS for SoundSplit**

Change line 47 from:
```typescript
[ToolId.SoundSplit]: { width: 340, height: 540, minWidth: 340, minHeight: 400 },
```
To:
```typescript
[ToolId.SoundSplit]: { width: 360, height: 580, minWidth: 340, minHeight: 400, alwaysOnTop: true, skipTaskbar: true },
```

**Step 2: Add SoundSplit alwaysOnTop re-assertion (same pattern as LiquidFocus)**

In the `win.once('ready-to-show', ...)` handler (after the LiquidFocus block at line 176), add:

```typescript
// SoundSplit: popover stays above everything, re-assert on focus changes
if (toolId === ToolId.SoundSplit) {
  const pinSS = (): void => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver')
  }
  pinSS()
  win.on('blur', pinSS)
  win.on('show', pinSS)
  win.on('restore', pinSS)
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/windows.ts
git commit -m "feat(soundsplit): configure as alwaysOnTop popover with screen-saver level"
```

---

### Task 1.3: Add tray-based SoundSplit toggle with positioning

**Files:**
- Modify: `src/main/tray.ts` (SoundSplit menu item + click handler)
- Modify: `src/main/windows.ts` (add popover positioning function)

**Step 1: Add popover positioning helper in windows.ts**

Add before the `createToolWindow` function (around line 78):

```typescript
/**
 * Position a window near the system tray icon.
 * On Windows, the tray is at the bottom-right, so the popover appears
 * above-left of the tray icon with a small gap.
 */
export function positionNearTray(win: BrowserWindow, trayBounds: Electron.Rectangle): void {
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
  const workArea = display.workArea
  const winBounds = win.getBounds()

  // Position above the tray icon, centered horizontally on the icon
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2)
  let y = Math.round(trayBounds.y - winBounds.height - 4) // 4px gap

  // Clamp to work area
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winBounds.width))
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - winBounds.height))

  win.setPosition(x, y, false)
}
```

**Step 2: Update SoundSplit tray click to toggle popover with positioning**

In `tray.ts`, update the SoundSplit menu item (around line 111) and add a left-click handler for the tray. Import the new positioning function:

At the top, update imports:
```typescript
import { createToolWindow, openToolWithAccessCheck, getToolWindow, closeToolWindow, positionNearTray } from './windows'
```

Replace the SoundSplit menu item click handler:
```typescript
{
  label: TOOL_DISPLAY_NAMES[ToolId.SoundSplit],
  click: (): void => {
    toggleSoundSplitPopover()
  }
},
```

Add the toggle function before `buildContextMenu`:
```typescript
/**
 * Toggle SoundSplit popover — show near tray if hidden, hide if visible.
 */
function toggleSoundSplitPopover(): void {
  const existing = getToolWindow(ToolId.SoundSplit)
  if (existing && existing.isVisible()) {
    existing.hide()
    return
  }

  if (existing) {
    // Window exists but is hidden — reposition and show
    if (tray) positionNearTray(existing, tray.getBounds())
    existing.show()
    existing.focus()
    return
  }

  // Create new window, position after it renders
  openToolWithAccessCheck(ToolId.SoundSplit).then((win) => {
    if (win && tray) {
      win.once('ready-to-show', () => {
        positionNearTray(win, tray!.getBounds())
      })
    }
  })
}
```

**Step 3: Add tray left-click to toggle SoundSplit**

In `createTray()`, after the double-click handler (line 152), add:

```typescript
// Left-click toggles SoundSplit popover
tray.on('click', () => {
  toggleSoundSplitPopover()
})
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 5: Manual test**

Run: `npm run dev`
- Click tray icon → SoundSplit popover appears near tray
- Click tray icon again → popover hides
- Click away from popover → verify it stays on top (screen-saver level)
- Right-click tray → context menu still works

**Step 6: Commit**

```bash
git add src/main/tray.ts src/main/windows.ts
git commit -m "feat(soundsplit): tray-attached popover with toggle and positioning"
```

---

### Task 1.4: Add blur-to-hide behavior for popover

**Files:**
- Modify: `src/main/windows.ts` (SoundSplit close/blur handlers)

**Step 1: Add blur-to-hide and close-to-hide for SoundSplit**

In `createToolWindow`, after the SoundSplit alwaysOnTop block (added in Task 1.2), add:

```typescript
// SoundSplit: hide on blur (popover dismisses when clicking elsewhere)
// and intercept close to hide instead of destroy
if (toolId === ToolId.SoundSplit) {
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide()
    }
  })

  win.on('close', (e) => {
    if (appQuitting) return
    e.preventDefault()
    win.hide()
  })
}
```

**Important:** The blur handler above will conflict with the `pinSS` alwaysOnTop re-assertion from Task 1.2. The pin needs to run BEFORE the hide check. Combine them:

Replace the separate SoundSplit blocks (from Tasks 1.2 and this task) with a single unified block:

```typescript
// SoundSplit: popover behavior — always on top, hide on blur, hide on close
if (toolId === ToolId.SoundSplit) {
  const pinSS = (): void => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver')
  }
  pinSS()
  win.on('show', pinSS)
  win.on('restore', pinSS)

  // Hide when user clicks away (popover behavior)
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      // Small delay to allow tray click to toggle instead of hide-then-show
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isFocused()) {
          win.hide()
        }
      }, 100)
    }
  })

  // Intercept close → hide (keep process alive)
  win.on('close', (e) => {
    if (appQuitting) return
    e.preventDefault()
    win.hide()
  })
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Manual test**

Run: `npm run dev`
- Click tray → popover appears
- Click anywhere else → popover hides
- Click tray → popover reappears (same window, not new)
- Rapid tray clicks → no flickering

**Step 4: Commit**

```bash
git add src/main/windows.ts
git commit -m "feat(soundsplit): blur-to-hide popover behavior with anti-flicker delay"
```

---

### Task 1.5: Add SoundSplit hotkey

**Files:**
- Modify: `src/shared/tool-ids.ts:38-41` (DEFAULT_HOTKEYS)
- Modify: `src/main/hotkeys.ts` (special SoundSplit handling)

**Step 1: Add hotkey to DEFAULT_HOTKEYS**

In `tool-ids.ts`, add to the `DEFAULT_HOTKEYS` object:

```typescript
export const DEFAULT_HOTKEYS: Partial<Record<ToolId, string>> = {
  [ToolId.FocusDim]: 'CommandOrControl+Shift+D',
  [ToolId.QuickBoard]: 'CommandOrControl+Shift+V',
  [ToolId.SoundSplit]: 'CommandOrControl+Shift+S'
}
```

**Step 2: Add special SoundSplit handling in hotkeys.ts**

Import `toggleSoundSplitPopover` from tray (or replicate the toggle logic). Since `tray.ts` has the toggle function but it depends on the module-scoped tray instance, the cleanest approach is to export `toggleSoundSplitPopover`:

In `tray.ts`, export the function:
```typescript
export function toggleSoundSplitPopover(): void {
  // ... (already written in Task 1.3)
}
```

In `hotkeys.ts`, update the handler:

```typescript
import { toggleSoundSplitPopover } from './tray'
```

In the `registerHotkeys` loop, add SoundSplit special handling alongside FocusDim:

```typescript
const registered = globalShortcut.register(accelerator, () => {
  if (toolId === ToolId.FocusDim) {
    getFocusDimService().toggle()
  } else if (toolId === ToolId.SoundSplit) {
    toggleSoundSplitPopover()
  } else {
    toggleTool(toolId as ToolId)
  }
})
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Manual test**

Run: `npm run dev`
- Press Ctrl+Shift+S → SoundSplit popover opens
- Press Ctrl+Shift+S again → popover closes
- Verify Ctrl+Shift+D and Ctrl+Shift+V still work

**Step 5: Commit**

```bash
git add src/shared/tool-ids.ts src/main/hotkeys.ts src/main/tray.ts
git commit -m "feat(soundsplit): add Ctrl+Shift+S hotkey for popover toggle"
```

---

## Phase 2: Output Device Enumeration

Add the ability to list all audio output devices. This is the prerequisite for per-app output routing and device switching.

### Task 2.1: Add device enumeration to the C# sidecar

**Files:**
- Modify: `src/main/sidecar/soundsplit-bridge.ts` (C# code + new command)

**Step 1: Add IMMDeviceCollection and IPropertyStore interfaces to C# code**

In the C# `Add-Type` block (inside `PS_SIDECAR_SCRIPT`), add these interfaces after the existing IAudioEndpointVolume interface (before the `AudioBridge` class):

```csharp
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
    [PreserveSig] int GetCount(out uint pcDevices);
    [PreserveSig] int Item(uint nDevice, out IMMDevice ppDevice);
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
    [PreserveSig] int GetCount(out uint cProps);
    [PreserveSig] int GetAt(uint iProp, out PropertyKey pkey);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant pv);
}

[StructLayout(LayoutKind.Sequential)]
struct PropertyKey {
    public Guid fmtid;
    public uint pid;
}

[StructLayout(LayoutKind.Sequential)]
struct PropVariant {
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public IntPtr data1;
    public IntPtr data2;
}
```

**Step 2: Add `GetDeviceName` helper and `ListDevices` method to AudioBridge class**

Inside the `AudioBridge` class, add:

```csharp
private static Guid IID_IPropertyStore = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
private static PropertyKey PKEY_Device_FriendlyName = new PropertyKey {
    fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
    pid = 14
};

private static string GetDeviceName(IMMDevice device) {
    try {
        object oProp;
        device.Activate(ref IID_IPropertyStore, 23, IntPtr.Zero, out oProp);
        var store = (IPropertyStore)oProp;
        PropVariant pv;
        store.GetValue(ref PKEY_Device_FriendlyName, out pv);
        if (pv.data1 != IntPtr.Zero) {
            string name = Marshal.PtrToStringUni(pv.data1);
            Marshal.FreeCoTaskMem(pv.data1);
            return name ?? "Unknown Device";
        }
        return "Unknown Device";
    } catch {
        return "Unknown Device";
    }
}

public static string ListDevices() {
    IMMDeviceEnumerator enumerator = null;
    try {
        enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IntPtr pCollection;
        // eRender=0, DEVICE_STATE_ACTIVE=1
        enumerator.EnumAudioEndpoints(0, 1, out pCollection);
        var collection = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pCollection);

        uint count;
        collection.GetCount(out count);

        // Get default device ID for comparison
        IMMDevice defaultDev;
        enumerator.GetDefaultAudioEndpoint(0, 1, out defaultDev);
        var defaultCtl2 = defaultDev as IAudioSessionControl2;

        var lines = new List<string>();
        for (uint i = 0; i < count; i++) {
            IMMDevice dev;
            collection.Item(i, out dev);
            string name = GetDeviceName(dev);
            // Get device ID via session identifier pattern
            string devId = i.ToString();
            bool isDefault = (i == 0); // simplified — will refine
            lines.Add(devId + "|" + name + "|" + (isDefault ? "1" : "0"));
            Marshal.ReleaseComObject(dev);
        }

        Marshal.ReleaseComObject(collection);
        if (defaultDev != null) Marshal.ReleaseComObject(defaultDev);
        return string.Join("\\n", lines);
    } finally {
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
    }
}
```

**IMPORTANT NOTE:** The `IMMDevice.Activate` with `IPropertyStore` GUID is the correct approach for getting device friendly names. However, `Activate` expects `ref Guid iid` — we need to use a different approach. The correct method is `IMMDevice.OpenPropertyStore`:

We need to add `OpenPropertyStore` to the `IMMDevice` interface. Update the interface:

```csharp
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    [PreserveSig] int GetId(out IntPtr ppstrId);
}
```

Then the `GetDeviceName` method becomes:

```csharp
private static string GetDeviceName(IMMDevice device) {
    try {
        IPropertyStore store;
        device.OpenPropertyStore(0, out store); // STGM_READ = 0
        PropVariant pv;
        store.GetValue(ref PKEY_Device_FriendlyName, out pv);
        string name = "Unknown Device";
        if (pv.data1 != IntPtr.Zero) {
            name = Marshal.PtrToStringUni(pv.data1) ?? "Unknown Device";
        }
        Marshal.ReleaseComObject(store);
        return name;
    } catch {
        return "Unknown Device";
    }
}
```

And update `ListDevices` to use `GetId` for device identification:

```csharp
public static string ListDevices() {
    IMMDeviceEnumerator enumerator = null;
    try {
        enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IntPtr pCollection;
        enumerator.EnumAudioEndpoints(0, 1, out pCollection);
        var collection = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(pCollection);

        uint count;
        collection.GetCount(out count);

        // Get default device ID
        IMMDevice defaultDev;
        enumerator.GetDefaultAudioEndpoint(0, 1, out defaultDev);
        IntPtr pDefaultId;
        defaultDev.GetId(out pDefaultId);
        string defaultId = Marshal.PtrToStringUni(pDefaultId) ?? "";
        Marshal.FreeCoTaskMem(pDefaultId);
        Marshal.ReleaseComObject(defaultDev);

        var lines = new List<string>();
        for (uint i = 0; i < count; i++) {
            IMMDevice dev;
            collection.Item(i, out dev);
            string name = GetDeviceName(dev);
            IntPtr pId;
            dev.GetId(out pId);
            string devId = Marshal.PtrToStringUni(pId) ?? "";
            Marshal.FreeCoTaskMem(pId);
            bool isDefault = (devId == defaultId);
            // Use index as short ID, pass full device ID for routing
            lines.Add(i + "|" + name + "|" + (isDefault ? "1" : "0") + "|" + devId);
            Marshal.ReleaseComObject(dev);
        }

        Marshal.ReleaseComObject(collection);
        return string.Join("\\n", lines);
    } finally {
        if (enumerator != null) Marshal.ReleaseComObject(enumerator);
    }
}
```

**Step 3: Add `list_devices` command to the PowerShell command loop**

In the command loop section of `PS_SIDECAR_SCRIPT`, add after the `set_master` handler:

```powershell
elseif ($line -eq "list_devices") {
    try {
        $result = [AudioBridge]::ListDevices()
        [Console]::Out.WriteLine("DEVICES:$result")
    } catch {
        [Console]::Error.WriteLine("ERR list_devices: $_")
        [Console]::Out.WriteLine("DEVICES:")
    }
}
```

**Step 4: Add TypeScript handler for DEVICES response and new public API**

In the `processOutput` method of `SoundSplitBridge`, add handling for `DEVICES:` prefix.

Add a new type and storage:

```typescript
export interface AudioDevice {
  index: number
  name: string
  isDefault: boolean
  deviceId: string
}
```

Add to the class:
```typescript
private devices: AudioDevice[] = []

getDevices(): AudioDevice[] {
  return [...this.devices]
}

refreshDevices(): void {
  this.sendCommand('list_devices')
}
```

In `processOutput`, add handling for `DEVICES:` lines (similar to `RESULT:` handling).

**Step 5: Add IPC channels for device enumeration**

In `src/shared/ipc-types.ts`, add:
```typescript
SOUNDSPLIT_GET_DEVICES: 'soundsplit:get-devices',
SOUNDSPLIT_REFRESH_DEVICES: 'soundsplit:refresh-devices',
```

In `src/main/ipc-handlers.ts`, add handlers:
```typescript
ipcMain.handle(
  IPC_INVOKE.SOUNDSPLIT_GET_DEVICES,
  (): AudioDevice[] => {
    return getSoundSplitBridge().getDevices()
  }
)

ipcMain.handle(
  IPC_INVOKE.SOUNDSPLIT_REFRESH_DEVICES,
  (): void => {
    getSoundSplitBridge().refreshDevices()
  }
)
```

Add push channel:
```typescript
SOUNDSPLIT_DEVICES_UPDATED: 'soundsplit:devices-updated',
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 7: Manual test**

Run: `npm run dev`
- Open SoundSplit, check console for device list
- Verify at least one device appears with correct name
- Verify default device is marked

**Step 8: Commit**

```bash
git add src/main/sidecar/soundsplit-bridge.ts src/shared/ipc-types.ts src/main/ipc-handlers.ts
git commit -m "feat(soundsplit): add output device enumeration via WASAPI"
```

---

### Task 2.2: Add device selector UI to renderer

**Files:**
- Modify: `src/renderer/src/tools/soundsplit/SoundSplit.tsx`
- Modify: `src/shared/ipc-types.ts` (import new channels)

**Step 1: Add device state and dropdown to SoundSplit component**

Add a system output device selector at the top of the UI (above master volume). This shows the current default device and allows switching.

Add state:
```typescript
const [devices, setDevices] = useState<AudioDevice[]>([])
const [showDeviceMenu, setShowDeviceMenu] = useState(false)
```

Add IPC for fetching devices on mount and listening for updates.

Render a clickable current device name that opens a dropdown of all devices. Clicking a device switches the system default output device (Phase 3 feature — for now, just display).

**Step 2: Style using DS tokens to match prototype**

Reference `prototypes/soundsplit-phase1.html` for the device chip styling with the small dropdown arrow.

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/tools/soundsplit/SoundSplit.tsx src/shared/ipc-types.ts
git commit -m "feat(soundsplit): add output device selector UI"
```

---

## Phase 3: Per-App Output Device Routing

This is the headline feature — route individual apps to different output devices.

### Task 3.1: Add IPolicyConfig COM interface to C# sidecar

**Files:**
- Modify: `src/main/sidecar/soundsplit-bridge.ts` (C# code)

**CRITICAL WARNING:** IPolicyConfig is an undocumented Windows COM interface. It works on Windows 10/11 but could break in future Windows updates. The GUID is `F8679F50-850A-41CF-9C72-430F290290C8` (pre-Win10 1803) or `568b9108-44bf-40b4-9006-86afe5b5c377` (Win10 1803+). We need both for compatibility.

**Step 1: Add IPolicyConfig interface definition**

In the C# code, add:

```csharp
// IPolicyConfig — undocumented COM interface for per-app audio routing
// GUID varies by Windows version
[ComImport, Guid("568b9108-44bf-40b4-9006-86afe5b5c377")]
class PolicyConfigClient {}

[ComImport, Guid("568b9108-44bf-40b4-9006-86afe5b5c377"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
    // Methods in vtable order — we only need SetDefaultEndpoint
    [PreserveSig] int GetMixFormat(string pwstrDeviceId, IntPtr ppFormat);
    [PreserveSig] int GetDeviceFormat(string pwstrDeviceId, int bDefault, IntPtr ppFormat);
    [PreserveSig] int ResetDeviceFormat(string pwstrDeviceId);
    [PreserveSig] int SetDeviceFormat(string pwstrDeviceId, IntPtr pEndpointFormat, IntPtr pMixFormat);
    [PreserveSig] int GetProcessingPeriod(string pwstrDeviceId, int bDefault, IntPtr pmftDefaultPeriod, IntPtr pmftMinimumPeriod);
    [PreserveSig] int SetProcessingPeriod(string pwstrDeviceId, IntPtr pmftPeriod);
    [PreserveSig] int GetShareMode(string pwstrDeviceId, IntPtr pMode);
    [PreserveSig] int SetShareMode(string pwstrDeviceId, IntPtr pMode);
    [PreserveSig] int GetPropertyValue(string pwstrDeviceId, int bFx, ref PropertyKey pKey, out PropVariant pv);
    [PreserveSig] int SetPropertyValue(string pwstrDeviceId, int bFx, ref PropertyKey pKey, ref PropVariant pv);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, int eRole);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string wszDeviceId, int bVisible);
}
```

**Step 2: Add SetDefaultDevice method to AudioBridge**

```csharp
public static bool SetDefaultDevice(string deviceId) {
    try {
        var config = (IPolicyConfig)(new PolicyConfigClient());
        // eConsole=0, eMultimedia=1, eCommunications=2
        int hr0 = config.SetDefaultEndpoint(deviceId, 0);
        int hr1 = config.SetDefaultEndpoint(deviceId, 1);
        Marshal.ReleaseComObject(config);
        return (hr0 == S_OK || hr1 == S_OK);
    } catch {
        return false;
    }
}
```

**Step 3: Add `set_default_device` command to PowerShell loop**

```powershell
elseif ($line.StartsWith("set_default_device ")) {
    try {
        $deviceId = $line.Substring(19).Trim()
        $ok = [AudioBridge]::SetDefaultDevice($deviceId)
        [Console]::Out.WriteLine("OK:$ok")
    } catch {
        [Console]::Error.WriteLine("ERR set_default_device: $_")
        [Console]::Out.WriteLine("OK:False")
    }
}
```

**Step 4: Add TypeScript API**

```typescript
setDefaultDevice(deviceId: string): void {
  this.sendCommand(`set_default_device ${deviceId}`)
  // Refresh device list after a short delay to update isDefault flags
  setTimeout(() => this.refreshDevices(), 500)
}
```

**Step 5: Add IPC channel**

In `ipc-types.ts`:
```typescript
SOUNDSPLIT_SET_DEFAULT_DEVICE: 'soundsplit:set-default-device',
```

In `ipc-handlers.ts`:
```typescript
ipcMain.handle(
  IPC_INVOKE.SOUNDSPLIT_SET_DEFAULT_DEVICE,
  (_event, deviceId: string): void => {
    getSoundSplitBridge().setDefaultDevice(deviceId)
  }
)
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 7: Manual test**

Run: `npm run dev`
- Open SoundSplit
- Click device selector dropdown
- Switch to a different output device
- Verify audio actually routes to the new device
- Verify the dropdown updates to show the new default

**Step 8: Commit**

```bash
git add src/main/sidecar/soundsplit-bridge.ts src/shared/ipc-types.ts src/main/ipc-handlers.ts
git commit -m "feat(soundsplit): system default device switching via IPolicyConfig"
```

---

### Task 3.2: Add per-app output routing UI

**Files:**
- Modify: `src/renderer/src/tools/soundsplit/SoundSplit.tsx`

**Step 1: Add output device chip to each app row**

Following the prototype, each app row gets a small chip showing its current output device. Clicking it opens a dropdown to route that app to a different device.

Initially, per-app routing will use the same `SetDefaultDevice` for the whole system. True per-app routing requires `IAudioSessionControl2.SetSessionIdentifier` or the AudioGraph API, which is a more complex task. For MVP, the chip shows "System Default" for all apps, with a note that per-app routing is planned.

**NOTE:** True per-app output routing (different apps to different physical devices simultaneously) is NOT possible via standard WASAPI. It requires:
1. Virtual audio cable approach (creating virtual devices and routing)
2. Or the AudioDeviceGraph API (Windows 10+ undocumented)
3. Or third-party virtual audio drivers

For Phase 1, we implement **system-wide device switching** only. Per-app device routing will be a future phase requiring significant R&D.

**Step 2: Render device chips in app rows**

Each app row shows which output device it's using (all show "System Default" initially).

**Step 3: Verify build and commit**

```bash
git add src/renderer/src/tools/soundsplit/SoundSplit.tsx
git commit -m "feat(soundsplit): add per-app output device chip UI (system-wide switching)"
```

---

## Phase 4: Settings Panel

### Task 4.1: Expand SoundSplitConfig schema

**Files:**
- Modify: `src/shared/config-schemas.ts:56-61`

**Step 1: Add new config fields**

Expand `SoundSplitConfig`:

```typescript
export interface SoundSplitConfig {
  show_master_volume: boolean
  auto_show_new_apps: boolean
  hide_on_startup: boolean
  remember_volumes: boolean
  // New fields
  hidden_apps: string[]           // Process names to hide from the mixer
  max_volume_apps: Record<string, number>  // Process name -> max volume (0-100)
  show_vu_meters: boolean
  compact_mode: boolean
}
```

Update `DEFAULT_CONFIGS`:

```typescript
[ToolId.SoundSplit]: {
  show_master_volume: true,
  auto_show_new_apps: true,
  hide_on_startup: true,
  remember_volumes: true,
  hidden_apps: [],
  max_volume_apps: {},
  show_vu_meters: true,
  compact_mode: false
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/shared/config-schemas.ts
git commit -m "feat(soundsplit): expand config schema with hidden apps, max volume, VU meters"
```

---

### Task 4.2: Build settings panel in renderer

**Files:**
- Modify: `src/renderer/src/tools/soundsplit/SoundSplit.tsx`

**Step 1: Add settings panel state**

```typescript
const [showSettings, setShowSettings] = useState(false)
const [config, setConfig] = useState<SoundSplitConfig>(DEFAULT_CONFIG)
```

**Step 2: Build settings panel UI**

Following the prototype (`prototypes/soundsplit-phase1.html`), add a slide-in settings panel from the right side with:

- **Behavior section:** Toggle switches for "Remember volumes", "Auto-show new apps", "Show VU meters", "Compact mode"
- **Device Management section:** List of detected devices with show/hide toggles and max volume sliders
- **Hidden Apps section:** List of hidden process names with ability to unhide

Each toggle calls `CONFIG_SET` IPC to persist changes immediately.

**Step 3: Add gear icon button to the header**

Replace or add a gear icon in the SoundSplit header bar that toggles `showSettings`.

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 5: Manual test**

- Click gear icon → settings panel slides in
- Toggle "Show VU meters" → VU meters hide/show in real-time
- Toggle "Remember volumes" → verify volumes are/aren't persisted
- Click gear again → settings panel slides out

**Step 6: Commit**

```bash
git add src/renderer/src/tools/soundsplit/SoundSplit.tsx
git commit -m "feat(soundsplit): add settings panel with behavior toggles and device management"
```

---

## Phase 5: Presets (Quick Configs)

### Task 5.1: Add presets storage

**Files:**
- Create: `src/main/services/soundsplit-presets.ts`
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/main/ipc-handlers.ts`

**Step 1: Create presets service**

```typescript
// src/main/services/soundsplit-presets.ts
import Store from 'electron-store'

export interface SoundSplitPreset {
  id: string
  name: string
  icon: string  // emoji
  sessions: Array<{
    name: string  // process name (not PID — PIDs change)
    volume: number
    muted: boolean
  }>
  masterVolume: number
  createdAt: number
}

interface PresetStore {
  presets: SoundSplitPreset[]
}

const store = new Store<PresetStore>({
  name: 'soundsplit-presets',
  clearInvalidConfig: true,
  defaults: { presets: [] }
})

export function getPresets(): SoundSplitPreset[] {
  return store.get('presets', [])
}

export function savePreset(preset: SoundSplitPreset): void {
  const presets = getPresets()
  const existing = presets.findIndex(p => p.id === preset.id)
  if (existing >= 0) {
    presets[existing] = preset
  } else {
    presets.push(preset)
  }
  store.set('presets', presets)
}

export function deletePreset(id: string): void {
  const presets = getPresets().filter(p => p.id !== id)
  store.set('presets', presets)
}
```

**Step 2: Add IPC channels**

In `ipc-types.ts`:
```typescript
SOUNDSPLIT_GET_PRESETS: 'soundsplit:get-presets',
SOUNDSPLIT_SAVE_PRESET: 'soundsplit:save-preset',
SOUNDSPLIT_DELETE_PRESET: 'soundsplit:delete-preset',
SOUNDSPLIT_APPLY_PRESET: 'soundsplit:apply-preset',
```

**Step 3: Add IPC handlers**

In `ipc-handlers.ts`, add handlers that:
- `GET_PRESETS`: returns all presets
- `SAVE_PRESET`: saves a new preset (takes current sessions snapshot)
- `DELETE_PRESET`: removes a preset by ID
- `APPLY_PRESET`: iterates preset sessions, matches by process name to current sessions, applies volume/mute

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/main/services/soundsplit-presets.ts src/shared/ipc-types.ts src/main/ipc-handlers.ts
git commit -m "feat(soundsplit): add preset storage and IPC channels"
```

---

### Task 5.2: Build presets UI in renderer

**Files:**
- Modify: `src/renderer/src/tools/soundsplit/SoundSplit.tsx`

**Step 1: Add presets panel state**

```typescript
const [showPresets, setShowPresets] = useState(false)
const [presets, setPresets] = useState<SoundSplitPreset[]>([])
const [showSaveModal, setShowSaveModal] = useState(false)
```

**Step 2: Build presets panel UI**

Following the prototype, add a slide-in presets panel from the left side with:
- Preset cards showing name, icon, and per-app tags (volume summaries)
- "Apply" button on each preset card
- Star icon in header bar to toggle presets panel
- Save modal with name input and emoji icon picker

**Step 3: Add star icon button to header**

Place next to the gear icon. Clicking toggles the presets panel.

**Step 4: Add save modal**

Modal overlay with:
- Text input for preset name
- Emoji grid picker for icon
- "Save" button that snapshots current sessions and calls `SAVE_PRESET`
- Toast notification on save

**Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

**Step 6: Manual test**

- Set up some app volumes (Spotify at 60%, Chrome at 30%)
- Click star → presets panel opens
- Click "Save Current" → save modal appears
- Enter name "Music Mode", pick music emoji → save
- Change volumes around
- Click the preset card → volumes restore to saved state
- Delete a preset → confirm it's removed

**Step 7: Commit**

```bash
git add src/renderer/src/tools/soundsplit/SoundSplit.tsx
git commit -m "feat(soundsplit): add presets panel with save/load/delete UI"
```

---

## Future Phases (Not Yet Planned in Detail)

### Phase 6: Per-App EQ & Effects
- Requires Windows Audio Session API (WASAPI) render processing
- Magic Boost (loudness normalization), Balance control, basic EQ bands
- Significant R&D needed — may require a native C++ audio processing pipeline

### Phase 7: Output Groups
- Group multiple apps to the same output device with shared settings
- Drag-and-drop grouping UI
- Group-level volume control

### Phase 8: Advanced Routing
- True per-app output device routing (requires virtual audio devices)
- Research: Windows Audio Device Graph Isolation, virtual audio cable integration
- May need a kernel-mode audio driver or partnership with VB-Audio/VoiceMeeter

---

## Key Technical Warnings

1. **PowerShell C# here-strings:** NEVER use `$` for C# string interpolation inside `@"..."@` — PowerShell expands it. Use `String.Format()` or concatenation.
2. **`$pid` is reserved in PowerShell** — always use `$targetPid` for process IDs.
3. **`$ErrorActionPreference = 'SilentlyContinue'`** — NEVER set globally, it masks Add-Type compilation errors.
4. **IPolicyConfig is undocumented** — test on multiple Windows versions, add try/catch fallback.
5. **alwaysOnTop `'screen-saver'` level** — required for popover to stay above fullscreen apps on Windows. Must re-assert on blur/show/restore.
6. **COM object cleanup** — always `Marshal.ReleaseComObject()` in finally blocks to prevent memory leaks.
7. **IMMDevice interface has vtable order dependency** — methods must be declared in exact COM vtable order or marshalling fails silently.

---

## File Dependency Map for This Plan

| Change | Files to Touch |
|--------|---------------|
| New IPC channel | `ipc-types.ts` → `ipc-handlers.ts` → `SoundSplit.tsx` |
| New sidecar command | `soundsplit-bridge.ts` (C# + PS + TS) → `ipc-handlers.ts` → `ipc-types.ts` → `SoundSplit.tsx` |
| New config field | `config-schemas.ts` → `soundsplit-bridge.ts` (if backend reads it) → `SoundSplit.tsx` |
| Window behavior | `windows.ts` → `tray.ts` (if positioning) |
| New hotkey | `tool-ids.ts` → `hotkeys.ts` → `tray.ts` (if special handling) |
