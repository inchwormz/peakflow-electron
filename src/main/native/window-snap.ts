/** SnapGrid window mover: picks the macOS or Windows implementation. */

import { isMac } from './platform'
import * as winImpl from './window-snap-win32'
import * as macImpl from './window-snap-darwin'

export type { SnapRect, SnapWindow, DragEvent } from './window-snap-types'

export const windowSnap: typeof winImpl = isMac ? macImpl : winImpl
