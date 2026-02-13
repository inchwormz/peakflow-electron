/**
 * Type-safe IPC channel definitions.
 * Naming convention: 'domain:action'
 *
 * Main <-> Renderer communication uses these channels exclusively.
 * All payloads are serializable (no functions, no classes).
 */

import type { ToolId } from './tool-ids'

// ─── Security / Licensing ────────────────────────────────────────────────────

export interface AccessStatus {
  allowed: boolean
  message: string
  daysRemaining: number
  isLicensed: boolean
}

export interface LicenseActivationResult {
  success: boolean
  message: string
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ConfigGetPayload {
  tool: ToolId
}

export interface ConfigSetPayload {
  tool: ToolId
  key: string
  value: unknown
}

// ─── Window Management ───────────────────────────────────────────────────────

export interface WindowInfo {
  toolId: string
}

// ─── IPC Channel Map ─────────────────────────────────────────────────────────

/** Invoke channels (renderer → main, returns a value) */
export const IPC_INVOKE = {
  // Security
  SECURITY_CHECK_ACCESS: 'security:check-access',
  SECURITY_ACTIVATE_LICENSE: 'security:activate-license',
  SECURITY_GET_TRIAL_STATUS: 'security:get-trial-status',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_GET_ALL: 'config:get-all',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_GET_INFO: 'window:get-info',

  // FocusDim
  FOCUSDIM_TOGGLE: 'focusdim:toggle',
  FOCUSDIM_SET_OPACITY: 'focusdim:set-opacity',
  FOCUSDIM_SET_COLOR: 'focusdim:set-color',
  FOCUSDIM_SET_BORDER: 'focusdim:set-border',
  FOCUSDIM_GET_STATE: 'focusdim:get-state',

  // QuickBoard
  CLIPBOARD_GET_HISTORY: 'clipboard:get-history',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  CLIPBOARD_SIMULATE_PASTE: 'clipboard:simulate-paste',
  CLIPBOARD_DELETE_ITEM: 'clipboard:delete-item',
  CLIPBOARD_PIN_ITEM: 'clipboard:pin-item',
  CLIPBOARD_CLEAR_HISTORY: 'clipboard:clear-history',

  // SoundSplit
  SOUNDSPLIT_GET_SESSIONS: 'soundsplit:get-sessions',
  SOUNDSPLIT_SET_VOLUME: 'soundsplit:set-volume',
  SOUNDSPLIT_SET_MUTE: 'soundsplit:set-mute',
  SOUNDSPLIT_GET_MASTER: 'soundsplit:get-master',
  SOUNDSPLIT_SET_MASTER: 'soundsplit:set-master',

  // Calendar (shared by ScreenSlap + MeetReady)
  CALENDAR_GET_EVENTS: 'calendar:get-events',
  CALENDAR_AUTHENTICATE: 'calendar:authenticate',
  CALENDAR_GET_STATUS: 'calendar:get-status',
  CALENDAR_DISCONNECT: 'calendar:disconnect',

  // ScreenSlap
  SCREENSLAP_GET_STATE: 'screenslap:get-state',
  SCREENSLAP_SNOOZE: 'screenslap:snooze',
  SCREENSLAP_DISMISS: 'screenslap:dismiss',
  SCREENSLAP_JOIN_MEETING: 'screenslap:join-meeting',
  SCREENSLAP_START: 'screenslap:start',
  SCREENSLAP_STOP: 'screenslap:stop',

  // LiquidFocus
  LIQUIDFOCUS_GET_STATE: 'liquidfocus:get-state',
  LIQUIDFOCUS_START: 'liquidfocus:start',
  LIQUIDFOCUS_PAUSE: 'liquidfocus:pause',
  LIQUIDFOCUS_RESET: 'liquidfocus:reset',
  LIQUIDFOCUS_SKIP: 'liquidfocus:skip',
  LIQUIDFOCUS_SET_ACTIVE_TASK: 'liquidfocus:set-active-task',
  LIQUIDFOCUS_GET_TASKS: 'liquidfocus:get-tasks',
  LIQUIDFOCUS_ADD_TASK: 'liquidfocus:add-task',
  LIQUIDFOCUS_UPDATE_TASK: 'liquidfocus:update-task',
  LIQUIDFOCUS_DELETE_TASK: 'liquidfocus:delete-task',
  LIQUIDFOCUS_GET_STATS: 'liquidfocus:get-stats'
} as const

/** Send channels (main → renderer, push notifications) */
export const IPC_SEND = {
  CLIPBOARD_ON_CHANGE: 'clipboard:on-change',
  FOCUSDIM_STATE_CHANGED: 'focusdim:state-changed',
  SOUNDSPLIT_SESSIONS_UPDATED: 'soundsplit:sessions-updated',
  CALENDAR_EVENTS_UPDATED: 'calendar:events-updated',
  SCREENSLAP_STATE_CHANGED: 'screenslap:state-changed',
  SCREENSLAP_ALERT_DATA: 'screenslap:alert-data',
  LICENSE_STATUS_CHANGED: 'license:status-changed',

  // LiquidFocus
  LIQUIDFOCUS_STATE_CHANGED: 'liquidfocus:state-changed',
  LIQUIDFOCUS_PHASE_COMPLETE: 'liquidfocus:phase-complete'
} as const
