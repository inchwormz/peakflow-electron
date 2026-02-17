# PeakFlow: Website vs Reality — Gap Analysis & Roadmap

> Updated: 2026-02-17
> Goal: Ensure every feature claimed on getpeakflow.pro actually works in the app.

---

## Gap Analysis

### Legend
- **WORKING** = Fully implemented and functional
- **PARTIAL** = Some functionality but key parts missing
- **MOCK** = UI exists but backend is fake/simulated
- **MISSING** = Claimed on website, not implemented at all

---

### Tool-by-Tool Status

#### 1. LiquidFocus (Pomodoro Timer)

| Website Claim | Status | Notes |
|---|---|---|
| Pomodoro timer (25/5/15) | **WORKING** | Timer service in main process |
| Customizable intervals | **WORKING** | Settings wired to config |
| Task management | **WORKING** | Add/edit/complete/delete |
| Daily goals & streak tracking | **WORKING** | Stats view with 7-day chart |
| Todoist integration | **WORKING** | Real OAuth2, can pull tasks |
| Webcam focus detection | **WORKING** | TensorFlow.js BlazeFace, on-device, ~3 FPS, configurable threshold |
| auto_start_breaks toggle | **WORKING** | Toggle wired in SettingsView, finishPhase() uses config value |

#### 2. FocusDim (Window Dimmer)

| Website Claim | Status | Notes |
|---|---|---|
| Dims inactive windows | **WORKING** | Real Win32 GetForegroundWindow tracking via koffi FFI |
| Adjustable dim intensity (30-85%) | **WORKING** | Opacity slider works |
| Multi-monitor support | **WORKING** | Overlay spans all monitors |
| Active window border highlight | **WORKING** | Purple glow toggle |
| Smooth fade animations | **WORKING** | Configurable duration |
| Global hotkey (Ctrl+Shift+D) | **WORKING** | Registered |
| Click-through overlay | **WORKING** | setIgnoreMouseEvents |

**Fixed**: Now uses real Win32 API via koffi for foreground window tracking.

#### 3. QuickBoard (Clipboard Manager)

| Website Claim | Status | Notes |
|---|---|---|
| 100+ item clipboard history | **WORKING** | Max 100 items, 500ms polling |
| Full-text search | **WORKING** | Search UI works |
| Pin favorites | **WORKING** | Pin/unpin functional |
| Image preview | **WORKING** | Base64 storage |
| Password detection | **WORKING** | Secret detection filter |
| Global hotkey (Ctrl+Shift+V) | **WORKING** | Registered |
| Auto-paste on select | **WORKING** | Ctrl+V simulation via Win32 SendInput (koffi) |
| Plain text paste mode | **WORKING** | simulatePaste(id, plainText=true) strips formatting |

#### 4. ScreenSlap (Calendar Alerts)

| Website Claim | Status | Notes |
|---|---|---|
| Full-screen takeover alerts | **WORKING** | Fullscreen always-on-top window |
| Google Calendar sync | **WORKING** | Real OAuth2 + event polling |
| One-click meeting join | **WORKING** | Zoom/Meet/Teams/Webex detection |
| Snooze options | **WORKING** | Snooze with configurable duration |
| Multi-monitor alerts | **PARTIAL** | Shows on primary monitor only |
| Configurable alert timing | **WORKING** | Threshold configurable |

#### 5. MeetReady (Camera & Mic Check)

| Website Claim | Status | Notes |
|---|---|---|
| Camera preview | **WORKING** | Live video feed |
| Mic level visualization | **WORKING** | Real-time VU meter |
| Lighting quality indicator | **WORKING** | 5-level detection |
| System tray access | **WORKING** | Tray menu item |
| Auto-popup before meetings | **WORKING** | Calendar integration |
| Google Calendar integration | **WORKING** | Shared with ScreenSlap |
| Device selection | **WORKING** | Camera/mic dropdowns |

**No gaps.** This tool is production-ready.

#### 6. SoundSplit (Per-App Volume Control)

| Website Claim | Status | Notes |
|---|---|---|
| Per-app volume sliders | **WORKING** | Real WASAPI via PowerShell sidecar with C# COM interop |
| Real-time VU meters | **WORKING** | IAudioMeterInformation peak polling (150ms) |
| Quick-mute any app | **WORKING** | ISimpleAudioVolume.SetMute via sidecar |
| Master volume control | **WORKING** | IAudioEndpointVolume via sidecar |
| Auto-detect running apps | **WORKING** | IAudioSessionEnumerator polling |
| Persistent preferences | **WORKING** | electron-store keyed by process name, auto-restores on app detection |

**Fixed**: Replaced mock with real WASAPI bridge (persistent PowerShell sidecar with compiled C# COM interop).

---

### Infrastructure

| Website Claim | Status | Notes |
|---|---|---|
| 14-day free trial | **WORKING** | Trial gating enforced via openToolWithAccessCheck() |
| $5/month subscription | **WORKING** | LemonSqueezy + license check enforced on all tool windows |
| Zero telemetry | **WORKING** | No tracking code present |
| Individual tool downloads | **MISSING** | No standalone executables |
| Suite installer | **WORKING** | NSIS installer via electron-builder (npm run build:win) |
| Windows 10 & 11 | **WORKING** | Electron supports both |

---

## Priority Roadmap

### ~~P0 — Deceptive if not fixed~~ ✅ DONE

| # | Task | Tool | Status |
|---|---|---|---|
| 1 | ~~Replace mock with real WASAPI audio sessions~~ | SoundSplit | ✅ PowerShell sidecar with C# COM interop |
| 2 | ~~Replace demo rectangle with real GetForegroundWindow~~ | FocusDim | ✅ koffi FFI + DwmGetWindowAttribute |

### ~~P1 — Broken promises~~ ✅ DONE

| # | Task | Tool | Status |
|---|---|---|---|
| 3 | ~~Implement Ctrl+V paste simulation~~ | QuickBoard | ✅ koffi SendInput |
| 4 | ~~Implement plain text paste mode~~ | QuickBoard | ✅ plainText param |
| 5 | ~~Wire auto_start_breaks toggle~~ | LiquidFocus | ✅ Was already wired |
| 6 | ~~Enforce trial/license gating on tool launch~~ | Infrastructure | ✅ openToolWithAccessCheck() |

### ~~P2 — Aspirational (complex feature)~~ ✅ DONE

| # | Task | Tool | Status |
|---|---|---|---|
| 7 | ~~Webcam focus detection (face tracking)~~ | LiquidFocus | ✅ BlazeFace model, FocusDetector component, settings toggle |

### ~~P3 — Remaining ship requirements~~ ✅ MOSTLY DONE

| # | Task | Tool | Status |
|---|---|---|---|
| 8 | ~~Build NSIS installer~~ | Infrastructure | ✅ Already configured in electron-builder.yml |
| 9 | ~~Wire auto-updater~~ | Infrastructure | ✅ electron-updater + tray button + startup check |
| 10 | App icon (replace placeholder) | Infrastructure | Pending (needs design asset) |
| 11 | ~~SoundSplit persistent volume preferences~~ | SoundSplit | ✅ electron-store, restore on app detection |
