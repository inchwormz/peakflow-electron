import { isMac } from './platform'

type ActiveWindowModule = typeof import('./active-window-win32')

function getImpl(): ActiveWindowModule {
  if (isMac) {
    return require('./active-window-darwin') as ActiveWindowModule
  }
  return require('./active-window-win32') as ActiveWindowModule
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

export function clearPidExeCache() {
  return getImpl().clearPidExeCache()
}

export function getVisibleAppList(skipSet?: Set<string>) {
  return getImpl().getVisibleAppList(skipSet)
}
