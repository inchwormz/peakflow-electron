import { app, ipcMain, powerMonitor, powerSaveBlocker } from 'electron'
import Store from 'electron-store'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { GuaranaState } from '@shared/guarana'
import { sendToPanel } from '../panel'
import { GuaranaCore, type GuaranaPrefs } from './guarana-core'

const OFF: GuaranaState = { active: false, endsAt: null, minutes: null, keepScreenOn: true, defaultMinutes: null }
let service: GuaranaCore<ReturnType<typeof setTimeout>> | null = null
const listeners = new Set<(state: GuaranaState) => void>()

/** Tray subscribes without the service importing (or refreshing) other tools. */
export function onGuaranaChanged(listener: (state: GuaranaState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function safely(action: () => void): GuaranaState {
  try { action() } catch (error) { console.error('[Guarana] Action failed:', error) }
  return getGuaranaState()
}

export function getGuaranaState(): GuaranaState { return service?.getState() ?? { ...OFF } }
export function startGuarana(minutes: unknown): GuaranaState { return safely(() => { service?.start(minutes) }) }
export function stopGuarana(): GuaranaState { return safely(() => { service?.stop() }) }
export function setGuaranaPrefs(prefs: unknown): GuaranaState { return safely(() => { service?.setPrefs(prefs) }) }
const checkExpiry = (): void => { safely(() => { service?.checkExpiry() }) }

export function initGuarana(): void {
  if (service) return
  const store = new Store<GuaranaPrefs>({ name: 'guarana', clearInvalidConfig: true })
  service = new GuaranaCore<ReturnType<typeof setTimeout>>({
    blocker: powerSaveBlocker,
    now: Date.now,
    setTimer: (callback, ms) => setTimeout(() => { safely(callback) }, ms),
    clearTimer: clearTimeout,
    savePrefs: prefs => { store.set(prefs) },
    changed: state => {
      console.log('[Guarana] State changed:', state)
      sendToPanel(IPC_SEND.GUARANA_STATE_CHANGED, state)
      for (const listener of listeners) {
        try { listener(state) } catch (error) { console.error('[Guarana] Listener failed:', error) }
      }
    }
  }, store.store)
  ipcMain.handle(IPC_INVOKE.GUARANA_GET_STATE, () => getGuaranaState())
  ipcMain.handle(IPC_INVOKE.GUARANA_START, (_event, minutes: unknown) => startGuarana(minutes))
  ipcMain.handle(IPC_INVOKE.GUARANA_STOP, () => stopGuarana())
  ipcMain.handle(IPC_INVOKE.GUARANA_SET_PREFS, (_event, prefs: unknown) => setGuaranaPrefs(prefs))
  powerMonitor.on('resume', checkExpiry)
  powerMonitor.on('unlock-screen', checkExpiry)
  app.on('before-quit', stopGuarana)
  app.on('will-quit', stopGuarana)
  console.log('[Guarana] Ready (off)')
}
