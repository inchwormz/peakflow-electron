import { isMac } from './platform'

type KeyboardModule = typeof import('./keyboard-win32')
type MacKeyboardModule = typeof import('./keyboard-darwin')

function getWinImpl(): KeyboardModule {
  return require('./keyboard-win32') as KeyboardModule
}

function getMacImpl(): MacKeyboardModule {
  return require('./keyboard-darwin') as MacKeyboardModule
}

export function simulateCtrlV(): boolean {
  if (isMac) {
    return getMacImpl().simulateCmdV()
  }

  return getWinImpl().simulateCtrlV()
}
