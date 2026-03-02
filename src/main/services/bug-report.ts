/**
 * Bug report collector and delivery.
 *
 * Gathers system info, tool configs, recent logs, and recent errors
 * into a diagnostic report. Delivers via email (mailto:), clipboard,
 * or by revealing the log file in Explorer.
 */

import { app, clipboard, shell, dialog } from 'electron'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { getLogPath, getRecentLogs, getRecentErrors } from './logger'
import { getConfig } from './config-store'
import { isToolInstalled, getTrialDaysRemaining } from '../security/trial'
import { checkAccess } from '../security/access-check'

// ─── Report Generation ──────────────────────────────────────────────────────

/**
 * Generate a full diagnostic report.
 * @param toolId - Optional tool context (which tool the user was using when reporting)
 */
export async function generateReport(toolId?: string): Promise<string> {
  const sections: string[] = []

  // Header
  sections.push('=== PeakFlow Bug Report ===')
  sections.push(`Generated: ${new Date().toISOString()}`)
  if (toolId) sections.push(`Reported from: ${toolId}`)
  sections.push('')

  // App info
  sections.push('--- App Info ---')
  sections.push(`Version: ${app.getVersion()}`)
  sections.push(`Electron: ${process.versions.electron}`)
  sections.push(`Chrome: ${process.versions.chrome}`)
  sections.push(`Node: ${process.versions.node}`)
  sections.push(`Platform: ${process.platform} ${process.arch}`)
  sections.push(`OS: ${require('os').release()}`)
  sections.push(`userData: ${app.getPath('userData')}`)
  sections.push('')

  // License / trial state
  sections.push('--- License & Trial ---')
  try {
    const access = await checkAccess()
    sections.push(`Global access: ${access.allowed ? 'allowed' : 'blocked'} — ${access.message}`)
    sections.push(`Licensed: ${access.isLicensed}`)
    sections.push(`Trial days remaining: ${getTrialDaysRemaining()}`)
  } catch {
    sections.push('(unable to read license state)')
  }
  sections.push('')

  // Installed tools + configs
  sections.push('--- Installed Tools ---')
  for (const id of Object.values(ToolId)) {
    const installed = isToolInstalled(id)
    if (!installed) continue
    const name = TOOL_DISPLAY_NAMES[id as ToolId] ?? id
    let configSummary = ''
    try {
      const cfg = getConfig(id as ToolId)
      configSummary = JSON.stringify(cfg)
    } catch {
      configSummary = '(no config)'
    }
    sections.push(`  ${name}: installed | config=${configSummary}`)
  }
  sections.push('')

  // Recent errors
  const errors = getRecentErrors()
  sections.push(`--- Recent Errors (${errors.length}) ---`)
  if (errors.length > 0) {
    sections.push(errors.join(''))
  } else {
    sections.push('(none)')
  }
  sections.push('')

  // Recent logs
  sections.push('--- Recent Logs (last 200 lines) ---')
  const logs = await getRecentLogs(200)
  sections.push(logs)

  return sections.join('\n')
}

// ─── Delivery Methods ───────────────────────────────────────────────────────

/**
 * Copy the full diagnostic report to clipboard and show a native dialog
 * with instructions to email it.
 */
export async function sendViaEmail(toolId?: string): Promise<void> {
  const report = await generateReport(toolId)
  clipboard.writeText(report)

  const logPath = getLogPath()
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Bug Report Copied',
    message: 'Your bug report has been copied to the clipboard.',
    detail: `Email it to: contact@getpeakflow.pro\n\nYou can also attach your log file:\n${logPath}`,
    buttons: ['OK', 'Show Log File'],
    defaultId: 0,
    noLink: true
  })

  if (result.response === 1) {
    shell.showItemInFolder(logPath)
  }
}

/**
 * Copy the full diagnostic report to clipboard.
 */
export async function copyToClipboard(toolId?: string): Promise<void> {
  const report = await generateReport(toolId)
  clipboard.writeText(report)
}

/**
 * Open the log file location in Explorer.
 */
export function revealLogFile(): void {
  const path = getLogPath()
  if (path) {
    shell.showItemInFolder(path)
  }
}
