# PeakFlow Electron — Ship Roadmap

> Goal: Ship PeakFlow as a working product with NSIS installer on GitHub Releases, 14-day trial enforcement, LemonSqueezy payment, and all 6 tools fully functional.

---

## Current State

| Tool | UI | Backend | What's Missing |
|------|-----|---------|----------------|
| LiquidFocus | Done | Done | `auto_start_breaks` toggle is a no-op (not in config schema, hardcoded `checked={false}`) |
| FocusDim | Done | Partial | Uses demo rectangle — needs native `GetForegroundWindow` tracking via `node-ffi-napi` |
| QuickBoard | Done | Partial | Copies to clipboard but can't inject Ctrl+V keystroke (needs `nut-js` or `node-ffi-napi`) |
| ScreenSlap | Done | Partial | Google Calendar is mock — needs real OAuth2 BrowserWindow flow + token refresh |
| MeetReady | Done | Partial | Camera/mic real, but calendar integration is same mock as ScreenSlap |
| SoundSplit | Done | Mock | Python sidecar stub — needs real `pycaw`/WASAPI implementation |

### Critical Missing Systems

1. **No dashboard** — tray double-click opens LiquidFocus, no suite hub
2. **No trial enforcement** — `checkAccess()` returns `allowed: false` but nothing blocks tools
3. **No license entry point** — `TrialExpired.tsx` exists but is never rendered
4. **No auto-updater** — `electron-updater` installed but not wired
5. **No CI/CD** — no GitHub Actions, releases must be manual
6. **Tool windows not always-on-top** — only QuickBoard is; LiquidFocus should be

---

## Roadmap

### Phase 1: Fix Known Bugs & Quick Wins
> Get the existing build into a testable state

**1.1 — Dashboard hub window**
- Build a proper `Dashboard.tsx` component (6-tool grid with status indicators, tool launch buttons)
- Add `SystemWindowId.Dashboard` and window config
- Tray double-click opens Dashboard instead of LiquidFocus
- Each tool card launches its tool window

**1.2 — LiquidFocus `auto_start_breaks` toggle**
- Add `auto_start_breaks: boolean` to `LiquidFocusConfig` in `config-schemas.ts`
- Add default (`false`) to `DEFAULT_CONFIGS`
- Wire the toggle in `SettingsView.tsx` BehaviorTab (currently hardcoded `checked={false}` with empty `onChange`)
- Implement auto-start logic in `liquidfocus.ts` timer service

**1.3 — Window always-on-top fixes**
- Set `alwaysOnTop: true` for LiquidFocus in `WINDOW_CONFIGS`
- Verify FocusDim overlay is `alwaysOnTop` (it creates its own BrowserWindow, not via `WINDOW_CONFIGS` — already set correctly in `focus-dim.ts`)

**1.4 — FocusDim startup fix** (already done)
- `init()` now always sets `enabled: false` — no auto-dim on startup

**Files touched**: `config-schemas.ts`, `SettingsView.tsx`, `liquidfocus.ts`, `windows.ts`, `tray.ts`, `App.tsx`, new `Dashboard.tsx`

---

### Phase 2: Trial Enforcement & Payment Flow
> Users must not be able to use tools after 14 days without paying

**2.1 — Enforce access check on tool launch**
- In `createToolWindow()` (windows.ts): call `checkAccess()` before creating window
- If `allowed: false`: create `TrialExpired` window instead of the requested tool
- Block hotkey-triggered tools the same way (in `hotkeys.ts`)

**2.2 — Wire TrialExpired into the renderer**
- Add `SystemWindowId.TrialExpired` routing in `App.tsx`
- Render `TrialExpired.tsx` component (already built, just not routed)
- On successful license activation: close TrialExpired window, open the originally requested tool

**2.3 — Add license activation to tray menu**
- Add "Activate License" menu item in `tray.ts`
- Opens a small window with the `LicenseActivation.tsx` component
- Also add license status to tray tooltip: "PeakFlow — 7 days left" or "PeakFlow — Licensed"

