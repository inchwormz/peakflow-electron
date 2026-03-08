/**
 * Native active window tracking using Win32 API via koffi.
 *
 * Calls GetForegroundWindow() + GetWindowRect() to get the position
 * and size of the currently focused window on Windows.
 *
 * All koffi/DLL bindings are deferred to first use via initBindings()
 * so this module can be safely imported on macOS without crashing.
 */

// ─── Lazy koffi bindings (initialized on first call) ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let K: any = null // koffi module
let _user32: any, _dwmapi: any, _kernel32: any
let _RECT: any
let _GetForegroundWindow: any, _GetWindowRect: any, _IsWindow: any, _IsWindowVisible: any
let _GetWindowTextW: any, _GetClassNameW: any
let _DwmGetWindowAttribute: any, _DwmGetWindowAttributeDword: any
let _OpenProcess: any, _QueryFullProcessImageNameW: any, _CloseHandle: any
let _EnumWindowsCallback: any, _EnumWindows: any, _GetWindowThreadProcessId: any, _IsIconic: any
let _bindingsReady = false

function initBindings(): void {
  if (_bindingsReady) return

  K = require('koffi')

  _user32 = K.load('user32.dll')
  _dwmapi = K.load('dwmapi.dll')
  _kernel32 = K.load('kernel32.dll')

  _RECT = K.struct('RECT', {
    left: 'int32',
    top: 'int32',
    right: 'int32',
    bottom: 'int32'
  })

  _GetForegroundWindow = _user32.func('GetForegroundWindow', 'void *', [])
  _GetWindowRect = _user32.func('GetWindowRect', 'bool', ['void *', K.out(K.pointer(_RECT))])
  _IsWindow = _user32.func('IsWindow', 'bool', ['void *'])
  _IsWindowVisible = _user32.func('IsWindowVisible', 'bool', ['void *'])
  _GetWindowTextW = _user32.func('GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  _GetClassNameW = _user32.func('GetClassNameW', 'int', ['void *', 'void *', 'int'])

  _DwmGetWindowAttribute = _dwmapi.func('DwmGetWindowAttribute', 'long', [
    'void *', 'uint32', K.out(K.pointer(_RECT)), 'uint32'
  ])
  _DwmGetWindowAttributeDword = _dwmapi.func('DwmGetWindowAttribute', 'long', [
    'void *', 'uint32', K.out(K.pointer('uint32')), 'uint32'
  ])

  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
  _OpenProcess = _kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32'])
  _QueryFullProcessImageNameW = _kernel32.func('QueryFullProcessImageNameW', 'bool', [
    'void *', 'uint32', 'void *', K.inout(K.pointer('uint32'))
  ])
  _CloseHandle = _kernel32.func('CloseHandle', 'bool', ['void *'])
  // Store the constant for use in getProcessExeName
  ;(initBindings as any)._PQLI = PROCESS_QUERY_LIMITED_INFORMATION

  _EnumWindowsCallback = K.proto('bool __stdcall EnumWindowsCallback(void *, intptr)')
  _EnumWindows = _user32.func('EnumWindows', 'bool', [K.pointer(_EnumWindowsCallback), 'intptr'])
  _GetWindowThreadProcessId = _user32.func('GetWindowThreadProcessId', 'uint32', [
    'void *', K.out(K.pointer('uint32'))
  ])
  _IsIconic = _user32.func('IsIconic', 'bool', ['void *'])

  _bindingsReady = true
}

// ─── Public interface ────────────────────────────────────────────────────────

export interface ActiveWindowInfo {
  hwnd: unknown
  pid: number
  x: number
  y: number
  w: number
  h: number
  title: string
  className: string
}

export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

export interface DisplayBounds {
  x: number
  y: number
  w: number
  h: number
}

// Classes ignored by getActiveWindow (desktop, taskbar — things that mean "no app focused")
const IGNORED_CLASSES = new Set([
  'Progman',                          // Desktop
  'WorkerW',                          // Desktop worker
  'Shell_TrayWnd',                    // Taskbar
  'Shell_SecondaryTrayWnd',           // Secondary taskbar
  'Windows.UI.Core.CoreWindow',       // Start menu, Action Center
  'MultitaskingViewFrame'             // Task view
])

// Additional classes filtered during EnumWindows (system chrome, invisible helpers, bad bounds)
const ENUM_IGNORED_CLASSES = new Set([
  ...IGNORED_CLASSES,
  'ThumbnailDeviceHelperWnd',         // Thumbnail helper
  'EdgeUiInputWndClass',              // Edge UI input
  'EdgeUiInputTopWndClass',           // Edge UI top input
  'ApplicationManager_ImmersiveShellWindow', // Immersive shell
  'Internet Explorer_Hidden',         // IE hidden window
  'CEF-OSC-WIDGET',                   // NVIDIA GeForce overlay
  'PseudoConsoleWindow',              // ConPTY pseudo-console
  'ForegroundStaging',                // Window staging
  'MSCTFIME UI',                      // IME
  'IME',                              // Input method editor
  'tooltips_class32',                 // Tooltips
  'NotifyIconOverflowWindow',         // System tray overflow
  'DummyDWMListenerWindow',           // DWM listener
  'WinUIDesktopWin32WindowClass'       // PowerToys, Command Palette
])

/** Get the process ID for a window handle. */
function getProcessId(hwnd: unknown): number {
  const pid = [0]
  _GetWindowThreadProcessId(hwnd, pid)
  return pid[0]
}

/**
 * Get the currently focused window's position and size.
 * Returns null if no valid foreground window is found, or if it's a
 * system window that should be ignored (desktop, taskbar, etc.).
 */
export function getActiveWindow(): ActiveWindowInfo | null {
  initBindings()
  try {
    const hwnd = _GetForegroundWindow()
    if (!hwnd || !_IsWindow(hwnd) || !_IsWindowVisible(hwnd)) {
      return null
    }

    // Get class name to filter system windows
    const classNameBuf = Buffer.alloc(512)
    const classLen = _GetClassNameW(hwnd, classNameBuf, 256)
    const className = classLen > 0 ? classNameBuf.toString('utf16le', 0, classLen * 2).replace(/\0/g, '') : ''

    if (IGNORED_CLASSES.has(className)) {
      return null
    }

    const pid = getProcessId(hwnd)

    // Try DwmGetWindowAttribute first for accurate bounds (handles DPI scaling)
    const rect = { left: 0, top: 0, right: 0, bottom: 0 }
    const DWMWA_EXTENDED_FRAME_BOUNDS = 9
    const sizeOfRect = 16 // 4 int32s = 16 bytes

    const dwmResult = _DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, sizeOfRect)

    if (dwmResult !== 0) {
      // Fallback to GetWindowRect
      const success = _GetWindowRect(hwnd, rect)
      if (!success) return null
    }

    const w = rect.right - rect.left
    const h = rect.bottom - rect.top

    // Skip zero-size or tiny windows
    if (w < 10 || h < 10) return null

    // Get window title
    const titleBuf = Buffer.alloc(512)
    const titleLen = _GetWindowTextW(hwnd, titleBuf, 256)
    const title = titleLen > 0 ? titleBuf.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '') : ''

    return {
      hwnd,
      pid,
      x: rect.left,
      y: rect.top,
      w,
      h,
      title,
      className
    }
  } catch (error) {
    console.warn('[ActiveWindow] FFI error:', error)
    return null
  }
}

