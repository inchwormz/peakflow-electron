/**
 * Type-safe IPC channel definitions.
 * Naming convention: 'domain:action'
 *
 * Main <-> Renderer communication uses these channels exclusively.
 * All payloads are serializable (no functions, no classes).
 */

import type { ToolId } from './tool-ids'
import { LAUNCHER_INVOKE, LAUNCHER_SEND } from './launcher/ipc'

// ─── Security / Licensing ────────────────────────────────────────────────────

export interface AccessStatus {
  allowed: boolean
  message: string
  daysRemaining: number
  isLicensed: boolean
  /** True only when the license specifically covers THIS tool (not just "user has any license") */
  isToolLicensed: boolean
  /** True when the license covers the full suite (subscription / bundle / legacy key) */
  isSuiteLicense?: boolean
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
  SECURITY_CHECK_TOOL_ACCESS: 'security:check-tool-access',
  SECURITY_ACTIVATE_LICENSE: 'security:activate-license',
  SECURITY_GET_TRIAL_STATUS: 'security:get-trial-status',

  // Tool install (storefront)
  TOOL_INSTALL: 'tool:install',
  TOOL_GET_INSTALL_STATE: 'tool:get-install-state',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_GET_INFO: 'window:get-info',
  WINDOW_OPEN: 'window:open',

  // FocusDim
  FOCUSDIM_TOGGLE: 'focusdim:toggle',
  FOCUSDIM_SET_OPACITY: 'focusdim:set-opacity',
  FOCUSDIM_SET_COLOR: 'focusdim:set-color',
  FOCUSDIM_SET_BORDER: 'focusdim:set-border',
  FOCUSDIM_SET_FADE_DURATION: 'focusdim:set-fade-duration',
  FOCUSDIM_PEEK: 'focusdim:peek',
  FOCUSDIM_SET_PEEK_DURATION: 'focusdim:set-peek-duration',
  FOCUSDIM_GET_STATE: 'focusdim:get-state',
  FOCUSDIM_SET_HOTKEY: 'focusdim:set-hotkey',
  FOCUSDIM_GET_DISPLAYS: 'focusdim:get-displays',
  FOCUSDIM_SET_DISABLED_DISPLAYS: 'focusdim:set-disabled-displays',
  FOCUSDIM_SET_HIGHLIGHT_MODE: 'focusdim:set-highlight-mode',
  FOCUSDIM_GET_RUNNING_APPS: 'focusdim:get-running-apps',
  FOCUSDIM_ADD_EXCLUDED_APP: 'focusdim:add-excluded-app',
  FOCUSDIM_REMOVE_EXCLUDED_APP: 'focusdim:remove-excluded-app',

  // SnapGrid
  SNAPGRID_GET_STATE: 'snapgrid:get-state',
  SNAPGRID_APPLY: 'snapgrid:apply',
  SNAPGRID_ARRANGE: 'snapgrid:arrange',
  SNAPGRID_PREVIEW: 'snapgrid:preview',
  SNAPGRID_UNDO: 'snapgrid:undo',
  SNAPGRID_SET_DRAG: 'snapgrid:set-drag',
  SNAPGRID_OPEN_OS_SETTINGS: 'snapgrid:open-os-settings',

  // App-level
  APP_GET_AUTO_START: 'app:get-auto-start',
  APP_SET_AUTO_START: 'app:set-auto-start',

  // QuickBoard
  CLIPBOARD_GET_HISTORY: 'clipboard:get-history',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  CLIPBOARD_SIMULATE_PASTE: 'clipboard:simulate-paste',
  CLIPBOARD_DELETE_ITEM: 'clipboard:delete-item',
  CLIPBOARD_PIN_ITEM: 'clipboard:pin-item',
  CLIPBOARD_ADD_PINNED_ITEM: 'clipboard:add-pinned-item',
  CLIPBOARD_CLEAR_HISTORY: 'clipboard:clear-history',
  CLIPBOARD_SET_TAGS: 'clipboard:set-tags',
  CLIPBOARD_GET_ALL_TAGS: 'clipboard:get-all-tags',
  CLIPBOARD_MANAGE_TAGS: 'clipboard:manage-tags',
  CLIPBOARD_EDIT_ITEM: 'clipboard:edit-item',
  CLIPBOARD_QUEUE_START: 'clipboard:queue-start',
  CLIPBOARD_QUEUE_NEXT: 'clipboard:queue-next',
  CLIPBOARD_QUEUE_CANCEL: 'clipboard:queue-cancel',
  CLIPBOARD_QUEUE_STATUS: 'clipboard:queue-get-status',
  CLIPBOARD_GET_TRANSFORMS: 'clipboard:get-transforms',
  CLIPBOARD_SAVE_TRANSFORM: 'clipboard:save-transform',
  CLIPBOARD_DELETE_TRANSFORM: 'clipboard:delete-transform',
  CLIPBOARD_PASTE_WITH_TRANSFORM: 'clipboard:paste-with-transform',
  CLIPBOARD_RUN_OCR: 'clipboard:run-ocr',

