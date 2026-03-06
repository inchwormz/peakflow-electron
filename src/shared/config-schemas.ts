/**
 * Default configuration for each tool.
 * These match the Python app config.json defaults exactly.
 */

import { ToolId } from './tool-ids'

export interface FocusDimConfig {
  opacity: number
  enabled: boolean
  hotkey: string
  dim_color: string
  show_border: boolean
  fade_duration: number
  peek_duration: number
  auto_reveal_desktop: boolean
  disabled_displays: number[]
  highlight_mode: 'active' | 'app' | 'all'
  drag_escape: boolean
  excluded_apps: Array<{ exe: string; name: string }>
}

export interface QuickBoardConfig {
  max_entries: number
  max_age_hours: number
  auto_expire: boolean
  encrypt_history: boolean
  search_fuzzy: boolean
  plain_text_mode: boolean
  ai_onboarding_complete: boolean
  ai_translate_default_lang: string
  ai_suggestions_enabled: boolean
  ai_last_suggestion_date: string
  ai_dismissed_suggestions: string[]
}

export interface ScreenSlapConfig {
  alert_minutes_before: number
  fetch_interval_minutes: number
  alert_check_seconds: number
  alert_duration_seconds: number
  alert_sound: boolean
  monitor_index: number
}

export interface MeetReadyConfig {
  auto_popup_minutes_before: number
  auto_popup_enabled: boolean
  default_camera: string
  default_mic: string
}

export interface LiquidFocusConfig {
  work_duration: number
  break_duration: number
  long_break_duration: number
  sessions_before_long: number
  alert_sound: boolean
  auto_start_breaks: boolean
  todoist_project_filter: string
  distraction_sites: string[]
  /** Enable webcam-based focus detection during work sessions */
  focus_detection_enabled: boolean
  /** Seconds of looking away before counting as a distraction (default: 5) */
  focus_away_threshold_secs: number
}

export interface SoundSplitConfig {
  show_master_volume: boolean
  auto_show_new_apps: boolean
  hide_on_startup: boolean
  remember_volumes: boolean
}

export type ToolConfig =
  | FocusDimConfig
  | QuickBoardConfig
  | ScreenSlapConfig
  | MeetReadyConfig
  | LiquidFocusConfig
  | SoundSplitConfig

/** Default values matching Python app config.json defaults */
export const DEFAULT_CONFIGS: Record<ToolId, ToolConfig> = {
  [ToolId.FocusDim]: {
    opacity: 0.6,
    enabled: false,
    hotkey: 'ctrl+shift+d',
    dim_color: '#000000',
    show_border: true,
    fade_duration: 200,
    peek_duration: 3,
    auto_reveal_desktop: true,
    disabled_displays: [],
    highlight_mode: 'active' as const,
    drag_escape: true,
    excluded_apps: []
  },
  [ToolId.QuickBoard]: {
    max_entries: 500,
    max_age_hours: 24,
    auto_expire: true,
    encrypt_history: false,
    search_fuzzy: true,
    plain_text_mode: false,
    ai_onboarding_complete: false,
    ai_translate_default_lang: '',
    ai_suggestions_enabled: true,
    ai_last_suggestion_date: '',
    ai_dismissed_suggestions: []
  },
  [ToolId.ScreenSlap]: {
    alert_minutes_before: 1,
    fetch_interval_minutes: 10,
    alert_check_seconds: 30,
    alert_duration_seconds: 60,
    alert_sound: true,
    monitor_index: 0
  },
  [ToolId.MeetReady]: {
    auto_popup_minutes_before: 2,
    auto_popup_enabled: true,
    default_camera: '',
    default_mic: ''
  },
  [ToolId.LiquidFocus]: {
    work_duration: 25,
    break_duration: 5,
    long_break_duration: 15,
    sessions_before_long: 4,
    alert_sound: true,
    auto_start_breaks: false,
    todoist_project_filter: '',
    focus_detection_enabled: false,
    focus_away_threshold_secs: 5,
    distraction_sites: [
      'youtube.com',
      'facebook.com',
      'instagram.com',
      'reddit.com',
      'tiktok.com',
      'netflix.com',
      'twitter.com',
      'x.com'
    ]
  },
  [ToolId.SoundSplit]: {
    show_master_volume: true,
    auto_show_new_apps: true,
    hide_on_startup: true,
    remember_volumes: true
  }
}
