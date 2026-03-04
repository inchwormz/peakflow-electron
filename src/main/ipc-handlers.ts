/**
 * IPC handler registration — all renderer -> main invoke channels.
 *
 * Phase 2: security/licensing handlers wired to real security module.
 * Config handlers use persistent electron-store.
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC_INVOKE } from '@shared/ipc-types'
import type { AccessStatus, LicenseActivationResult, WindowInfo } from '@shared/ipc-types'
import type { ConfigGetPayload, ConfigSetPayload } from '@shared/ipc-types'
import type { ToolConfig } from '@shared/config-schemas'
import { ToolId, SystemWindowId } from '@shared/tool-ids'
import type { WindowId } from '@shared/tool-ids'
import { createToolWindow, openToolWithAccessCheck, getToolWindow, closeToolWindow } from './windows'
import { rebuildTray } from './tray'
import { registerToolHotkey } from './hotkeys'
import { checkAccess } from './security/access-check'
import { activateLicense } from './security/license'
import { getTrialDaysRemaining, TRIAL_DAYS, installTool, isToolInstalled, getToolTrialDaysRemaining } from './security/trial'
import { getConfig, setConfig } from './services/config-store'
import { getFocusDimService, initFocusDim } from './services/focus-dim'
import type { FocusDimState, DisplayInfo } from './services/focus-dim'
import { getClipboardService, initClipboard } from './services/clipboard'
import type { ClipboardItem } from './services/clipboard'
import { getCalendarService, initCalendar } from './services/google-calendar'
import type { CalendarEvent, CalendarStatus } from './services/google-calendar'
import { getScreenSlapService, initScreenSlap } from './services/screenslap'
import type { ScreenSlapState } from './services/screenslap'
import { getLiquidFocusService, initLiquidFocus } from './services/liquidfocus'
import type { LiquidFocusFullState, LiquidFocusTask, TimerState, SessionStats } from './services/liquidfocus'
import { getSoundSplitBridge, initSoundSplit } from './sidecar/soundsplit-bridge'
import type { AudioSession, MasterAudio } from './sidecar/soundsplit-bridge'
import { getTodoistService } from './services/todoist'
import type { TodoistStatus, TodoistTask, TodoistProject } from './services/todoist'
import { getMicMuteState, setMicMute, toggleMicMute } from './services/mic-mute'
import type { MicMuteResult } from './services/mic-mute'

/**
 * Start a tool's background service after install from the Dashboard.
 * Singleton guards in each service prevent double-init.
 */
function startToolService(toolId: string): void {
  switch (toolId) {
    case ToolId.FocusDim:
      initFocusDim()
      break
    case ToolId.QuickBoard:
      initClipboard()
      break
    case ToolId.ScreenSlap:
      initCalendar()
      initScreenSlap()
      break
    case ToolId.MeetReady:
      initCalendar()
      break
    case ToolId.LiquidFocus:
      initLiquidFocus()
      break
    case ToolId.SoundSplit:
      initSoundSplit()
      break
  }
}

/**
 * Extract the toolId query parameter from a BrowserWindow's loaded URL.
 * Returns an empty string if parsing fails.
 */
function getToolIdFromSender(event: Electron.IpcMainInvokeEvent): string {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return ''
    const url = win.webContents.getURL()
    const parsed = new URL(url)
    return parsed.searchParams.get('toolId') ?? ''
  } catch {
    return ''
  }
}

/**
 * Register all IPC invoke handlers.
 * Must be called once during app startup, before any windows are created.
 */
