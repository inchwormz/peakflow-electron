/** ScreenSlap in the v2 panel. (Placeholder: being built.) */

import type { PanelToolModule } from '../../types'
import { Empty } from '../../kit'

function Main(): React.JSX.Element {
  return <Empty icon="screenslap" title="ScreenSlap">Coming in this build.</Empty>
}

export const screenslapTool: PanelToolModule = {
  id: 'screenslap',
  name: 'ScreenSlap',
  desc: 'Full-screen alerts before meetings',
  icon: 'screenslap',
  useStatus: () => '',
  routes: {
    screenslap: { kind: 'tool', tool: 'screenslap', view: Main },
    'screenslap/settings': { kind: 'sub', back: 'screenslap', title: 'ScreenSlap settings', view: Main }
  }
}
