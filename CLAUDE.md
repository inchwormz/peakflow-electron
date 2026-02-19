## PeakFlow Electron App

### Architecture
- Tray-resident Electron app (no main window) — tools open as separate BrowserWindows
- Main process: `src/main/` — IPC handlers, services, native FFI, sidecar processes
- Renderer: `src/renderer/` — React tools, each in `tools/<toolname>/`
- Shared types: `src/shared/` — IPC channel defs (`ipc-types.ts`), tool IDs (`tool-ids.ts`)
- Per-tool local DS (Design System) token objects — NOT a centralized theme

### Code Paths to Know
- **SoundSplit active path:** `src/main/sidecar/soundsplit-bridge.ts` (persistent PowerShell sidecar via stdin/stdout)
- **SoundSplit legacy fallback:** `src/main/native/audio-sessions.ts` (execSync per-call, uses `-EncodedCommand`)
- **FocusDim overlay:** CSS `clip-path polygon(evenodd, ...)` via `executeJavaScript` on transparent overlay window
- **Active window tracking:** `src/main/native/active-window.ts` — koffi FFI for Win32 `GetForegroundWindow`/`DwmGetWindowAttribute`
- **Trial/licensing:** `src/main/security/trial.ts` — safeStorage encrypted, 14-day trial

### Gotchas
- **audio-sessions.ts vs soundsplit-bridge.ts:** Legacy file is fallback, not primary. But it DOES get triggered (sidecar fail, permissions, AV blocks) — don't ignore bugs in it.
- **koffi out-params work on plain objects:** `koffi.out(koffi.pointer(STRUCT))` mutates JS objects in place — this is correct behavior.
- **Electron alwaysOnTop drops after hide/show:** Must re-assert `win.setAlwaysOnTop(true)` when re-showing hidden windows.
- **clip-path polygon for cutouts:** Use `polygon(evenodd, outer-CW, inner-CCW)` — NOT a single-path winding approach.
- **PowerShell C# scripts:** NEVER use `-Command` with `.replace(/\n/g, ' ')` — it breaks `//` comments. Use `-EncodedCommand` with base64 UTF-16LE.
- **C# inside PowerShell `@"..."@` here-strings — NEVER use `$` in C# code:**
  - PowerShell `@"..."@` expands `$` as variable interpolation BEFORE the C# compiler sees it
  - C# string interpolation `$"text {var}"` WILL BREAK — PowerShell eats the `$`
  - Use `String.Format()` or string concatenation instead
  - `$ErrorActionPreference = 'SilentlyContinue'` masks Add-Type compilation errors — NEVER set it globally
  - Always wrap `Add-Type` in try/catch with error logging
  - **19+ fix attempts failed because this was invisible** — do not revert these protections
