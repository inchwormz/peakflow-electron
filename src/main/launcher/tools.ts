/**
 * PeakFlow's own tools as launcher commands. The launcher is free; these open
 * or drive paid tools, so each carries its tool's name as a label and goes
 * through the tool's usual access check (the panel shows the trial / buy
 * screen when the trial has ended).
 */

import { ToolId, TOOL_DISPLAY_NAMES, PANEL_TOOLS } from '@shared/tool-ids'
import type { LauncherItem, LauncherRunResult } from '@shared/launcher/types'
import { openToolWithAccessCheck } from '../windows'
import { showPanel } from '../panel'
import { isToolInstalled } from '../security/trial'
import { withToolAccess } from '../security/access-guard'
import { checkAccess } from '../security/access-check'
import { getFocusDimService } from '../services/focus-dim'
import { getLiquidFocusService } from '../services/liquidfocus'

interface ToolCommand {
  id: string
  tool: ToolId | null
  title: string
  subtitle: string
  keywords: string[]
  glyph: LauncherItem['glyph']
  run: () => Promise<LauncherRunResult>
}

const COMMANDS: ToolCommand[] = [
  {
    id: 'tool:quickboard',
    tool: ToolId.QuickBoard,
    title: 'Search clipboard history',
    subtitle: 'Opens QuickBoard',
    keywords: ['clipboard', 'paste', 'copied', 'history', 'quickboard'],
    glyph: 'quickboard',
    run: async () => {
      await openToolWithAccessCheck(ToolId.QuickBoard)
      return { ok: true }
    }
  },
  {
    id: 'tool:focusdim',
    tool: ToolId.FocusDim,
    title: 'Turn FocusDim on or off',
    subtitle: 'Dims everything except the window you’re in',
    keywords: ['dim', 'focus dim', 'focusdim', 'darken'],
    glyph: 'focusdim',
    run: async () => {
      const st = await getFocusDimService().requestToggle()
      return { ok: true, message: st.enabled ? 'FocusDim is on' : 'FocusDim is off' }
    }
  },
  {
    id: 'tool:liquidfocus-start',
    tool: ToolId.LiquidFocus,
    title: 'Start a focus session',
    subtitle: 'Liquid Focus timer',
    keywords: ['pomodoro', 'timer', 'focus', 'liquid focus', 'work session'],
    glyph: 'liquidfocus',
    run: async () => {
      const started = await withToolAccess(checkAccess, ToolId.LiquidFocus, () => {
        getLiquidFocusService().start()
        return true
      }, () => false)
      if (!started) await openToolWithAccessCheck(ToolId.LiquidFocus)
      return { ok: true, message: started ? 'Focus session started' : undefined }
    }
  },
  {
    id: 'tool:liquidfocus',
    tool: ToolId.LiquidFocus,
    title: 'Open Liquid Focus',
    subtitle: 'Focus timer and stats',
    keywords: ['pomodoro', 'timer', 'liquid focus'],
    glyph: 'liquidfocus',
    run: async () => {
      await openToolWithAccessCheck(ToolId.LiquidFocus)
      return { ok: true }
    }
  },
  {
    id: 'tool:screenslap',
    tool: ToolId.ScreenSlap,
    title: 'Upcoming meetings',
    subtitle: 'Opens ScreenSlap',
    keywords: ['meetings', 'calendar', 'screenslap', 'next meeting'],
    glyph: 'screenslap',
    run: async () => {
      await openToolWithAccessCheck(ToolId.ScreenSlap)
      return { ok: true }
    }
  },
  {
    id: 'tool:peakflow',
    tool: null,
    title: 'PeakFlow settings',
    subtitle: 'Plan, shortcuts, updates',
    keywords: ['peakflow', 'preferences', 'licence', 'license'],
    glyph: 'settings',
    run: async () => {
      showPanel('app')
      return { ok: true }
    }
  }
]

export function toolItems(): LauncherItem[] {
  return COMMANDS.filter((c) => !c.tool || ((PANEL_TOOLS as readonly string[]).includes(c.tool) && isToolInstalled(c.tool))).map((c) => ({
    id: c.id,
    kind: 'tool' as const,
    title: c.title,
    subtitle: c.subtitle,
    keywords: c.keywords,
    glyph: c.glyph,
    tag: c.tool ? TOOL_DISPLAY_NAMES[c.tool] : undefined
  }))
}

export function runToolCommand(id: string): Promise<LauncherRunResult> | null {
  const c = COMMANDS.find((x) => x.id === id)
  return c ? c.run() : null
}
