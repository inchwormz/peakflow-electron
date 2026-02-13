import type { ElectronAPI } from '@electron-toolkit/preload'

export interface PeakflowAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    peakflow: PeakflowAPI
  }
}
