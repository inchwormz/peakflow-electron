import { isMac } from '../native/platform'
// Static imports: electron-vite bundles main into one file, so a runtime
// require('./mic-mute-win32') would look for a file that does not exist.
// Both modules are safe to load on either OS (native bindings are lazy).
import * as winImpl from './mic-mute-win32'
import * as macImpl from './mic-mute-darwin'

type MicMuteModule = typeof winImpl

function getImpl(): MicMuteModule {
  return isMac ? (macImpl as MicMuteModule) : winImpl
}

export type { MicMuteResult } from './mic-mute-win32'

export function getMicMuteState() {
  return getImpl().getMicMuteState()
}

export function setMicMute(muted: boolean) {
  return getImpl().setMicMute(muted)
}

export function toggleMicMute() {
  return getImpl().toggleMicMute()
}
