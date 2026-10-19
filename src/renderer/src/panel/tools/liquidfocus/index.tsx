/** Liquid Focus in the v2 panel. (Placeholder: being built.) */

import type { PanelToolModule } from '../../types'
import { Empty } from '../../kit'

function Main(): React.JSX.Element {
  return <Empty icon="liquidfocus" title="Liquid Focus">Coming in this build.</Empty>
}

export const liquidfocusTool: PanelToolModule = {
  id: 'liquidfocus',
  name: 'Liquid Focus',
  desc: 'Focus timer with tasks and site blocking',
  icon: 'liquidfocus',
  useStatus: () => '',
  routes: {
    liquidfocus: { kind: 'tool', tool: 'liquidfocus', view: Main },
    'liquidfocus/settings': { kind: 'sub', back: 'liquidfocus', title: 'Liquid Focus settings', view: Main }
  }
}