/**
 * Enumerate all visible, non-minimized, non-system windows.
 * Returns their rects in physical pixel coordinates.
 * If `filterPid` is provided, only returns windows belonging to that process.
 * If `displayBounds` is provided, windows covering 90%+ of any display are skipped
 * (catches UWP ApplicationFrameWindow host frames that report screen-sized bounds).
 * Capped at 50 results to prevent pathological clip-path complexity.
 */
export function getAllVisibleWindows(filterPid?: number, displayBounds?: DisplayBounds[]): WindowRect[] {
  initBindings()
  const results: WindowRect[] = []
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9
  const sizeOfRect = 16
  const MAX_WINDOWS = 50

  const callback = K.register((hwnd: unknown, _lParam: number): boolean => {
    if (results.length >= MAX_WINDOWS) return false
    try {
      if (!_IsWindow(hwnd) || !_IsWindowVisible(hwnd) || _IsIconic(hwnd)) return true

      const classNameBuf = Buffer.alloc(512)
      const classLen = _GetClassNameW(hwnd, classNameBuf, 256)
      const className = classLen > 0
        ? classNameBuf.toString('utf16le', 0, classLen * 2).replace(/\0/g, '')
        : ''
      if (ENUM_IGNORED_CLASSES.has(className)) return true

      // Skip cloaked (hidden by DWM) windows — invisible UWP apps, virtual desktop windows
      const DWMWA_CLOAKED = 14
      const cloaked = [0]
      const cloakResult = _DwmGetWindowAttributeDword(hwnd, DWMWA_CLOAKED, cloaked, 4)
      if (cloakResult === 0 && cloaked[0] !== 0) return true

      // Get window title for filtering
      const titleBuf = Buffer.alloc(512)
      const titleLen = _GetWindowTextW(hwnd, titleBuf, 256)
      const title = titleLen > 0
        ? titleBuf.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '')
        : ''

      // Skip PeakFlow overlay windows (but NOT settings/dashboard — those are real windows)
      if (title === '__peakflow_dim__') return true
      const winPid = getProcessId(hwnd)


      if (filterPid !== undefined && winPid !== filterPid) return true

      const rect = { left: 0, top: 0, right: 0, bottom: 0 }
      const dwmResult = _DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, sizeOfRect)
      if (dwmResult !== 0) {
        const success = _GetWindowRect(hwnd, rect)
        if (!success) return true
      }

      const w = rect.right - rect.left
      const h = rect.bottom - rect.top
      if (w < 10 || h < 10) return true

      // ApplicationFrameWindow is the UWP host frame — it sometimes reports screen-sized
      // bounds even for windowed apps. Only skip it if its bounds cover 90%+ of a display.
      if (className === 'ApplicationFrameWindow' && displayBounds) {
        const winArea = w * h
        for (const db of displayBounds) {
          if (winArea >= db.w * db.h * 0.9) {
            return true
          }
        }
      }

      results.push({ x: rect.left, y: rect.top, w, h })
    } catch { /* skip this window */ }
    return true
  }, K.pointer(_EnumWindowsCallback))

  try {
    _EnumWindows(callback, 0)
  } finally {
    K.unregister(callback)
  }

  return results
}

