import { isMac } from './platform'
// Static imports: electron-vite bundles main into one file, so a runtime
// require('./keyboard-win32') would look for a file that does not exist.
// Both modules are safe to load on either OS (native bindings are lazy).
import * as winImpl from './keyboard-win32'
import * as macImpl from './keyboard-darwin'

/**
 * Paste the clipboard into the focused app. On Windows the keystroke is sent
 * synchronously, exactly as before; the result is only wrapped in a promise.
 */
export function simulateCtrlV(): Promise<boolean> {
  if (isMac) {
    return macImpl.simulateCmdV()
  }

  return Promise.resolve(winImpl.simulateCtrlV())
}
