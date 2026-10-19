/** PeakFlow-wide settings pages (placeholder while being built). */
import type { RouteTable } from '../types'
import { Empty } from '../kit'

function Main(): React.JSX.Element {
  return <Empty icon="settings" title="PeakFlow settings">Coming in this build.</Empty>
}

export const APP_ROUTES: RouteTable = {
  app: { kind: 'sub', back: 'focusdim', title: 'PeakFlow settings', view: Main }
}
