/** The v2 tools, in switcher order (⌥⌘1–5). */

import type { PanelToolId, PanelToolModule } from '../types'
import { focusdimTool } from './focusdim'
import { liquidfocusTool } from './liquidfocus'
import { screenslapTool } from './screenslap'
import { quickboardTool } from './quickboard'
import { snapgridTool } from './snapgrid'

export const TOOL_MODULES: PanelToolModule[] = [focusdimTool, liquidfocusTool, screenslapTool, quickboardTool, snapgridTool]

export const TOOL_BY_ID = Object.fromEntries(TOOL_MODULES.map((m) => [m.id, m])) as Record<PanelToolId, PanelToolModule>
