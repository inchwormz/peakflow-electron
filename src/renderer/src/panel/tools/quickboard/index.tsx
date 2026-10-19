/** QuickBoard in the v2 panel. (Placeholder: being built.) */

import type { PanelToolModule } from '../../types'
import { Empty } from '../../kit'

function Main(): React.JSX.Element {
  return <Empty icon="quickboard" title="QuickBoard">Coming in this build.</Empty>
}

export const quickboardTool: PanelToolModule = {
  id: 'quickboard',
  name: 'QuickBoard',
  desc: 'Clipboard history, snippets and paste tools',
  icon: 'quickboard',
  useStatus: () => '',
  routes: {
    quickboard: { kind: 'tool', tool: 'quickboard', view: Main },
    'quickboard/settings': { kind: 'sub', back: 'quickboard', title: 'QuickBoard settings', view: Main }
  }
}
