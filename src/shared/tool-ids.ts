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
  SoundSplit = 'soundsplit',
  SnapGrid = 'snapgrid'
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
  LiquidFocusMini = 'liquidfocus-mini',
  /** The one-app panel that drops down from the menu-bar icon (v2 UI) */
  Panel = 'panel',
  /** The ⌥Space / Alt+Space launcher (free command bar) */
  Launcher = 'launcher',
  /** Dictation's small recording pill (hold a key, talk, let go) */
  Dictation = 'dictation'
}

export type WindowId = ToolId | SystemWindowId

/** Human-readable names for tray menu */
export const TOOL_DISPLAY_NAMES: Record<ToolId, string> = {
  [ToolId.ScreenSlap]: 'ScreenSlap',
  [ToolId.FocusDim]: 'FocusDim',
  [ToolId.QuickBoard]: 'QuickBoard',
  [ToolId.LiquidFocus]: 'Liquid Focus',
  [ToolId.MeetReady]: 'MeetReady',
  [ToolId.SoundSplit]: 'SoundSplit',
  [ToolId.SnapGrid]: 'SnapGrid'
}

/** Default hotkeys (matching Python app hotkeys) */
export const DEFAULT_HOTKEYS: Partial<Record<ToolId, string>> = {
  [ToolId.FocusDim]: 'CommandOrControl+Shift+D',
  [ToolId.QuickBoard]: 'CommandOrControl+Shift+V',
  [ToolId.MeetReady]: 'CommandOrControl+Shift+M'
}

/**
 * The tools in the one-app panel, in switcher order (hotkeys ⌥⌘1–5).
 * John, 19 Oct 2026: MeetReady and SoundSplit are out for now. Their code stays;
 * they are only hidden from the switcher, settings, tray and hotkeys.
 */
export const PANEL_TOOLS: readonly ToolId[] = [
  ToolId.FocusDim,
  ToolId.LiquidFocus,
  ToolId.ScreenSlap,
  ToolId.QuickBoard,
  // John, 22 Oct 2026: "thats great! build it!" (Magnet-style window organizer)
  ToolId.SnapGrid
]

/** Tools hidden from every surface in v2 (code kept). */
export const HIDDEN_TOOLS: readonly ToolId[] = [ToolId.MeetReady, ToolId.SoundSplit]

/**
 * Todoist sync for Liquid Focus. Out of scope for v2 (John, 19 Oct 2026: "we
 * dont need a todoist integration, just leave it out for now"). Off hides the
 * settings page, task import and its IPC, and the service doesn't start.
 * The code is kept; set true to bring it back.
 */
export const TODOIST_ENABLED = false

/**
 * The PeakFlow Focus Chrome extension (site blocking during Liquid Focus).
 * Not published to the Chrome Web Store yet, so off for v2 (John, 19 Oct 2026).
 * Off hides the Chrome extension page and Liquid Focus's blocked-sites
 * settings, and the extension server (port 17832) doesn't start. The code and
 * peakflow-focus-extension/ are kept; set true to bring it back.
 */
export const EXTENSION_ENABLED = false

export function isPanelTool(id: string): boolean {
  return (PANEL_TOOLS as readonly string[]).includes(id)
}

/**
 * Dictation's page in the panel, the sixth in the switcher (⌥⌘6). John, 24 Oct
 * 2026: "dictation should be its own simple product in the launch". It isn't a
 * ToolId: it has no trial or licence gate of its own (it came from the free
 * launcher; the prepaid balance is tied to the licence on the server).
 */
export const DICTATION_PAGE = 'dictation'
export const DICTATION_SWITCH_KEY = 'Alt+CommandOrControl+6'
