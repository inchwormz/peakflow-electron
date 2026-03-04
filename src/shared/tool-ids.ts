/**
 * Tool identifiers used across the entire application.
 * Each tool opens as a separate BrowserWindow with its own React component.
 */
export enum ToolId {
  FocusDim = 'focusdim',
  QuickBoard = 'quickboard',
  ScreenSlap = 'screenslap',
  MeetReady = 'meetready',
  LiquidFocus = 'liquidfocus',
  SoundSplit = 'soundsplit'
}

/** Window types that aren't tools (licensing, settings, etc.) */
export enum SystemWindowId {
  Dashboard = 'dashboard',
  TrialExpired = 'trial-expired',
  Settings = 'settings',
  /** ScreenSlap full-screen alert overlay */
  ScreenSlapAlert = 'screenslap-alert',
  /** FocusDim transparent overlay panels */
  FocusDimOverlay = 'focusdim-overlay',
  /** LiquidFocus compact floating timer widget */
  LiquidFocusMini = 'liquidfocus-mini'
}

export type WindowId = ToolId | SystemWindowId

/** Human-readable names for tray menu */
export const TOOL_DISPLAY_NAMES: Record<ToolId, string> = {
  [ToolId.ScreenSlap]: 'ScreenSlap',
  [ToolId.FocusDim]: 'FocusDim',
  [ToolId.QuickBoard]: 'QuickBoard',
  [ToolId.LiquidFocus]: 'LiquidFocus',
  [ToolId.MeetReady]: 'MeetReady',
  [ToolId.SoundSplit]: 'SoundSplit'
}

/** Default hotkeys (matching Python app hotkeys) */
export const DEFAULT_HOTKEYS: Partial<Record<ToolId, string>> = {
  [ToolId.FocusDim]: 'CommandOrControl+Shift+D',
  [ToolId.QuickBoard]: 'CommandOrControl+Shift+V',
  [ToolId.MeetReady]: 'CommandOrControl+Shift+M'
}
