/** The v2 tools, in switcher order (⌥⌘1–6; Guarana, seventh, has no switch shortcut). */

import type { PanelToolId, PanelToolModule } from '../types'
import { focusdimTool } from './focusdim'
import { liquidfocusTool } from './liquidfocus'
import { screenslapTool } from './screenslap'
import { quickboardTool } from './quickboard'
import { snapgridTool } from './snapgrid'
import { dictationTool } from './dictation'
import { guaranaTool } from './guarana'

// The six with ⌥⌘1–6 (Dictation sixth), then Guarana, which has no switch shortcut
export const TOOL_MODULES: PanelToolModule[] = [...[focusdimTool, liquidfocusTool, screenslapTool, quickboardTool, snapgridTool, dictationTool], guaranaTool]

export const TOOL_BY_ID = Object.fromEntries(TOOL_MODULES.map((m) => [m.id, m])) as Record<PanelToolId, PanelToolModule>
