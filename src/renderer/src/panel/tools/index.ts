/** The four v2 tools, in switcher order (⌥⌘1–4). */

import type { PanelToolId, PanelToolModule } from '../types'
import { focusdimTool } from './focusdim'
import { liquidfocusTool } from './liquidfocus'
import { screenslapTool } from './screenslap'
import { quickboardTool } from './quickboard'

export const TOOL_MODULES: PanelToolModule[] = [focusdimTool, liquidfocusTool, screenslapTool, quickboardTool]

export const TOOL_BY_ID = Object.fromEntries(TOOL_MODULES.map((m) => [m.id, m])) as Record<PanelToolId, PanelToolModule>
