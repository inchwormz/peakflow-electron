import { isMac } from './platform'
// Static imports: electron-vite bundles main into one file, so a runtime
// require('./keyboard-win32') would look for a file that does not exist.
// Both modules are safe to load on either OS (native bindings are lazy).
import * as winImpl from './keyboard-win32'
import * as macImpl from './keyboard-darwin'

export function simulateCtrlV(): boolean {
  if (isMac) {
    return macImpl.simulateCmdV()
  }

  return winImpl.simulateCtrlV()
}
