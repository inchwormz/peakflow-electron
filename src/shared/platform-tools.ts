/**
 * Which tools exist on which operating system.
 *
 * SoundSplit drives Windows WASAPI through a PowerShell sidecar and has no
 * macOS backend yet, so it is hidden on macOS (not shown as broken).
 * Windows supports every tool, so nothing changes there.
 */

import { ToolId } from './tool-ids'

const UNSUPPORTED_TOOLS: Partial<Record<string, readonly ToolId[]>> = {
  darwin: [ToolId.SoundSplit]
}

export function isToolSupportedOn(toolId: string, platform: string): boolean {
  const blocked = UNSUPPORTED_TOOLS[platform]
  return !blocked || !blocked.includes(toolId as ToolId)
}