// ─── PID → exe name resolution ─────────────────────────────────────────────

/** Cache of PID → lowercase exe filename. Cleared when FocusDim enables/disables. */
const pidExeCache = new Map<number, string>()

/** Clear the PID→exe cache (call on FocusDim enable/disable). */
export function clearPidExeCache(): void {
  pidExeCache.clear()
}

/**
 * Get the lowercase exe filename for a process ID (e.g., "chrome.exe").
 * Returns null if the process can't be opened or queried.
 */
export function getProcessExeName(pid: number): string | null {
  initBindings()
  const cached = pidExeCache.get(pid)
  if (cached !== undefined) return cached

  try {
    const hProcess = _OpenProcess(0x1000, false, pid)
    if (!hProcess) return null

    try {
      const buf = Buffer.alloc(1024)
      const size = [512]
      const ok = _QueryFullProcessImageNameW(hProcess, 0, buf, size)
      if (!ok || size[0] === 0) return null

      const fullPath = buf.toString('utf16le', 0, size[0] * 2).replace(/\0/g, '')
      const lastSlash = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'))
      const exeName = (lastSlash >= 0 ? fullPath.substring(lastSlash + 1) : fullPath).toLowerCase()
      pidExeCache.set(pid, exeName)
      return exeName
    } finally {
      _CloseHandle(hProcess)
    }
  } catch {
    return null
  }
}

/**
 * Enumerate all visible windows whose exe name matches one of the given names.
 * Returns their rects in physical pixel coordinates.
 * Uses the same filters as getAllVisibleWindows (skip cloaked, minimized, system classes, overlay windows).
 */
