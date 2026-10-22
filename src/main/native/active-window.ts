import { isMac } from './platform'
// Static imports: electron-vite bundles main into one file, so a runtime
// require('./active-window-win32') would look for a file that does not exist.
// Both modules are safe to load on either OS (native bindings are lazy).
import * as winImpl from './active-window-win32'
import * as macImpl from './active-window-darwin'

type ActiveWindowModule = typeof winImpl

function getImpl(): ActiveWindowModule {
  return isMac ? (macImpl as ActiveWindowModule) : winImpl
}

export type { ActiveWindowInfo, WindowRect, DisplayBounds } from './active-window-win32'

export function getActiveWindow() {
  return getImpl().getActiveWindow()
}

export function getAllVisibleWindows(
  filterPid?: number,
  displayBounds?: import('./active-window-win32').DisplayBounds[]
) {
  return getImpl().getAllVisibleWindows(filterPid, displayBounds)
}

export function getWindowsForExeNames(
  exeNames: string[],
  displayBounds?: import('./active-window-win32').DisplayBounds[]
) {
  return getImpl().getWindowsForExeNames(exeNames, displayBounds)
}

export function getProcessExeName(pid: number) {
  return getImpl().getProcessExeName(pid)
}

export function raiseAppWindows(pid: number, activeHwnd?: unknown) {
  return getImpl().raiseAppWindows(pid, activeHwnd)
}

export function restorePreviousApp() {
  return getImpl().restorePreviousApp()
}

export function clearPidExeCache() {
  return getImpl().clearPidExeCache()
}

export function getVisibleAppList(skipSet?: Set<string>) {
  return getImpl().getVisibleAppList(skipSet)
}

/** Stop the macOS helper process on quit (nothing to stop on Windows). */
export function destroyActiveWindowHelper(): void {
  if (isMac) macImpl.destroyHelper()
}
