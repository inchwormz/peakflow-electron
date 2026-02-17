/**
 * Native active window tracking using Win32 API via koffi.
 *
 * Calls GetForegroundWindow() + GetWindowRect() to get the position
 * and size of the currently focused window on Windows.
 */

import koffi from 'koffi'

// ─── Win32 types and bindings ────────────────────────────────────────────────

const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')

// RECT struct: { left, top, right, bottom } — all int32
const RECT = koffi.struct('RECT', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32'
})

// Win32 function bindings
const GetForegroundWindow = user32.func('GetForegroundWindow', 'void *', [])
const GetWindowRect = user32.func('GetWindowRect', 'bool', ['void *', koffi.out(koffi.pointer(RECT))])
const IsWindow = user32.func('IsWindow', 'bool', ['void *'])
const IsWindowVisible = user32.func('IsWindowVisible', 'bool', ['void *'])
// Pass output string buffers as void* — caller allocates Buffer.alloc(512) and reads utf16le
const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', 'void *', 'int'])
const GetClassNameW = user32.func('GetClassNameW', 'int', ['void *', 'void *', 'int'])

// DwmGetWindowAttribute — for getting the actual rendered bounds (respects DPI, shadows)
// DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DwmGetWindowAttribute = dwmapi.func('DwmGetWindowAttribute', 'long', [
  'void *',
  'uint32',
  koffi.out(koffi.pointer(RECT)),
  'uint32'
])

// ─── Public interface ────────────────────────────────────────────────────────

export interface ActiveWindowInfo {
  hwnd: unknown
  x: number
  y: number
  w: number
  h: number
  title: string
  className: string
}

// Windows that should be ignored (desktop, taskbar, etc.)
const IGNORED_CLASSES = new Set([
  'Progman',           // Desktop
  'WorkerW',           // Desktop worker
  'Shell_TrayWnd',     // Taskbar
  'Shell_SecondaryTrayWnd', // Secondary taskbar
  'Windows.UI.Core.CoreWindow', // Start menu, Action Center
  'MultitaskingViewFrame'        // Task view
])

/**
 * Get the currently focused window's position and size.
 * Returns null if no valid foreground window is found, or if it's a
 * system window that should be ignored (desktop, taskbar, etc.).
 */
export function getActiveWindow(): ActiveWindowInfo | null {
  try {
    const hwnd = GetForegroundWindow()
    if (!hwnd || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) {
      return null
    }

    // Get class name to filter system windows
    const classNameBuf = Buffer.alloc(512)
    const classLen = GetClassNameW(hwnd, classNameBuf, 256)
    const className = classLen > 0 ? classNameBuf.toString('utf16le', 0, classLen * 2).replace(/\0/g, '') : ''

    if (IGNORED_CLASSES.has(className)) {
      return null
    }

    // Try DwmGetWindowAttribute first for accurate bounds (handles DPI scaling)
    const rect = { left: 0, top: 0, right: 0, bottom: 0 }
    const DWMWA_EXTENDED_FRAME_BOUNDS = 9
    const sizeOfRect = 16 // 4 int32s = 16 bytes

    const dwmResult = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, sizeOfRect)

    if (dwmResult !== 0) {
      // Fallback to GetWindowRect
      const success = GetWindowRect(hwnd, rect)
      if (!success) return null
    }

    const w = rect.right - rect.left
    const h = rect.bottom - rect.top

    // Skip zero-size or tiny windows
    if (w < 10 || h < 10) return null

    // Get window title
    const titleBuf = Buffer.alloc(512)
    const titleLen = GetWindowTextW(hwnd, titleBuf, 256)
    const title = titleLen > 0 ? titleBuf.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '') : ''

    return {
      hwnd,
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
