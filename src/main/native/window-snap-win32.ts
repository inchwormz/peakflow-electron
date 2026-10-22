/**
 * SnapGrid on Windows: move other apps' windows with SetWindowPos (koffi FFI).
 *
 * Win32 works in physical pixels and Electron in DIP, so every rect is
 * converted with screen.screenToDipRect / dipToScreenRect. Windows 10/11
 * windows carry an invisible resize border, so positions are set from the
 * visible frame (DWMWA_EXTENDED_FRAME_BOUNDS) and padded by that border.
 * Bindings load on first use, so this module is safe to import on macOS.
 */

import { screen } from 'electron'
import type { SnapRect, SnapWindow, DragEvent } from './window-snap-types'

/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any = null
let RECT: any
let fn: Record<string, any> = {}
let ready = false

function init(): void {
  if (ready) return
  K = require('koffi')
  const user32 = K.load('user32.dll')
  const dwmapi = K.load('dwmapi.dll')
  const kernel32 = K.load('kernel32.dll')
  RECT = K.struct('SG_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
  const EnumProc = K.proto('bool __stdcall SgEnumProc(void *, intptr)')
  fn = {
    GetForegroundWindow: user32.func('GetForegroundWindow', 'void *', []),
    SetForegroundWindow: user32.func('SetForegroundWindow', 'bool', ['void *']),
    GetWindowRect: user32.func('GetWindowRect', 'bool', ['void *', K.out(K.pointer(RECT))]),
    IsWindow: user32.func('IsWindow', 'bool', ['void *']),
    IsWindowVisible: user32.func('IsWindowVisible', 'bool', ['void *']),
    IsIconic: user32.func('IsIconic', 'bool', ['void *']),
    IsZoomed: user32.func('IsZoomed', 'bool', ['void *']),
    ShowWindow: user32.func('ShowWindow', 'bool', ['void *', 'int']),
    GetWindow: user32.func('GetWindow', 'void *', ['void *', 'uint32']),
    GetWindowLongPtrW: user32.func('GetWindowLongPtrW', 'intptr', ['void *', 'int']),
    GetClassNameW: user32.func('GetClassNameW', 'int', ['void *', 'void *', 'int']),
    GetWindowTextW: user32.func('GetWindowTextW', 'int', ['void *', 'void *', 'int']),
    GetWindowThreadProcessId: user32.func('GetWindowThreadProcessId', 'uint32', ['void *', K.out(K.pointer('uint32'))]),
    SetWindowPos: user32.func('SetWindowPos', 'bool', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint32']),
    EnumWindows: user32.func('EnumWindows', 'bool', [K.pointer(EnumProc), 'intptr']),
    DwmRect: dwmapi.func('DwmGetWindowAttribute', 'long', ['void *', 'uint32', K.out(K.pointer(RECT)), 'uint32']),
    DwmDword: dwmapi.func('DwmGetWindowAttribute', 'long', ['void *', 'uint32', K.out(K.pointer('uint32')), 'uint32']),
    OpenProcess: kernel32.func('OpenProcess', 'void *', ['uint32', 'bool', 'uint32']),
    QueryFullProcessImageNameW: kernel32.func('QueryFullProcessImageNameW', 'bool', ['void *', 'uint32', 'void *', K.inout(K.pointer('uint32'))]),
    CloseHandle: kernel32.func('CloseHandle', 'bool', ['void *'])
  }
  fn.EnumProc = EnumProc
  ready = true
}

const SKIP_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow',
  'MultitaskingViewFrame', 'ForegroundStaging', 'XamlExplorerHostIslandWindow', 'TopLevelWindowForOverflowXamlIsland',
  'NotifyIconOverflowWindow', 'tooltips_class32', 'IME', 'MSCTFIME UI', 'WinUIDesktopWin32WindowClass'
])

function wstr(read: (buf: Buffer, len: number) => number): string {
  const buf = Buffer.alloc(1024)
  const n = read(buf, 512)
  return n > 0 ? buf.toString('utf16le', 0, n * 2).replace(/\0/g, '') : ''
}

function pidOf(hwnd: unknown): number {
  const out = [0]
  fn.GetWindowThreadProcessId(hwnd, out)
  return out[0]
}

const exePathCache = new Map<number, string>()
function exePath(pid: number): string {
  const cached = exePathCache.get(pid)
  if (cached !== undefined) return cached
  let path = ''
  try {
    const h = fn.OpenProcess(0x1000, false, pid)
    if (h) {
      try {
        const buf = Buffer.alloc(2048)
        const size = [1024]
        if (fn.QueryFullProcessImageNameW(h, 0, buf, size)) path = buf.toString('utf16le', 0, size[0] * 2).replace(/\0/g, '')
      } finally {
        fn.CloseHandle(h)
      }
    }
  } catch {
    /* protected process */
  }
  if (exePathCache.size > 200) exePathCache.clear()
  exePathCache.set(pid, path)
  return path
}

function appNameFrom(path: string, title: string): string {
  const file = path.split(/[\\/]/).pop() ?? ''
  const base = file.replace(/\.exe$/i, '')
  const known: Record<string, string> = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', explorer: 'File Explorer', code: 'VS Code', windowsterminal: 'Terminal', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', outlook: 'Outlook', notepad: 'Notepad', slack: 'Slack', teams: 'Teams', 'ms-teams': 'Teams' }
  return known[base.toLowerCase()] ?? (base ? base.charAt(0).toUpperCase() + base.slice(1) : title)
}

