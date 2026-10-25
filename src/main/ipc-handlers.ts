/**
 * IPC handler registration — all renderer -> main invoke channels.
 *
 * Phase 2: security/licensing handlers wired to real security module.
 * Config handlers use persistent electron-store.
 */

import { ipcMain, BrowserWindow, shell, app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { AccessStatus, LicenseActivationResult, WindowInfo, AppIconQuery, AppInfo } from '@shared/ipc-types'
import type { ConfigGetPayload, ConfigSetPayload } from '@shared/ipc-types'
import type { ToolConfig, LiquidFocusConfig } from '@shared/config-schemas'
import { ToolId, SystemWindowId, TODOIST_ENABLED } from '@shared/tool-ids'
import type { WindowId } from '@shared/tool-ids'
import { createToolWindow, openToolWithAccessCheck, getToolWindow, closeToolWindow } from './windows'
import { rebuildTray } from './tray'
import { resizePanel, hidePanel, showPanel, setPanelRoute, getPanel, isPanelVisible, visiblePanelTool, panelRendererReady } from './panel'
import { applyMiniTheme, layoutMini, moveMini, refreshMiniSize } from './mini-window'
import { getAppIcon } from './services/app-icons'
import { checkAccessibility, requestAccessibility, permissionStatus, openPermissionPane, appLocation, moveToApplications, watchForFix } from './services/permissions-darwin'
import { checkForUpdates, getUpdateProgress } from './services/auto-updater'
import { registerToolHotkey, getRegisteredHotkeys } from './hotkeys'
import { setItemTags, getAllTags, manageTags } from './services/clipboard-collections'
import { cancelQueue, getQueueStatus } from './services/clipboard-sequential'
import {
  getSavedPipelines,
  AVAILABLE_TRANSFORMS,
  savePipeline,
  deletePipeline,
  applyPipeline,
  type TransformPipeline,
  type TransformStep
} from './services/clipboard-transforms'
import type { FormField } from './services/clipboard-forms'
import { checkAiAccess, aiTransform, aiOnboard } from './services/clipboard-ai'
import { getSuggestions, dismissSuggestion } from './services/clipboard-suggestions'
import {
  getWorkflows,
  saveWorkflow,
  deleteWorkflow,
  startWorkflow,
  cancelWorkflow,
  saveBulkWorkflows
} from './services/clipboard-workflows'
import {
  getFormProfiles,
  saveFormProfile,
  deleteFormProfile,
  startFormFill,
  cancelFormFill,
  saveBulkFormProfiles
} from './services/clipboard-forms'
import { runOcr } from './services/clipboard-ocr'
import { checkAccess } from './security/access-check'
import { withToolAccess } from './security/access-guard'
import { guardedQueueStart, guardedQueueNext, guardedWorkflowPasteNext, guardedFormPasteNext } from './quickboard-paste'
import { activateLicense, deactivateLicense } from './security/license'
import { getTrialDaysRemaining, TRIAL_DAYS, installTool, isToolInstalled, getToolTrialDaysRemaining } from './security/trial'
import { getConfig, setConfig } from './services/config-store'
import { getFocusDimService, initFocusDim } from './services/focus-dim'
import type { FocusDimState, DisplayInfo } from './services/focus-dim'
import { getSnapGridService, initSnapGrid } from './services/snapgrid'
import { isSnapLayoutKey, isArrangeKey } from '@shared/snapgrid-layouts'
import type { SnapGridState } from '@shared/snapgrid-layouts'
import { getClipboardService, initClipboard } from './services/clipboard'
import type { ClipboardItem } from './services/clipboard'
import { getCalendarService, initCalendar } from './services/google-calendar'
import type { CalendarEvent, CalendarStatus } from './services/google-calendar'
import { getScreenSlapService, initScreenSlap } from './services/screenslap'
import type { ScreenSlapState } from './services/screenslap'
import { getLiquidFocusService, initLiquidFocus } from './services/liquidfocus'
import type { LiquidFocusFullState, LiquidFocusTask, TimerState, SessionStats } from './services/liquidfocus'
import { getSoundSplitBridge, initSoundSplit } from './sidecar/soundsplit-bridge'
import { isToolSupportedOn } from '@shared/platform-tools'
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
    case ToolId.SnapGrid:
      initSnapGrid()
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
      const result = await activateLicense(key)
      // ScreenSlap doesn't monitor without access; a new licence switches it on now
      if (result.success && isToolInstalled(ToolId.ScreenSlap)) void getScreenSlapService().start()
      return result
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SECURITY_DEACTIVATE_LICENSE,
    async (): Promise<LicenseActivationResult> => deactivateLicense()
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
          const mini = getToolWindow(SystemWindowId.LiquidFocusMini)
          if (payload.key === 'mini_size') refreshMiniSize(mini)
          if (payload.key === 'mini_theme' && mini && !mini.isDestroyed()) {
            applyMiniTheme(mini, payload.value)
            mini.webContents.send(IPC_SEND.LIQUIDFOCUS_MINI_THEME, payload.value === 'light' ? 'light' : 'dark')
          }
        }
        if (payload.tool === ToolId.ScreenSlap) {
          getScreenSlapService().refreshConfig()
        }
        // The panel's background jobs (focus detection) follow settings at once
        const panelWin = getPanel()
        if (panelWin && !panelWin.webContents.isDestroyed() && !panelWin.webContents.isLoading()) {
          panelWin.webContents.send(IPC_SEND.CONFIG_CHANGED, { tool: payload.tool, key: payload.key, value: payload.value })
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
    (): Promise<FocusDimState> => {
      return getFocusDimService().requestToggle()
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

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_GET_RUNNING_APPS,
    (): Array<{ exe: string; name: string }> => {
      return getFocusDimService().getRunningApps()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_ADD_EXCLUDED_APP,
    (_event, exe: string, name: string): { exe: string; name: string } | null => {
      if (typeof exe !== 'string' || typeof name !== 'string') return null
      return getFocusDimService().addExcludedAppByExe(exe, name)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.FOCUSDIM_REMOVE_EXCLUDED_APP,
    (_event, exe: string): void => {
      if (typeof exe !== 'string') return
      getFocusDimService().removeExcludedApp(exe)
    }
  )

  // ─── SnapGrid ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_INVOKE.SNAPGRID_GET_STATE, (): Promise<SnapGridState> => getSnapGridService().getState())

  ipcMain.handle(IPC_INVOKE.SNAPGRID_APPLY, (_event, key: unknown): Promise<string> | string => {
    if (!isSnapLayoutKey(key)) return 'Unknown layout'
    return getSnapGridService().applyLayout(key, { fromPanel: true })
  })

  ipcMain.handle(IPC_INVOKE.SNAPGRID_ARRANGE, (_event, key: unknown): Promise<string> | string => {
    if (!isArrangeKey(key)) return 'Unknown layout'
    return getSnapGridService().arrange(key)
  })

  ipcMain.handle(IPC_INVOKE.SNAPGRID_PREVIEW, (_event, kind: unknown, key: unknown): Promise<void> => {
    const k = kind === 'layout' || kind === 'arrange' ? kind : null
    return getSnapGridService().preview(k, typeof key === 'string' ? key : undefined)
  })

  ipcMain.handle(IPC_INVOKE.SNAPGRID_UNDO, (): Promise<string> => getSnapGridService().undo({ fromPanel: true }))

  ipcMain.handle(IPC_INVOKE.SNAPGRID_SET_DRAG, (_event, on: unknown): void => {
    if (typeof on === 'boolean') getSnapGridService().setDragSnap(on)
  })

  ipcMain.handle(IPC_INVOKE.SNAPGRID_OPEN_OS_SETTINGS, (): void => getSnapGridService().openOsWindowSettings())

  // ─── QuickBoard / Clipboard ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().getHistory()
    }
  )

  ipcMain.handle(IPC_INVOKE.CLIPBOARD_LINK_PREVIEW, (_event, itemId: unknown): void => {
    if (typeof itemId === 'string') getClipboardService().requestLinkPreview(itemId)
  })

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_WRITE_TEXT,
    (_event, text: string): void => {
      getClipboardService().writeText(text)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SIMULATE_PASTE,
    (_event, itemId: string, plainText?: boolean, textOverride?: string): Promise<void> => {
      return withToolAccess(checkAccess, ToolId.QuickBoard, () => getClipboardService().simulatePaste(itemId, plainText ?? false, textOverride), () => {})
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
    IPC_INVOKE.CLIPBOARD_ADD_PINNED_ITEM,
    (_event, text: string): ClipboardItem[] => {
      getClipboardService().addPinnedTextItem(text)
      return getClipboardService().getHistory()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_CLEAR_HISTORY,
    (): ClipboardItem[] => {
      return getClipboardService().clearHistory()
    }
  )

  // ─── QuickBoard: Tags ──────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SET_TAGS,
    (_event, itemId: string, tags: string[]): ClipboardItem[] => {
      setItemTags(itemId, tags)
      return getClipboardService().getHistory()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_ALL_TAGS,
    (): string[] => {
      return getAllTags()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_MANAGE_TAGS,
    (
      _event,
      action: 'create' | 'rename' | 'delete' | 'reorder',
      payload: { oldName?: string; newName?: string; name?: string; tags?: string[] }
    ): string[] => {
      return manageTags(action, payload)
    }
  )

  // ─── QuickBoard: Edit ─────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_EDIT_ITEM,
    (_event, itemId: string, editedText: string): ClipboardItem[] => {
      return getClipboardService().editItem(itemId, editedText)
    }
  )

  // ─── QuickBoard: Sequential Paste ─────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_QUEUE_START,
    (_event, itemIds: unknown): Promise<void> => {
      if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) return Promise.resolve()
      return guardedQueueStart(itemIds)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_QUEUE_NEXT,
    (): Promise<boolean> => {
      return guardedQueueNext()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_QUEUE_CANCEL,
    (): void => {
      cancelQueue()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_QUEUE_STATUS,
    (): { active: boolean; current: number; total: number } => {
      return getQueueStatus()
    }
  )

  // ─── QuickBoard: Transforms ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_TRANSFORMS,
    () => {
      return { pipelines: getSavedPipelines(), available: AVAILABLE_TRANSFORMS }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SAVE_TRANSFORM,
    (_event, pipeline: TransformPipeline) => {
      return savePipeline(pipeline)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_DELETE_TRANSFORM,
    (_event, pipelineId: string) => {
      return deletePipeline(pipelineId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_PASTE_WITH_TRANSFORM,
    (_event, itemId: string, steps: TransformStep[]) => withToolAccess(checkAccess, ToolId.QuickBoard, () => {
      const clipService = getClipboardService()
      const history = clipService.getHistory()
      const item = history.find((h: ClipboardItem) => h.id === itemId)
      if (!item || item.type !== 'text') return
      const text = item.editedText ?? item.text ?? ''
      const transformed = applyPipeline(steps, text)
      clipService.simulatePaste(itemId, false, transformed)
    }, () => {})
  )

  // ─── QuickBoard: AI ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_AI_CHECK_ACCESS,
    async (): Promise<{ allowed: boolean }> => {
      return checkAiAccess()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_AI_TRANSFORM,
    async (_event, type: string, text: string, targetLang?: string) => {
      return aiTransform(type, text, targetLang)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_AI_ONBOARD,
    async (_event, answers: { role: string; apps: string[]; copyPatterns: string[]; repetitiveText: string }) => {
      return aiOnboard(answers)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_ONBOARDING_APPLY_CONFIG,
    async (_event, config: {
      tags?: string[]
      pinnedTemplates?: Array<{ text: string; label: string }>
      workflows?: Array<{ name: string; description: string; items: Array<{ label: string; text: string }> }>
      formProfiles?: Array<{ name: string; fields: FormField[] }>
    }) => {
      const clipService = getClipboardService()

      // Create tags
      if (config.tags) {
        for (const tag of config.tags) {
          manageTags('create', { name: tag })
        }
      }

      // Pin templates directly in history (writeText does not create entries)
      if (config.pinnedTemplates) {
        for (const tmpl of config.pinnedTemplates) {
          clipService.addPinnedTextItem(tmpl.text)
        }
      }

      // Create workflows
      if (config.workflows && config.workflows.length > 0) {
        saveBulkWorkflows(config.workflows)
      }

      // Create form profiles
      if (config.formProfiles && config.formProfiles.length > 0) {
        saveBulkFormProfiles(config.formProfiles)
      }

      // Mark onboarding complete
      setConfig('quickboard' as ToolId, 'ai_onboarding_complete', true)

      return { ok: true }
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_AI_SUGGEST,
    async () => {
      return getSuggestions()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_AI_DISMISS_SUGGESTION,
    (_event, suggestionId: string) => {
      dismissSuggestion(suggestionId)
    }
  )

  // ─── QuickBoard: Workflows ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_WORKFLOWS,
    () => {
      return getWorkflows()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SAVE_WORKFLOW,
    (_event, workflow: {
      id?: string
      name: string
      description: string
      items: Array<{ label: string; text: string }>
      isAiGenerated?: boolean
    }) => {
      return saveWorkflow({ ...workflow, isAiGenerated: workflow.isAiGenerated ?? false })
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_DELETE_WORKFLOW,
    (_event, workflowId: string) => {
      return deleteWorkflow(workflowId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_START_WORKFLOW,
    (_event, workflowId: string) => {
      return startWorkflow(workflowId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_WORKFLOW_PASTE_NEXT,
    () => {
      return guardedWorkflowPasteNext()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_CANCEL_WORKFLOW,
    () => {
      cancelWorkflow()
    }
  )

  // ─── QuickBoard: Form Fill ──────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_GET_FORM_PROFILES,
    () => {
      return getFormProfiles()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_SAVE_FORM_PROFILE,
    (_event, profile: { id?: string; name: string; fields: FormField[]; isAiGenerated?: boolean }) => {
      return saveFormProfile({ ...profile, isAiGenerated: profile.isAiGenerated ?? false })
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_DELETE_FORM_PROFILE,
    (_event, profileId: string) => {
      return deleteFormProfile(profileId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_START_FORM_FILL,
    (_event, profileId: string) => {
      return startFormFill(profileId)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_FORM_PASTE_NEXT,
    () => {
      return guardedFormPasteNext()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_CANCEL_FORM_FILL,
    () => {
      cancelFormFill()
    }
  )

  // v2 quickboard: one status for the panel's "Pasting 2 of 3" banner (no input)
  ipcMain.handle(IPC_INVOKE.CLIPBOARD_PASTE_STATUS, async () => {
    const { getWorkflowStatus } = await import('./services/clipboard-workflows')
    const { getFormFillStatus } = await import('./services/clipboard-forms')
    const wf = getWorkflowStatus()
    if (wf.active) return { kind: 'workflow' as const, ...wf }
    const ff = getFormFillStatus()
    if (ff.active) return { kind: 'form' as const, ...ff }
    return { kind: 'queue' as const, label: '', ...getQueueStatus() }
  })

  // ─── QuickBoard: OCR ───────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.CLIPBOARD_RUN_OCR,
    async (_event, itemId: string): Promise<ClipboardItem[]> => {
      const clipService = getClipboardService()
      const history = clipService.getHistory()
      const item = history.find((h: ClipboardItem) => h.id === itemId)
      if (!item || item.type !== 'image' || !item.imagePath) return history
      const ocrText = await runOcr(item.imagePath)
      if (ocrText) {
        return clipService.setOcrText(itemId, ocrText)
      }
      return clipService.getHistory()
    }
  )

  // ─── Calendar — iCal feed (shared by ScreenSlap + MeetReady) ───────────────

  ipcMain.handle(
    IPC_INVOKE.CALENDAR_GET_EVENTS,
    (): CalendarEvent[] => {
      return getCalendarService().getEvents()
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
    (): Promise<void> => {
      return getScreenSlapService().start()
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
    (): Promise<void> => {
      return getScreenSlapService().testAlert()
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
    (): Promise<TimerState> => {
      // Start also resumes a paused session
      const lf = getLiquidFocusService()
      return withToolAccess(checkAccess, ToolId.LiquidFocus, () => lf.start(), () => lf.getTimerState())
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
      const lf = getLiquidFocusService()
      lf.recordInterruption()
      const cfg = getConfig(ToolId.LiquidFocus) as LiquidFocusConfig
      if ((cfg.focus_away_action ?? 'reset') === 'reset' && lf.isFocusRunning()) {
        // The reset itself carries the notice (TimerState.awayReset), so a mini that
        // is created or still loading reads it with its first state. The panel gets a toast.
        const mini = getToolWindow(SystemWindowId.LiquidFocusMini)
        lf.resetFocusAfterAway()
        const panelWin = getPanel()
        if (panelWin && !panelWin.webContents.isLoading()) panelWin.webContents.send(IPC_SEND.LIQUIDFOCUS_AWAY_RESET)
        // Keep (or put) the mini on screen with the notice, unless the panel shows Liquid Focus
        if (!(isPanelVisible() && visiblePanelTool() === ToolId.LiquidFocus)) {
          layoutMini(mini ?? createToolWindow(SystemWindowId.LiquidFocusMini), true)
        }
      }
    }
  )

  // v2: forward the panel's detector state to the mini timer (eye icon)
  const DETECTOR_STATES = new Set(['off', 'loading', 'focused', 'absent', 'away', 'no-camera', 'error'])
  ipcMain.handle(IPC_INVOKE.LIQUIDFOCUS_DETECTOR_STATUS, (_event, status: unknown): void => {
    if (typeof status !== 'string' || !DETECTOR_STATES.has(status)) return
    const mini = getToolWindow(SystemWindowId.LiquidFocusMini)
    if (mini && !mini.isDestroyed()) mini.webContents.send(IPC_SEND.LIQUIDFOCUS_DETECTOR, status)
  })

  // ─── SoundSplit ──────────────────────────────────────────────────────────
  // Windows-only (PowerShell/WASAPI sidecar); other platforms get inert results
  const soundSplitAvailable = isToolSupportedOn(ToolId.SoundSplit, process.platform)

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_GET_SESSIONS,
    (): AudioSession[] => {
      if (!soundSplitAvailable) return []
      return getSoundSplitBridge().getSessions()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_VOLUME,
    (_event, pid: number, volume: number): boolean => {
      if (!soundSplitAvailable) return false
      return getSoundSplitBridge().setVolume(pid, volume)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_MUTE,
    (_event, pid: number, muted: boolean): boolean => {
      if (!soundSplitAvailable) return false
      return getSoundSplitBridge().setMute(pid, muted)
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_GET_MASTER,
    (): MasterAudio => {
      if (!soundSplitAvailable) return { volume: 0, peak: 0 }
      return getSoundSplitBridge().getMaster()
    }
  )

  ipcMain.handle(
    IPC_INVOKE.SOUNDSPLIT_SET_MASTER,
    (_event, volume: number): boolean => {
      if (!soundSplitAvailable) return false
      return getSoundSplitBridge().setMaster(volume)
    }
  )

  // ─── Todoist (off in v2: TODOIST_ENABLED) ────────────────────────────────

  if (TODOIST_ENABLED) {
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
  }

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

  ipcMain.handle(
    IPC_INVOKE.LIQUIDFOCUS_SET_MINI,
    (_event, payload: { open: boolean; card?: boolean }): void => {
      if (!payload?.open) {
        closeToolWindow(SystemWindowId.LiquidFocusMini)
        return
      }
      const win = getToolWindow(SystemWindowId.LiquidFocusMini) ?? createToolWindow(SystemWindowId.LiquidFocusMini)
      layoutMini(win, !!payload.card)
    }
  )

  // v2 mini timer: the renderer drags the window (so a plain click can still open the panel)
  ipcMain.handle(IPC_INVOKE.LIQUIDFOCUS_MINI_MOVE, (event, p: { x: number; y: number; done?: boolean }): void => {
    const win = getToolWindow(SystemWindowId.LiquidFocusMini)
    if (!win || event.sender !== win.webContents) return
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) return
    moveMini(win, Math.round(p.x), Math.round(p.y), !!p.done)
  })

  ipcMain.handle(IPC_INVOKE.LIQUIDFOCUS_DISMISS_AWAY, (): TimerState => getLiquidFocusService().dismissAwayNotice())

  // v2 liquidfocus: restart the current phase (no input)
  ipcMain.handle(IPC_INVOKE.LIQUIDFOCUS_RESTART_PHASE, (): Promise<TimerState> => {
    const lf = getLiquidFocusService()
    return withToolAccess(checkAccess, ToolId.LiquidFocus, () => lf.restartPhase(), () => lf.getTimerState())
  })

  // ─── One-app panel (v2) ───────────────────────────────────────────────────

  ipcMain.handle(IPC_INVOKE.PANEL_RESIZE, (_event, h: number): void => {
    if (typeof h === 'number') resizePanel(h)
  })
  ipcMain.handle(IPC_INVOKE.PANEL_HIDE, (): void => hidePanel())
  ipcMain.handle(IPC_INVOKE.PANEL_READY, (event): string | null => panelRendererReady(event.sender))
  ipcMain.handle(IPC_INVOKE.PANEL_ROUTE, (_event, route: unknown): void => {
    if (typeof route === 'string' && /^[a-z0-9/_:.-]{1,120}$/i.test(route)) setPanelRoute(route)
  })
  ipcMain.handle(IPC_INVOKE.PANEL_SHOW, (_event, route?: string): void => {
    showPanel(typeof route === 'string' && /^[a-z0-9/_-]{1,80}$/.test(route) ? route : undefined)
  })
  ipcMain.handle(IPC_INVOKE.APP_QUIT, (): void => app.quit())
  ipcMain.handle(
    IPC_INVOKE.APP_GET_INFO,
    (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      translated: app.runningUnderARM64Translation,
      isDev: is.dev
    })
  )
  ipcMain.handle(IPC_INVOKE.APP_CHECK_UPDATES, async (): Promise<void> => {
    await checkForUpdates(false)
  })
  ipcMain.handle(IPC_INVOKE.APP_CHECK_ACCESSIBILITY, (): boolean => checkAccessibility())
  ipcMain.handle(IPC_INVOKE.APP_OPEN_ACCESSIBILITY, (): void => {
    hidePanel()
    requestAccessibility()
    watchForFix('accessibility', () => showPanel('app/setup'))
  })
  const isPermission = (k: unknown): k is 'accessibility' | 'microphone' | 'camera' => k === 'accessibility' || k === 'microphone' || k === 'camera'
  ipcMain.handle(IPC_INVOKE.APP_PERMISSION_STATUS, (_e, kind: unknown) => (isPermission(kind) ? permissionStatus(kind) : null))
  ipcMain.handle(IPC_INVOKE.APP_OPEN_PERMISSION, (_e, kind: unknown): void => {
    if (!isPermission(kind)) return
    hidePanel()
    openPermissionPane(kind)
    // The moment it works, open the panel where the customer was, now saying "All set"
    watchForFix(kind, () => showPanel())
  })
  ipcMain.handle(IPC_INVOKE.APP_RESTART, (): void => {
    app.relaunch()
    app.quit()
  })
  ipcMain.handle(IPC_INVOKE.APP_SETUP_INFO, () => ({
    location: appLocation(),
    permissions: (['accessibility', 'microphone', 'camera'] as const).map((k) => permissionStatus(k))
  }))
  ipcMain.handle(IPC_INVOKE.APP_MOVE_TO_APPLICATIONS, (): boolean => moveToApplications())
  ipcMain.handle(IPC_INVOKE.APP_UPDATE_STATUS, () => getUpdateProgress())
  ipcMain.handle(IPC_INVOKE.APP_GET_ICON, async (_event, q: AppIconQuery): Promise<string | null> => {
    if (!q || typeof q !== 'object') return null
    const clean: AppIconQuery = {}
    if (typeof q.bundleId === 'string' && q.bundleId.length < 200) clean.bundleId = q.bundleId
    if (typeof q.name === 'string' && q.name.length < 120) clean.name = q.name
    if (typeof q.url === 'string' && q.url.length < 2000) clean.url = q.url
    if (typeof q.path === 'string' && q.path.endsWith('.app') && !q.path.includes('..')) clean.path = q.path
    return getAppIcon(clean)
  })

  // ─── Window Management (open tool from Dashboard) ─────────────────────────

  ipcMain.handle(
    IPC_INVOKE.WINDOW_OPEN,
    async (_event, payload: { toolId: string }): Promise<void> => {
      await openToolWithAccessCheck(payload.toolId as WindowId)
    }
  )

  // ─── Hotkeys ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.HOTKEY_GET_REGISTERED,
    (): Array<{ accelerator: string; label: string }> => {
      return getRegisteredHotkeys()
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

  // ─── Auto Start ──────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_INVOKE.APP_GET_AUTO_START,
    (): boolean => {
      return app.getLoginItemSettings().openAtLogin
    }
  )

  ipcMain.handle(
    IPC_INVOKE.APP_SET_AUTO_START,
    (_event, enabled: boolean): boolean => {
      app.setLoginItemSettings({ openAtLogin: enabled })
      return app.getLoginItemSettings().openAtLogin
    }
  )

  console.log('[PeakFlow] IPC handlers registered')
}

/** The mini timer is a 220×64 pill; the break prompt grows it into a card in the same corner. */
