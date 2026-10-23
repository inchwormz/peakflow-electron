/** The v2 tools, in switcher order (⌥⌘1–6). */

import type { PanelToolId, PanelToolModule } from '../types'
import { focusdimTool } from './focusdim'
import { liquidfocusTool } from './liquidfocus'
import { screenslapTool } from './screenslap'
import { quickboardTool } from './quickboard'
import { snapgridTool } from './snapgrid'
import { dictationTool } from './dictation'

export const TOOL_MODULES: PanelToolModule[] = [focusdimTool, liquidfocusTool, screenslapTool, quickboardTool, snapgridTool, dictationTool]

export const TOOL_BY_ID = Object.fromEntries(TOOL_MODULES.map((m) => [m.id, m])) as Record<PanelToolId, PanelToolModule>