**2.4 — Trial countdown nudges**
- At 7, 3, and 1 days remaining: show a non-blocking notification (Electron `Notification` API)
- StatusBar already shows trial countdown — verify it renders correctly

**2.5 — LemonSqueezy end-to-end test**
- Test the full flow: trial expires → TrialExpired shown → user clicks Subscribe → pays on getpeakflow.pro → enters license key → activation succeeds → tools unlock
- Verify 30-day validation cache works
- Verify offline tolerance (cached key still works without internet)

**Files touched**: `windows.ts`, `hotkeys.ts`, `App.tsx`, `tray.ts`, `index.ts`, new notification logic

---

### Phase 3: Native Integrations
> Make the core tools actually work for real

**3.1 — FocusDim: native foreground window tracking**
- Install `node-ffi-napi` (or `koffi`) as dependency
- Create `src/main/native/active-window.ts`
- Call `GetForegroundWindow()` + `GetWindowRect()` via Windows API FFI
- Replace the demo rectangle in `focus-dim.ts trackActiveWindow()` with real bounds
- Handle edge cases: fullscreen apps, multi-monitor, DPI scaling

**3.2 — QuickBoard: paste simulation**
- Install `nut-js` (or use `node-ffi-napi` to call `SendInput`)
- After writing to clipboard, simulate Ctrl+V keystroke
- Replace TODO at `clipboard.ts` line 342/364
- Add small delay (50-100ms) between clipboard write and keystroke

**3.3 — Google Calendar: real OAuth2 flow**
- Create Google Cloud project with Calendar API (user already has this)
- Implement `BrowserWindow` popup OAuth flow in `google-calendar.ts`:
  - Open `accounts.google.com/o/oauth2/v2/auth` in a frameless BrowserWindow
  - Listen for redirect to `http://localhost:{port}` loopback
  - Exchange auth code for access + refresh tokens
  - Store tokens via `credentials.ts` (encrypted)
- Implement token refresh logic (access tokens expire after 1 hour)
- Replace mock `fetchEvents()` with real `calendar.events.list()` call
- Handle disconnect: revoke token + clear stored credentials

**3.4 — SoundSplit: real Python sidecar**
- Implement real WASAPI calls in `sidecar/soundsplit_sidecar.py` using `pycaw`:
  - `get_sessions()`: enumerate active audio sessions with `AudioUtilities.GetAllSessions()`
  - `set_volume(pid, volume)`: set per-app volume via `ISimpleAudioVolume`
  - `set_mute(pid, muted)`: mute/unmute per-app
  - `get_master()` / `set_master()`: master volume via `AudioEndpoints`
- Add `requirements.txt`: `pycaw`, `comtypes`, `psutil`
- Bundle with PyInstaller → `sidecar/dist/soundsplit_sidecar/`
- Update `soundsplit-bridge.ts` to spawn the real sidecar process via `child_process.spawn()`
- Handle sidecar lifecycle: spawn on init, restart on crash, kill on destroy
- Parse JSON-RPC responses from stdout

**Files touched**: new `native/active-window.ts`, `focus-dim.ts`, `clipboard.ts`, `google-calendar.ts`, `soundsplit_sidecar.py`, `soundsplit-bridge.ts`, `package.json`

---

### Phase 4: Build, Installer & Distribution
> Package and ship to users

**4.1 — App icon**
- Replace the placeholder amber circle tray icon with a real `.ico` file
- Add `resources/icon.ico` (256x256, multi-res)
- Update `tray.ts` to use `nativeImage.createFromPath()`

**4.2 — NSIS installer build**
- `electron-builder.yml` is already configured for NSIS
- Verify `npm run build:win` produces a working installer in `release/`
- Test install → run → uninstall cycle
- Ensure sidecar is bundled correctly in `resources/sidecar/`

**4.3 — Auto-updater**
- Wire `electron-updater` in `index.ts`:
  - `autoUpdater.checkForUpdatesAndNotify()` on startup
  - Periodic check every 6 hours
- Implement "Check for Updates" tray menu item (currently a no-op in `tray.ts`)
- Configure update feed from GitHub Releases

