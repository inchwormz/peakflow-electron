import { isMac } from '../native/platform'

type MicMuteModule = typeof import('./mic-mute-win32')

function getImpl(): MicMuteModule {
  if (isMac) {
    return require('./mic-mute-darwin') as MicMuteModule
  }

  return require('./mic-mute-win32') as MicMuteModule
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
