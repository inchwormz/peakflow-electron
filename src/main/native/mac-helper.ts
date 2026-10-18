/**
 * Location and one-shot invocation of the PeakFlowHelper Swift binary (macOS).
 *
 * The persistent helper process (active-window-darwin.ts) serves the 60fps
 * window polling. Paste and OCR run as separate one-shot processes so a slow
 * OCR never stalls window tracking.
 */

import { execFile, execFileSync } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

export function getMacHelperPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'peakflow-helper')
  }
  // Dev mode: use the repo-level resources directory, not the compiled out/ tree.
  return join(app.getAppPath(), 'resources', 'darwin', 'peakflow-helper')
}

/** Run one helper command synchronously and parse its JSON reply (null on failure). */
export function runMacHelperSync(args: string[], timeoutMs = 2000): Record<string, unknown> | null {
  try {
    const out = execFileSync(getMacHelperPath(), args, {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString().trim()
    return JSON.parse(out) as Record<string, unknown>
  } catch (error) {
    console.error(`[MacHelper] ${args[0]} failed:`, error instanceof Error ? error.message : error)
    return null
  }
}

/** Run one helper command asynchronously and parse its JSON reply (null on failure). */
export function runMacHelper(args: string[], timeoutMs = 15000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    execFile(getMacHelperPath(), args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        console.warn(`[MacHelper] ${args[0]} failed:`, error.message)
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()) as Record<string, unknown>)
      } catch {
        resolve(null)
      }
    })
  })
}