  // QuickBoard AI
  CLIPBOARD_AI_TRANSFORM: 'clipboard:ai-transform',
  CLIPBOARD_AI_ONBOARD: 'clipboard:ai-onboard',
  CLIPBOARD_AI_CHECK_ACCESS: 'clipboard:ai-check-access',
  CLIPBOARD_ONBOARDING_APPLY_CONFIG: 'clipboard:onboarding-apply-config',
  CLIPBOARD_AI_SUGGEST: 'clipboard:ai-suggest',
  CLIPBOARD_AI_DISMISS_SUGGESTION: 'clipboard:ai-dismiss-suggestion',

  // QuickBoard Workflows
  CLIPBOARD_GET_WORKFLOWS: 'clipboard:get-workflows',
  CLIPBOARD_SAVE_WORKFLOW: 'clipboard:save-workflow',
  CLIPBOARD_DELETE_WORKFLOW: 'clipboard:delete-workflow',
  CLIPBOARD_START_WORKFLOW: 'clipboard:start-workflow',
  CLIPBOARD_WORKFLOW_PASTE_NEXT: 'clipboard:workflow-paste-next',
  CLIPBOARD_CANCEL_WORKFLOW: 'clipboard:cancel-workflow',

  // QuickBoard Form Fill
  CLIPBOARD_GET_FORM_PROFILES: 'clipboard:get-form-profiles',
  CLIPBOARD_SAVE_FORM_PROFILE: 'clipboard:save-form-profile',
  CLIPBOARD_DELETE_FORM_PROFILE: 'clipboard:delete-form-profile',
  CLIPBOARD_START_FORM_FILL: 'clipboard:start-form-fill',
  CLIPBOARD_FORM_PASTE_NEXT: 'clipboard:form-paste-next',
  CLIPBOARD_CANCEL_FORM_FILL: 'clipboard:cancel-form-fill',
  // v2 quickboard: which paste sequence (queue, workflow or form) is running, for the panel's banner
  CLIPBOARD_PASTE_STATUS: 'clipboard:v2-paste-status',

  // SoundSplit
  SOUNDSPLIT_GET_SESSIONS: 'soundsplit:get-sessions',
  SOUNDSPLIT_SET_VOLUME: 'soundsplit:set-volume',
  SOUNDSPLIT_SET_MUTE: 'soundsplit:set-mute',
  SOUNDSPLIT_GET_MASTER: 'soundsplit:get-master',
  SOUNDSPLIT_SET_MASTER: 'soundsplit:set-master',

  // Calendar (shared by ScreenSlap + MeetReady)
  CALENDAR_GET_EVENTS: 'calendar:get-events',
  CALENDAR_GET_STATUS: 'calendar:get-status',
  CALENDAR_DISCONNECT: 'calendar:disconnect',
  CALENDAR_FETCH_NOW: 'calendar:fetch-now',
  CALENDAR_SET_ICAL_URL: 'calendar:set-ical-url',
  CALENDAR_GET_ICAL_URL: 'calendar:get-ical-url',

  // ScreenSlap
  SCREENSLAP_GET_STATE: 'screenslap:get-state',
  SCREENSLAP_SNOOZE: 'screenslap:snooze',
  SCREENSLAP_DISMISS: 'screenslap:dismiss',
  SCREENSLAP_JOIN_MEETING: 'screenslap:join-meeting',
  SCREENSLAP_START: 'screenslap:start',
  SCREENSLAP_STOP: 'screenslap:stop',
  SCREENSLAP_TEST_ALERT: 'screenslap:test-alert',

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
  LIQUIDFOCUS_GET_STATS: 'liquidfocus:get-stats',
  LIQUIDFOCUS_RECORD_INTERRUPTION: 'liquidfocus:record-interruption',
  LIQUIDFOCUS_TOGGLE_MINI: 'liquidfocus:toggle-mini',
  LIQUIDFOCUS_SET_MINI: 'liquidfocus:set-mini',
  /** v2 mini timer: move it while you drag ({x, y, done}) */
  LIQUIDFOCUS_MINI_MOVE: 'liquidfocus:mini-move',
  /** v2 panel: the renderer reports its current route (so hotkeys know which tool is showing) */
  PANEL_ROUTE: 'panel:route',
  /** v2: the panel page has mounted; returns the route asked for while it loaded (or null) */
  PANEL_READY: 'panel:ready',
  /** v2: the panel's focus detector reports its state ('focused' | 'absent' | 'away' | 'off' …) for the mini */
  LIQUIDFOCUS_DETECTOR_STATUS: 'liquidfocus:detector-status',
  // v2 liquidfocus: restart the current phase (panel "Reset")
  LIQUIDFOCUS_RESTART_PHASE: 'liquidfocus:restart-phase',
  /** v2: Close on the mini's "Looked away" card clears main's notice */
  LIQUIDFOCUS_DISMISS_AWAY: 'liquidfocus:dismiss-away',