export function getWindowsForExeNames(exeNames: string[], displayBounds?: DisplayBounds[]): WindowRect[] {
  initBindings()
  if (exeNames.length === 0) return []

  const exeSet = new Set(exeNames)
  const results: WindowRect[] = []
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9
  const sizeOfRect = 16
  const MAX_WINDOWS = 50

  const callback = K.register((hwnd: unknown, _lParam: number): boolean => {
    if (results.length >= MAX_WINDOWS) return false
    try {
      if (!_IsWindow(hwnd) || !_IsWindowVisible(hwnd) || _IsIconic(hwnd)) return true

      const classNameBuf = Buffer.alloc(512)
      const classLen = _GetClassNameW(hwnd, classNameBuf, 256)
      const className = classLen > 0
        ? classNameBuf.toString('utf16le', 0, classLen * 2).replace(/\0/g, '')
        : ''
      if (ENUM_IGNORED_CLASSES.has(className)) return true

      // Skip cloaked windows
      const DWMWA_CLOAKED = 14
      const cloaked = [0]
      const cloakResult = _DwmGetWindowAttributeDword(hwnd, DWMWA_CLOAKED, cloaked, 4)
      if (cloakResult === 0 && cloaked[0] !== 0) return true

      // Skip PeakFlow overlay windows
      const titleBuf = Buffer.alloc(512)
      const titleLen = _GetWindowTextW(hwnd, titleBuf, 256)
      const title = titleLen > 0
        ? titleBuf.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '')
        : ''
      if (title === '__peakflow_dim__') return true

      // Check exe name
      const winPid = getProcessId(hwnd)
      const exeName = getProcessExeName(winPid)
      if (!exeName || !exeSet.has(exeName)) return true

      const rect = { left: 0, top: 0, right: 0, bottom: 0 }
      const dwmResult = _DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, sizeOfRect)
      if (dwmResult !== 0) {
        const success = _GetWindowRect(hwnd, rect)
        if (!success) return true
      }

      const w = rect.right - rect.left
      const h = rect.bottom - rect.top
      if (w < 10 || h < 10) return true

      // Skip full-screen UWP frames
      if (className === 'ApplicationFrameWindow' && displayBounds) {
        const winArea = w * h
        for (const db of displayBounds) {
          if (winArea >= db.w * db.h * 0.9) return true
        }
      }

      results.push({ x: rect.left, y: rect.top, w, h })
    } catch { /* skip */ }
    return true
  }, K.pointer(_EnumWindowsCallback))

  try {
    _EnumWindows(callback, 0)
  } finally {
    K.unregister(callback)
  }

  return results
}

/**
 * Get a deduplicated list of visible apps (exe + window title).
 * Excludes PeakFlow, system windows, and any exe names in the skipSet.
 * Returns one entry per unique exe, sorted by title.
 */
export function getVisibleAppList(skipSet?: Set<string>): Array<{ exe: string; name: string }> {
  initBindings()
  const seen = new Map<string, string>()
  const selfExes = new Set(['electron.exe', 'peakflow.exe'])

  const callback = K.register((hwnd: unknown, _lParam: number): boolean => {
    try {
      if (!_IsWindow(hwnd) || !_IsWindowVisible(hwnd) || _IsIconic(hwnd)) return true

      const classNameBuf = Buffer.alloc(512)
      const classLen = _GetClassNameW(hwnd, classNameBuf, 256)
      const className = classLen > 0
        ? classNameBuf.toString('utf16le', 0, classLen * 2).replace(/\0/g, '')
        : ''
      if (ENUM_IGNORED_CLASSES.has(className)) return true

      const DWMWA_CLOAKED = 14
      const cloaked = [0]
      const cloakResult = _DwmGetWindowAttributeDword(hwnd, DWMWA_CLOAKED, cloaked, 4)
      if (cloakResult === 0 && cloaked[0] !== 0) return true

      const titleBuf = Buffer.alloc(512)
      const titleLen = _GetWindowTextW(hwnd, titleBuf, 256)
      const title = titleLen > 0
        ? titleBuf.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '')
        : ''
      if (title === '__peakflow_dim__' || !title) return true

      const pid = getProcessId(hwnd)
      const exe = getProcessExeName(pid)
      if (!exe || selfExes.has(exe) || seen.has(exe)) return true
      if (skipSet && skipSet.has(exe)) return true

      seen.set(exe, title)
    } catch { /* skip */ }
    return true
  }, K.pointer(_EnumWindowsCallback))

  try {
    _EnumWindows(callback, 0)
  } finally {
    K.unregister(callback)
  }

  return Array.from(seen.entries())
    .map(([exe, name]) => ({ exe, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
