import { app, ipcMain, powerMonitor, powerSaveBlocker } from 'electron'
import Store from 'electron-store'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { CaffeineState } from '@shared/caffeine'
import { sendToPanel } from '../panel'
import { CaffeineCore, type CaffeinePrefs } from './caffeine-core'

const OFF: CaffeineState = { active: false, endsAt: null, minutes: null, keepScreenOn: true, defaultMinutes: null }
let service: CaffeineCore<ReturnType<typeof setTimeout>> | null = null
const listeners = new Set<(state: CaffeineState) => void>()

/** Tray subscribes without the service importing (or refreshing) other tools. */
export function onCaffeineChanged(listener: (state: CaffeineState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function safely(action: () => void): CaffeineState {
  try { action() } catch (error) { console.error('[Caffeine] Action failed:', error) }
  return getCaffeineState()
}

export function getCaffeineState(): CaffeineState { return service?.getState() ?? { ...OFF } }
export function startCaffeine(minutes: unknown): CaffeineState { return safely(() => { service?.start(minutes) }) }
export function stopCaffeine(): CaffeineState { return safely(() => { service?.stop() }) }
export function setCaffeinePrefs(prefs: unknown): CaffeineState { return safely(() => { service?.setPrefs(prefs) }) }
const checkExpiry = (): void => { safely(() => { service?.checkExpiry() }) }

export function initCaffeine(): void {
  if (service) return
  const store = new Store<CaffeinePrefs>({ name: 'caffeine', clearInvalidConfig: true })
  service = new CaffeineCore<ReturnType<typeof setTimeout>>({
    blocker: powerSaveBlocker,
    now: Date.now,
    setTimer: (callback, ms) => setTimeout(() => { safely(callback) }, ms),
    clearTimer: clearTimeout,
    savePrefs: prefs => { store.set(prefs) },
    changed: state => {
      console.log('[Caffeine] State changed:', state)
      sendToPanel(IPC_SEND.CAFFEINE_STATE_CHANGED, state)
      for (const listener of listeners) {
        try { listener(state) } catch (error) { console.error('[Caffeine] Listener failed:', error) }
      }
    }
  }, store.store)
  ipcMain.handle(IPC_INVOKE.CAFFEINE_GET_STATE, () => getCaffeineState())
  ipcMain.handle(IPC_INVOKE.CAFFEINE_START, (_event, minutes: unknown) => startCaffeine(minutes))
  ipcMain.handle(IPC_INVOKE.CAFFEINE_STOP, () => stopCaffeine())
  ipcMain.handle(IPC_INVOKE.CAFFEINE_SET_PREFS, (_event, prefs: unknown) => setCaffeinePrefs(prefs))
  powerMonitor.on('resume', checkExpiry)
  powerMonitor.on('unlock-screen', checkExpiry)
  app.on('before-quit', stopCaffeine)
  app.on('will-quit', stopCaffeine)
  console.log('[Caffeine] Ready (off)')
}