/** Visible frame in physical pixels (falls back to the window rect). */
function physFrame(hwnd: unknown): { left: number; top: number; right: number; bottom: number } | null {
  const r = { left: 0, top: 0, right: 0, bottom: 0 }
  if (fn.DwmRect(hwnd, 9, r, 16) !== 0 && !fn.GetWindowRect(hwnd, r)) return null
  return r
}

function toDip(r: { left: number; top: number; right: number; bottom: number }): SnapRect {
  const d = screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })
  return { x: d.x, y: d.y, w: d.width, h: d.height }
}

/** Is this a normal app window SnapGrid may move? */
function isSnappable(hwnd: unknown, requireTitle: boolean): boolean {
  if (!hwnd || !fn.IsWindow(hwnd) || !fn.IsWindowVisible(hwnd) || fn.IsIconic(hwnd)) return false
  if (pidOf(hwnd) === process.pid) return false
  const cls = wstr((b, n) => fn.GetClassNameW(hwnd, b, n))
  if (SKIP_CLASSES.has(cls)) return false
  const cloaked = [0]
  if (fn.DwmDword(hwnd, 14, cloaked, 4) === 0 && cloaked[0] !== 0) return false
  const exStyle = Number(fn.GetWindowLongPtrW(hwnd, -20))
  if (exStyle & 0x80) return false // WS_EX_TOOLWINDOW
  if (fn.GetWindow(hwnd, 4)) return false // owned popup (dialogs, menus)
  const style = Number(fn.GetWindowLongPtrW(hwnd, -16))
  if (!(style & 0x00c00000)) return false // WS_CAPTION: no title bar, not a normal window
  if (requireTitle && !wstr((b, n) => fn.GetWindowTextW(hwnd, b, n))) return false
  return true
}

function describe(hwnd: unknown): SnapWindow | null {
  const r = physFrame(hwnd)
  if (!r || r.right - r.left < 80 || r.bottom - r.top < 60) return null
  const pid = pidOf(hwnd)
  const path = exePath(pid)
  const title = wstr((b, n) => fn.GetWindowTextW(hwnd, b, n))
  return {
    id: String(K.address(hwnd)),
    pid,
    appName: appNameFrom(path, title),
    icon: path ? { path, name: appNameFrom(path, title) } : { name: title },
    frame: toDip(r),
    handle: hwnd
  }
}

export async function getFrontWindow(): Promise<SnapWindow | null> {
  init()
  try {
    const hwnd = fn.GetForegroundWindow()
    return isSnappable(hwnd, false) ? describe(hwnd) : null
  } catch {
    return null
  }
}

export async function listWindows(): Promise<SnapWindow[]> {
  init()
  const out: SnapWindow[] = []
  const cb = K.register((hwnd: unknown): boolean => {
    if (out.length >= 30) return false
    try {
      if (isSnappable(hwnd, true)) {
        const w = describe(hwnd)
        if (w) out.push(w)
      }
    } catch {
      /* window closed meanwhile */
    }
    return true
  }, K.pointer(fn.EnumProc))
  try {
    fn.EnumWindows(cb, 0)
  } finally {
    K.unregister(cb)
  }
  return out // EnumWindows runs front to back
}

export async function setWindowFrame(w: SnapWindow, target: SnapRect): Promise<SnapRect | null> {
  init()
  const hwnd = w.handle
  try {
    if (!hwnd || !fn.IsWindow(hwnd)) return null
    if (fn.IsZoomed(hwnd)) fn.ShowWindow(hwnd, 9) // SW_RESTORE, or SetWindowPos is undone on the next click
    const outer = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!fn.GetWindowRect(hwnd, outer)) return null
    const vis = physFrame(hwnd) ?? outer
    const l = vis.left - outer.left
    const t = vis.top - outer.top
    const rr = outer.right - vis.right
    const b = outer.bottom - vis.bottom
    const p = screen.dipToScreenRect(null, { x: Math.round(target.x), y: Math.round(target.y), width: Math.round(target.w), height: Math.round(target.h) })
    const SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_NOOWNERZORDER = 0x200
    if (!fn.SetWindowPos(hwnd, null, p.x - l, p.y - t, p.width + l + rr, p.height + t + b, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER)) return null
    const after = physFrame(hwnd)
    return after ? toDip(after) : null
  } catch (err) {
    console.warn('[SnapGrid-Win32] move failed:', err)
    return null
  }
}

export async function raiseWindow(w: SnapWindow): Promise<void> {
  init()
  try {
    if (w.handle && fn.IsWindow(w.handle)) fn.SetForegroundWindow(w.handle)
  } catch {
    /* closed */
  }
}

/** Windows snaps windows dragged to a screen edge itself (Snap). */
export async function osHandlesEdgeDrag(): Promise<boolean> {
  return true
}

export function startDragWatch(_onEvent: (e: DragEvent) => void): void {}
export function stopDragWatch(): void {}
export function destroy(): void {}