export function registerIpcHandlers(): void {
  // ─── Security / Licensing ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.SECURITY_CHECK_ACCESS,
    async (): Promise<AccessStatus> => {
      return checkAccess()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_CHECK_TOOL_ACCESS,
    async (_event, toolId: string): Promise<AccessStatus> => {
      return checkAccess(toolId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_ACTIVATE_LICENSE,
    async (_event, key: string): Promise<LicenseActivationResult> => {
      return activateLicense(key)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_GET_TRIAL_STATUS,
    (): { daysRemaining: number; trialDays: number } => {
      return {
        daysRemaining: getTrialDaysRemaining(),
        trialDays: TRIAL_DAYS
      }
    }
  )

  // ─── Tool Install (Storefront) ──────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.TOOL_INSTALL,
    (_event, toolId: string): { installed: boolean; daysRemaining: number } => {
      const wasInstalled = isToolInstalled(toolId)
      installTool(toolId)
      if (!wasInstalled) {
        startToolService(toolId)
        registerToolHotkey(toolId as ToolId)
      }
      rebuildTray()
      return {
        installed: true,
        daysRemaining: getToolTrialDaysRemaining(toolId)
      }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TOOL_GET_INSTALL_STATE,
    (_event, toolId: string): { installed: boolean; daysRemaining: number } => {
      return {
        installed: isToolInstalled(toolId),
        daysRemaining: getToolTrialDaysRemaining(toolId)
      }
    }
  )

  // ─── Config ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CONFIG_GET,
    (_event, payload: ConfigGetPayload): ToolConfig | null => {
      try {
        return getConfig(payload.tool as ToolId)
      } catch (error) {
        console.warn('[PeakFlow] config:get failed:', error)
        return null
      }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CONFIG_SET,
    (_event, payload: ConfigSetPayload): boolean => {
      try {
        setConfig(payload.tool as ToolId, payload.key, payload.value)
        // Propagate config changes to running services
        if (payload.tool === ToolId.LiquidFocus) {
          getLiquidFocusService().refreshConfig()
        }
        if (payload.tool === ToolId.ScreenSlap) {
          getScreenSlapService().refreshConfig()
        }
        return true
      } catch (error) {
        console.warn('[PeakFlow] config:set failed:', error)
        return false
      }
    }
  )

  // ─── Window Management ──────────────────────────────────────────────────────

  ipcMain.handle(IPC_INVOKE.WINDOW_MINIMIZE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_CLOSE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  })

  ipcMain.handle(IPC_INVOKE.SHELL_OPEN_EXTERNAL, async (_event, url: string): Promise<void> => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return
      // Block localhost/loopback to prevent SSRF
      if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsed.hostname)) return
      await shell.openExternal(url)
    } catch {
      // Invalid URL — silently ignore
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_TOGGLE_MAXIMIZE, (event): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_INVOKE.WINDOW_GET_INFO, (event): WindowInfo => {
    const toolId = getToolIdFromSender(event)
    return { toolId }
  })

  // ─── FocusDim ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_TOGGLE,
    (): FocusDimState => {
      return getFocusDimService().toggle()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_OPACITY,
    (_event, opacity: number): void => {
      getFocusDimService().setOpacity(opacity)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_COLOR,
    (_event, colorKey: string): void => {
      getFocusDimService().setColor(colorKey)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_BORDER,
    (_event, show: boolean): void => {
      getFocusDimService().setBorder(show)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_FADE_DURATION,
    (_event, ms: number): void => {
      getFocusDimService().setFadeDuration(ms)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_PEEK,
    (): void => {
      getFocusDimService().peek()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_PEEK_DURATION,
    (_event, seconds: number): void => {
      getFocusDimService().setPeekDuration(seconds)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_GET_STATE,
    (): FocusDimState => {
      return getFocusDimService().getState()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_HOTKEY,
    (_event, accelerator: string): boolean => {
      return getFocusDimService().setHotkey(accelerator)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_GET_DISPLAYS,
    (): DisplayInfo[] => {
      return getFocusDimService().getDisplays()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_DISABLED_DISPLAYS,
    (_event, ids: number[]): void => {
      getFocusDimService().setDisabledDisplays(ids)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_SET_HIGHLIGHT_MODE,
    (_event, mode: string): void => {
      if (mode === 'active' || mode === 'app' || mode === 'all') {
        getFocusDimService().setHighlightMode(mode)
      }
    }
  )

  // ─── QuickBoard / Clipboard ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().getHistory()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_WRITE_TEXT,
    (_event, text: string): void => {
      getClipboardService().writeText(text)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE,
    (_event, itemId: string, plainText?: boolean): void => {
      getClipboardService().simulatePaste(itemId, plainText ?? false)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_DELETE_ITEM,
    (_event, itemId: string): ClipboardItem[] => {
      return getClipboardService().deleteItem(itemId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_PIN_ITEM,
    (_event, itemId: string): ClipboardItem[] => {
      return getClipboardService().pinItem(itemId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_CLEAR_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().clearHistory()
    }
  )

  // ─── Google Calendar (shared by ScreenSlap + MeetReady) ────────────────────

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_GET_EVENTS,
    (): CalendarEvent[] => {
      return getCalendarService().getEvents()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_AUTHENTICATE,
    async (): Promise<CalendarStatus> => {
      return getCalendarService().authenticate()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_GET_STATUS,
    (): CalendarStatus => {
      return getCalendarService().getStatus()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_DISCONNECT,
    (): CalendarStatus => {
      return getCalendarService().disconnect()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_FETCH_NOW,
    async (): Promise<CalendarEvent[]> => {
      return getCalendarService().fetchEvents()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_SET_ICAL_URL,
    (_event, url: string | null): CalendarStatus => {
      return getCalendarService().setIcalUrl(url)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_GET_ICAL_URL,
    (): string | null => {
      return getCalendarService().getIcalUrl()
    }
  )

  // ─── ScreenSlap ───────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_GET_STATE,
    (): ScreenSlapState => {
      return getScreenSlapService().getState()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_SNOOZE,
    (_event, eventId: string, minutes: number): void => {
      getScreenSlapService().snooze(eventId, minutes)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_DISMISS,
    (): void => {
      getScreenSlapService().dismiss()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_JOIN_MEETING,
    (_event, url: string): void => {
      getScreenSlapService().joinMeeting(url)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_START,
    (): void => {
      getScreenSlapService().start()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_STOP,
    (): void => {
      getScreenSlapService().stop()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SCREENSLAP_TEST_ALERT,
    (): void => {
      getScreenSlapService().testAlert()
    }
  )

  // ─── LiquidFocus ─────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_GET_STATE,
    (): LiquidFocusFullState => {
      return getLiquidFocusService().getState()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_START,
    (): TimerState => {
      return getLiquidFocusService().start()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_PAUSE,
    (): TimerState => {
      return getLiquidFocusService().pause()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_RESET,
    (): TimerState => {
      return getLiquidFocusService().reset()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_SKIP,
    (): TimerState => {
      return getLiquidFocusService().skip()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_SET_ACTIVE_TASK,
    (_event, index: number): void => {
      getLiquidFocusService().setActiveTask(index)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_GET_TASKS,
    (): LiquidFocusTask[] => {
      return getLiquidFocusService().getTasks()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_ADD_TASK,
    (_event, task: Omit<LiquidFocusTask, 'id' | 'createdAt'>): LiquidFocusTask[] => {
      return getLiquidFocusService().addTask(task)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_UPDATE_TASK,
    (_event, taskId: string, updates: Partial<LiquidFocusTask>): LiquidFocusTask[] => {
      return getLiquidFocusService().updateTask(taskId, updates)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_DELETE_TASK,
    (_event, taskId: string): LiquidFocusTask[] => {
      return getLiquidFocusService().deleteTask(taskId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_GET_STATS,
    (): SessionStats => {
      return getLiquidFocusService().getStats()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_RECORD_INTERRUPTION,
    (): void => {
      getLiquidFocusService().recordInterruption()
    }
  )

  // ─── SoundSplit ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_GET_SESSIONS,
    (): AudioSession[] => {
      return getSoundSplitBridge().getSessions()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_VOLUME,
    (_event, pid: number, volume: number): boolean => {
      return getSoundSplitBridge().setVolume(pid, volume)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_MUTE,
    (_event, pid: number, muted: boolean): boolean => {
      return getSoundSplitBridge().setMute(pid, muted)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_GET_MASTER,
    (): MasterAudio => {
      return getSoundSplitBridge().getMaster()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_MASTER,
    (_event, volume: number): boolean => {
      return getSoundSplitBridge().setMaster(volume)
    }
  )

  // ─── Todoist ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.TODOIST_AUTHENTICATE,
    async (): Promise<TodoistStatus> => {
      return getTodoistService().authenticate()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TODOIST_DISCONNECT,
    (): TodoistStatus => {
      return getTodoistService().disconnect()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TODOIST_GET_STATUS,
    (): TodoistStatus => {
      return getTodoistService().getStatus()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TODOIST_GET_TASKS,
    async (_event, projectId?: string): Promise<TodoistTask[]> => {
      return getTodoistService().getTasks(projectId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TODOIST_COMPLETE_TASK,
    async (_event, taskId: string): Promise<boolean> => {
      return getTodoistService().completeTask(taskId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.TODOIST_GET_PROJECTS,
    async (): Promise<TodoistProject[]> => {
      return getTodoistService().getProjects()
    }
  )

  // ─── Mic Mute ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.MIC_GET_MUTE,
    async (): Promise<MicMuteResult> => {
      return getMicMuteState()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.MIC_SET_MUTE,
    async (_event, muted: boolean): Promise<MicMuteResult> => {
      return setMicMute(muted)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.MIC_TOGGLE_MUTE,
    async (): Promise<MicMuteResult> => {
      return toggleMicMute()
    }
  )

  // ─── LiquidFocus Mini Mode ─────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_TOGGLE_MINI,
    (): void => {
      const existing = getToolWindow(SystemWindowId.LiquidFocusMini)
      if (existing) {
        closeToolWindow(SystemWindowId.LiquidFocusMini)
      } else {
        createToolWindow(SystemWindowId.LiquidFocusMini)
      }
    }
  )

  // ─── Window Management (open tool from Dashboard) ─────────────────────────

  ipcMain.handle(
    IPC_INVOKE.WINDOW_OPEN,
    async (_event, payload: { toolId: string }): Promise<void> => {
      await openToolWithAccessCheck(payload.toolId as WindowId)
    }
  )

  // ─── Bug Report ─────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.BUGREPORT_SEND_EMAIL,
    async (event): Promise<void> => {
      const toolId = getToolIdFromSender(event) || undefined
      const { sendViaEmail } = await import('./services/bug-report')
      await sendViaEmail(toolId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.BUGREPORT_COPY_TO_CLIPBOARD,
    async (event): Promise<void> => {
      const toolId = getToolIdFromSender(event) || undefined
      const { copyToClipboard } = await import('./services/bug-report')
      await copyToClipboard(toolId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.BUGREPORT_REVEAL_LOG,
    async (): Promise<void> => {
      const { revealLogFile } = await import('./services/bug-report')
      revealLogFile()
    }
  )

  console.log('[PeakFlow] IPC handlers registered')
}
