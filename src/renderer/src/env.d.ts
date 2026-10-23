/// <reference types="vite/client" />
/// <reference types="../../preload/index.d.ts" />

import type { PeakflowAPI } from '../../preload/index.d'
import type { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    peakflow: PeakflowAPI
  }
}

// Electron frameless windows use -webkit-app-region for drag areas
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: string
  }
}