**4.4 — GitHub Releases workflow**
- Create `.github/workflows/release.yml`:
  - Trigger on push tag `v*`
  - Build with `npm run build:win`
  - Upload installer artifacts to GitHub Release
  - Auto-create release notes from commits
- First release: `v1.0.0`

**4.5 — Website download flow**
- Download button on `getpeakflow.pro` → GitHub Releases URL
- Obscure GitHub: use a redirect or direct `.exe` download link
- Verify the existing download links in `projects/peakflow-website/index.html` point to the right release URL

**Files touched**: `tray.ts`, `index.ts`, `electron-builder.yml`, new `.github/workflows/release.yml`, website `index.html`

---

### Phase 5: Polish & Edge Cases
> Production hardening

**5.1 — Error handling**
- Graceful failure when sidecar crashes (SoundSplit shows "reconnecting...")
- Calendar OAuth token refresh failure → show "reconnect" prompt
- License validation network failure → trust cached key (already implemented, verify)

**5.2 — First-run experience**
- On very first launch: show Dashboard with a subtle welcome state
- Auto-connect tray tooltip: "PeakFlow — 14 days free trial"

**5.3 — Settings panel**
- Add a global Settings window (SystemWindowId.Settings is already defined)
- Sections: License management, startup behavior (run on login), hotkey customization, about/version
- "Run on login" toggle → Electron `app.setLoginItemSettings()`

**5.4 — Distraction blocking (LiquidFocus)**
- Currently the blocked sites list is stored but not enforced
- Option A: Modify hosts file during focus sessions (requires admin)
- Option B: Use a local proxy or Electron `session.webRequest` (only blocks in-app)
- Recommend: Skip for v1, mark as "coming soon"

**5.5 — Final QA pass**
- Test all 6 tools end-to-end
- Test trial expiry flow
- Test license activation flow
- Test installer on clean Windows machine
- Test auto-updater
- Test uninstall (clean removal)

---

## Priority Order

| Priority | Phase | Effort | Why |
|----------|-------|--------|-----|
| 1 | Phase 1 (Bugs) | 1-2 days | Broken toggles and missing dashboard make it untestable |
| 2 | Phase 2 (Trial/Payment) | 2-3 days | Can't ship without payment enforcement |
| 3 | Phase 3 (Native) | 5-7 days | Makes tools actually useful (biggest effort) |
| 4 | Phase 4 (Distribution) | 2-3 days | Package and ship |
| 5 | Phase 5 (Polish) | 2-3 days | Production hardening |

**Total estimate: ~2-3 weeks to ship v1.0.0**

---

## Files Inventory (Key Files to Modify)

### Main Process
- `src/main/index.ts` — startup, auto-updater init
- `src/main/tray.ts` — dashboard launch, license menu, icon
- `src/main/windows.ts` — access check enforcement, dashboard window
- `src/main/hotkeys.ts` — access check before toggling
- `src/main/ipc-handlers.ts` — any new IPC channels
- `src/main/services/focus-dim.ts` — native window tracking
- `src/main/services/clipboard.ts` — paste simulation
- `src/main/services/google-calendar.ts` — real OAuth
- `src/main/services/liquidfocus.ts` — auto-start breaks
- `src/main/sidecar/soundsplit-bridge.ts` — real sidecar spawning
- `sidecar/soundsplit_sidecar.py` — real pycaw implementation

### Renderer
- `src/renderer/src/App.tsx` — dashboard route, trial-expired route
- `src/renderer/src/tools/liquidfocus/SettingsView.tsx` — auto_start toggle
- New: `src/renderer/src/tools/dashboard/Dashboard.tsx`

### Shared
- `src/shared/config-schemas.ts` — add auto_start_breaks
- `src/shared/tool-ids.ts` — dashboard SystemWindowId (already has it?)

### Build & CI
- `electron-builder.yml` — verify config
- `package.json` — new deps (node-ffi-napi or koffi, nut-js)
- New: `.github/workflows/release.yml`
- `resources/icon.ico` — real app icon