- **PowerShell reserved variables:** `$pid` is read-only (returns PowerShell's PID). Use `$targetPid` for app PIDs.
- **PowerShell `-File` mode output:** Use `[Console]::Out.WriteLine()` not `Write-Host` — Write-Host goes to stream #6, not stdout.
- **Window close interceptors:** Use lazy `require()` inside event handlers to avoid circular deps at module load time.
- **Silent catch {} in C# COM interop:** Always log errors — empty catches hide real failures and make debugging impossible.

### Build & Run
- `npm run build` — electron-vite builds main + preload + renderer
- `npm run dev` — hot-reload dev mode (main + renderer)
- `npm run lint` — TypeScript type checking (`npm run typecheck`)
- `npm run build:win` — package as Windows NSIS installer → `release/`
- `npx electron .` — run from project root (single-instance lock enforced)
- Kill existing: `cmd /c "taskkill /F /IM electron.exe"` (git bash needs `//F //IM`)

### Tools
| Tool | ID | Window Type |
|------|----|-------------|
| Dashboard | `dashboard` (SystemWindowId) | Hub — opens all other tools |
| QuickBoard | `quickboard` | Clipboard manager, always-on-top |
| FocusDim | `focusdim` | Dims everything except active window |
| LiquidFocus | `liquidfocus` | Pomodoro timer with webcam focus detection |
| SoundSplit | `soundsplit` | Per-app volume mixer (WASAPI via PowerShell sidecar) |
| ScreenSlap | `screenslap` | Meeting alerts from Google Calendar |
| MeetReady | `meetready` | Pre-meeting camera/mic/lighting check + OAuth calendar |

### IPC Pattern
- `IPC_INVOKE` (request/response): renderer calls `window.peakflow.invoke(channel, ...args)` → main handler returns value
- `IPC_SEND` (push): main calls `win.webContents.send(channel, data)` → renderer listens via `window.peakflow.on(channel, cb)`
- Channels defined in `src/shared/ipc-types.ts`

### Key Config Files
- `electron.vite.config.ts` — Vite config with React + Tailwind CSS plugins
- `electron-builder.yml` — NSIS packaging config (appId: `pro.getpeakflow.core`)
- `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` — TS strict mode, path aliases

### Code Style
- No eslint/prettier — relies on TypeScript strict mode + editor formatting
- Inline styles with per-tool DS token objects (not Tailwind utility classes in components)
- Tailwind used only for base/reset layer via `@tailwindcss/vite`

### File Dependency Map (change one → update the others)
- **Adding/changing an IPC channel:**
  1. `src/shared/ipc-types.ts` — add channel name to IPC_INVOKE or IPC_SEND
  2. `src/main/ipc-handlers.ts` — add `ipcMain.handle()` handler
  3. `src/preload/index.ts` — expose via contextBridge if new pattern
  4. `src/renderer/src/tools/<tool>/<Tool>.tsx` — call via `window.peakflow.invoke()`
- **Adding a new tool:**
  1. `src/shared/tool-ids.ts` — add to ToolId enum + display name + hotkey
  2. `src/main/windows.ts` — add window config in createToolWindow()
  3. `src/renderer/src/tools/<tool>/` — create component + entry
  4. `src/main/ipc-handlers.ts` — add tool-specific handlers
  5. `src/main/services/<tool>.ts` — add service if backend logic needed
  6. `src/main/index.ts` — import and initialize service
- **Modifying window behavior:** `windows.ts` → may also need `index.ts` (lifecycle) and service file (state)

### Service ↔ Tool Map (backend → frontend)
| Service File | Backs Tool | Key Functions |
|---|---|---|
| `services/focus-dim.ts` | FocusDim | overlay polygon calc, active window tracking |
| `services/clipboard.ts` | QuickBoard | clipboard monitoring, history storage |
| `services/screenslap.ts` | ScreenSlap | calendar polling, alert scheduling |
| `services/google-calendar.ts` | ScreenSlap + MeetReady | OAuth flow, event fetching |
| `services/liquidfocus.ts` | LiquidFocus | timer state, webcam focus detection |
| `sidecar/soundsplit-bridge.ts` | SoundSplit | WASAPI session control via PowerShell sidecar |
| `native/audio-sessions.ts` | SoundSplit (fallback) | execSync PowerShell per-call |
| `native/active-window.ts` | FocusDim + LiquidFocus | Win32 FFI for foreground window |
| `services/todoist.ts` | LiquidFocus | OAuth + task integration |
| `security/trial.ts` | All tools | 14-day trial, license validation |
| `services/auto-updater.ts` | System | Squirrel/NSIS update check |
| `services/config-store.ts` | System | Persistent config via electron-store |

### Anti-Circular-Fix Rules
- **Read before writing:** Read ALL files in the dependency chain before editing ANY of them
- **Type-first:** When adding IPC channels, start at `ipc-types.ts` → handler → renderer (never reverse)
- **One atomic change:** If a feature touches 3+ files, plan ALL edits first, then apply in order
- **Don't fix symptoms:** If a renderer call fails, check the handler AND the type def before changing the renderer
- **Build check:** Run `npm run build` after multi-file changes — TypeScript will catch missed connections

### File Sizes (read surgically, not wholesale)
- `ipc-handlers.ts` (491 lines, 55 handlers) — grouped by tool, search for tool name
- `ipc-types.ts` (141 lines) — small, safe to read fully
- `windows.ts` (271 lines) — window configs + lifecycle, safe to read fully
- `index.ts` (103 lines) — small, safe to read fully
- Tool components: 264–1187 lines — read specific sections, not whole files
- `tool-ids.ts` (41 lines) — small, always read fully when adding tools

### Speed Rules for This Codebase
- **Don't explore — navigate.** Use the maps above. If a task involves SoundSplit, go directly to `soundsplit-bridge.ts` + `SoundSplit.tsx` + the IPC handlers section.
- **Subagent for discovery only.** Once you know which 2-3 files to edit, work directly — don't spawn subagents for edits.
- **Skip architecture explanations.** The user built this app. Say what you're changing and why, not how Electron IPC works.
- **Parallel reads.** When a change touches main + renderer, read both files in a single parallel call.
- **Build = verification.** `npm run build` catches type errors across the whole app. Use it instead of manual tracing.
