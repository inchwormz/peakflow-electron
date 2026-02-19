import { contextBridge, ipcRenderer } from 'electron'
import { IPC_INVOKE, IPC_SEND } from '../shared/ipc-types'

// Build a Set of allowed channels for O(1) lookup
const allowedInvokes = new Set(Object.values(IPC_INVOKE))
const allowedSends = new Set(Object.values(IPC_SEND))

const peakflowAPI = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!allowedInvokes.has(channel as any)) {
      console.error(`Blocked unauthorized IPC invoke: ${channel}`)
      return Promise.reject(new Error(`Unauthorized IPC invoke: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!allowedSends.has(channel as any)) {
      console.error(`Blocked unauthorized IPC on: ${channel}`)
      return () => {}
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  send: (channel: string, ...args: unknown[]): void => {
    // Some channels are used as both send/invoke depending on context,
    // so we allow channels from either list just in case.
    if (!allowedInvokes.has(channel as any) && !allowedSends.has(channel as any)) {
      console.error(`Blocked unauthorized IPC send: ${channel}`)
      return
    }
    ipcRenderer.send(channel, ...args)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('peakflow', peakflowAPI)
  } catch (error) {
    console.error(error)
  }
}