  // Shell
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Todoist
  TODOIST_AUTHENTICATE: 'todoist:authenticate',
  TODOIST_DISCONNECT: 'todoist:disconnect',
  TODOIST_GET_STATUS: 'todoist:get-status',
  TODOIST_GET_TASKS: 'todoist:get-tasks',
  TODOIST_COMPLETE_TASK: 'todoist:complete-task',
  TODOIST_GET_PROJECTS: 'todoist:get-projects',

  // Mic Mute (system-level, used by MeetReady hotkey)
  MIC_GET_MUTE: 'mic:get-mute',
  MIC_SET_MUTE: 'mic:set-mute',
  MIC_TOGGLE_MUTE: 'mic:toggle-mute',

  // Hotkeys
  HOTKEY_GET_REGISTERED: 'hotkey:get-registered',

  // One-app panel (v2)
  PANEL_RESIZE: 'panel:resize',
  PANEL_HIDE: 'panel:hide',
  PANEL_SHOW: 'panel:show',
  APP_QUIT: 'app:quit',
  APP_GET_INFO: 'app:get-info',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_GET_ICON: 'app:get-icon',
  APP_CHECK_ACCESSIBILITY: 'app:check-accessibility',
  APP_OPEN_ACCESSIBILITY: 'app:open-accessibility',
  /** macOS permission status with the shared advice text (shared/mac-permissions.ts) */
  APP_PERMISSION_STATUS: 'app:permission-status',
  APP_OPEN_PERMISSION: 'app:open-permission',
  /** macOS set-up page: where PeakFlow runs from, and its permissions */
  APP_SETUP_INFO: 'app:setup-info',
  APP_MOVE_TO_APPLICATIONS: 'app:move-to-applications',
  /** Mac update download progress (UpdateProgress) */
  APP_UPDATE_STATUS: 'app:update-status',

  // Bug Report
  BUGREPORT_SEND_EMAIL: 'bugreport:send-email',
  BUGREPORT_COPY_TO_CLIPBOARD: 'bugreport:copy-to-clipboard',
  BUGREPORT_REVEAL_LOG: 'bugreport:reveal-log',

  // Launcher (⌥Space command bar)
  ...LAUNCHER_INVOKE
} as const

/** Send channels (main → renderer, push notifications) */
export const IPC_SEND = {
  CLIPBOARD_ON_CHANGE: 'clipboard:on-change',
  CLIPBOARD_AI_SUGGESTIONS_READY: 'clipboard:ai-suggestions-ready',
  CLIPBOARD_QUEUE_STATUS: 'clipboard:queue-status',
  FOCUSDIM_STATE_CHANGED: 'focusdim:state-changed',
  FOCUSDIM_OVERLAY_UPDATE: 'focusdim:overlay-update',
  SNAPGRID_STATE_CHANGED: 'snapgrid:state-changed',
  SOUNDSPLIT_SESSIONS_UPDATED: 'soundsplit:sessions-updated',
  CALENDAR_EVENTS_UPDATED: 'calendar:events-updated',
  CALENDAR_STATUS_CHANGED: 'calendar:status-changed',
  SCREENSLAP_STATE_CHANGED: 'screenslap:state-changed',
  SCREENSLAP_ALERT_DATA: 'screenslap:alert-data',
  LICENSE_STATUS_CHANGED: 'license:status-changed',

  // LiquidFocus
  LIQUIDFOCUS_STATE_CHANGED: 'liquidfocus:state-changed',
  LIQUIDFOCUS_PHASE_COMPLETE: 'liquidfocus:phase-complete',

  // Todoist
  TODOIST_STATUS_CHANGED: 'todoist:status-changed',

  // Mic Mute
  MIC_MUTE_CHANGED: 'mic:mute-changed',

  // One-app panel (v2): main asks the panel to show a route (e.g. 'quickboard')
  PANEL_NAVIGATE: 'panel:navigate',
  PANEL_VISIBILITY: 'panel:visibility',
  /** Mac update download progress changed (UpdateProgress) */
  APP_UPDATE_PROGRESS: 'app:update-progress',
  /** v2 mini timer: its colour changed ('dark' | 'light') */
  LIQUIDFOCUS_MINI_THEME: 'liquidfocus:mini-theme',
  /** v2: the detector's state, forwarded to the mini timer */
  LIQUIDFOCUS_DETECTOR: 'liquidfocus:detector',
  /** v2: a focus session was reset because you looked away */
  LIQUIDFOCUS_AWAY_RESET: 'liquidfocus:away-reset',
  /** v2: a tool setting changed ({ tool, key, value }), so every screen and the background detector follow it at once */
  CONFIG_CHANGED: 'config:changed',

  // Launcher (⌥Space command bar)
  ...LAUNCHER_SEND
} as const

/** What the renderer asks APP_GET_ICON for: an app bundle id, an app name, a file path or a link. */
export interface AppIconQuery {
  bundleId?: string
  name?: string
  path?: string
  url?: string
}
