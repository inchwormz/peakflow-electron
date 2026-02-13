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
  CALENDAR_GET_STATUS: 'calendar:get-status'
} as const

/** Send channels (main → renderer, push notifications) */
export const IPC_SEND = {
  CLIPBOARD_ON_CHANGE: 'clipboard:on-change',
  FOCUSDIM_STATE_CHANGED: 'focusdim:state-changed',
  SOUNDSPLIT_SESSIONS_UPDATED: 'soundsplit:sessions-updated',
  CALENDAR_EVENTS_UPDATED: 'calendar:events-updated',
  LICENSE_STATUS_CHANGED: 'license:status-changed'
} as const
