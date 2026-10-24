/**
 * Development-only screenshot runner for the v2 UI.
 *
 *   PEAKFLOW_SHOTS_DIR=/out PEAKFLOW_SHOTS_PLAN=/plan.json npm run dev:v2
 *
 * The plan is a JSON array of steps:
 *   { "name": "01-focusdim", "route": "focusdim" }      panel on a route
 *   { "eval": "window.peakflow.invoke('tool:install','focusdim')" }  run JS in the panel
 *   { "name": "10-mini", "mini": true, "card": false }   the Liquid Focus mini timer
 *   { "name": "20-alert", "alert": true }                ScreenSlap test alert
 *   { "wait": 1500 }
 *   { "permission": { "accessibility": false } }        pretend a permission is off (true: on, null: real)
 * Each named step saves <name>.png (window contents) and <name>-screen.png
 * (the real screen around the window, with the macOS shadow). Never runs in
 * packaged builds.
 */

import { app, BrowserWindow, webContents } from 'electron'
import { execFile } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { SystemWindowId } from '@shared/tool-ids'
import { getPanel, showPanel, hidePanel } from './panel'
import { createToolWindow, getToolWindow, closeToolWindow } from './windows'
import { setDevPermission } from './services/permissions-darwin'
import type { MacPermission } from '@shared/mac-permissions'

interface Step {
  name?: string
  route?: string
  eval?: string
  /** JS run in the panel after navigating to `route`, before the capture (e.g. open the switcher) */
  then?: string
  mini?: boolean
  card?: boolean
  alert?: boolean
  /** With alert: wait for a real calendar alert instead of sending a test one */
  real?: boolean
  wait?: number
  /** Margin (px) of real screen to include around the window in -screen.png */
  margin?: number
  /** Mouse events sent into the open mini timer (window coordinates); logs its bounds and the panel after */
  miniInput?: Array<{ type: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; button?: 'left' | 'right' }>
  /** Log the mini timer's bounds */
  miniBounds?: boolean
  /** Pretend permissions are on or off (null: the real answer) */
  permission?: Partial<Record<MacPermission, boolean | null>>
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function screenGrab(file: string, b: Electron.Rectangle, margin: number): Promise<void> {
  const r = `${Math.max(0, b.x - margin)},${Math.max(0, b.y - margin)},${b.width + margin * 2},${b.height + margin * 2}`
  return new Promise((resolve) => execFile('screencapture', ['-x', '-R', r, file], () => resolve()))
}

async function capture(win: BrowserWindow, dir: string, name: string, margin: number): Promise<void> {
  const img = await win.webContents.capturePage()
  writeFileSync(join(dir, `${name}.png`), img.toPNG())
  if (process.platform === 'darwin') await screenGrab(join(dir, `${name}-screen.png`), win.getBounds(), margin)
  console.log(`[Shots] ${name}`)
}

export async function runDevShots(): Promise<void> {
  const dir = process.env['PEAKFLOW_SHOTS_DIR']
  const planPath = process.env['PEAKFLOW_SHOTS_PLAN']
  if (!is.dev || !dir || !planPath) return
  mkdirSync(dir, { recursive: true })
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Step[]
  // Copy every window's console warnings and errors into the main log
  const watchConsole = (wc: Electron.WebContents): void => {
    // Electron 33 passes (event, level, message, line, sourceId); level 2 = warning, 3 = error
    wc.on('console-message', (_e, level: number, message: string, line: number, sourceId: string) => {
      if (level < 2) return
      const where = wc.isDestroyed() ? '' : wc.getURL().startsWith('data:') ? 'overlay' : wc.getURL().replace(/^.*\?/, '?')
      console.log(`[Shots] console ${level === 3 ? 'error' : 'warn'} ${where} ${message} (${sourceId.replace(/^.*\//, '')}:${line})`)
    })
  }
  webContents.getAllWebContents().forEach(watchConsole)
  app.on('web-contents-created', (_e, wc) => watchConsole(wc))
  await sleep(2500)
  for (const step of plan) {
    try {
      if (step.wait) await sleep(step.wait)
      if (step.permission) {
        for (const [k, v] of Object.entries(step.permission)) setDevPermission(k as MacPermission, v ?? null)
      }
      if (step.eval) {
        showPanel()
        const out = await getPanel()?.webContents.executeJavaScript(step.eval, true)
        if (out !== undefined) console.log('[Shots] eval →', JSON.stringify(out))
        await sleep(400)
      }
      if (step.route) {
        closeToolWindow(SystemWindowId.LiquidFocusMini)
        showPanel(step.route)
        await sleep(900)
        if (step.then) {
          await getPanel()?.webContents.executeJavaScript(step.then, true)
          await sleep(500)
        }
        const p = getPanel()
        if (p && step.name) await capture(p, dir, step.name, step.margin ?? 40)
      }
      if (step.mini) {
        hidePanel()
        const win = getToolWindow(SystemWindowId.LiquidFocusMini) ?? createToolWindow(SystemWindowId.LiquidFocusMini)
        await sleep(300)
        await getPanel()?.webContents.executeJavaScript(`window.peakflow.invoke('liquidfocus:set-mini', { open: true, card: ${!!step.card} })`, true)
        await sleep(1200)
        if (step.name) await capture(win, dir, step.name, step.margin ?? 40)
        // The real window as macOS draws it (rounded corners, transparent outside), nothing behind it
        const id = /^window:(\d+):/.exec(win.getMediaSourceId())?.[1]
        if (step.name && id && process.platform === 'darwin') {
          await new Promise<void>((r) => execFile('screencapture', ['-x', '-o', `-l${id}`, join(dir, `${step.name}-window.png`)], () => r()))
        }
      }
      if (step.miniInput) {
        const win = getToolWindow(SystemWindowId.LiquidFocusMini)
        if (!win) console.warn('[Shots] miniInput: no mini open')
        else {
          const before = win.getBounds()
          for (const ev of step.miniInput) {
            // Real drags move the window under a fixed pointer: keep the screen point (globalX/Y) honest
            const b = win.getBounds()
            const gx = before.x + ev.x
            const gy = before.y + ev.y
            win.webContents.sendInputEvent({ type: ev.type, x: gx - b.x, y: gy - b.y, globalX: gx, globalY: gy, button: ev.button ?? 'left', clickCount: 1 })
            await sleep(120)
          }
          await sleep(600)
          const open = getToolWindow(SystemWindowId.LiquidFocusMini)
          console.log(`[Shots] miniInput ${JSON.stringify({ before, after: open?.getBounds() ?? null, miniOpen: !!open, panelVisible: !!getPanel()?.isVisible() })}`)
        }
      }
      if (step.miniBounds) {
        const win = getToolWindow(SystemWindowId.LiquidFocusMini)
        console.log(`[Shots] miniBounds ${JSON.stringify(win ? win.getBounds() : null)}`)
      }
      if (step.alert) {
        hidePanel()
        closeToolWindow(SystemWindowId.LiquidFocusMini)
        // Alert windows are created by the ScreenSlap service, not the tool-window registry
        const findAlert = (): BrowserWindow | undefined =>
          BrowserWindow.getAllWindows().find(
            (w) => !w.isDestroyed() && w.webContents.getURL().includes(`toolId=${SystemWindowId.ScreenSlapAlert}`)
          )
        if (step.real) {
          // Wait (up to 2 min) for a calendar alert, capture it, and leave it for auto-dismiss
          for (let i = 0; i < 240 && !findAlert(); i++) await sleep(500)
          await sleep(2500)
          const w = findAlert()
          if (w && step.name) {
            writeFileSync(join(dir, `${step.name}.png`), (await w.webContents.capturePage()).toPNG())
            console.log(`[Shots] ${step.name}`)
          } else console.warn('[Shots] no calendar alert appeared')
          continue
        }
        await getPanel()?.webContents.executeJavaScript(`window.peakflow.invoke('screenslap:test-alert')`, true)
        await sleep(3500)
        const win = findAlert()
        if (win && step.name) {
          const img = await win.webContents.capturePage()
          writeFileSync(join(dir, `${step.name}.png`), img.toPNG())
          console.log(`[Shots] ${step.name}`)
        } else console.warn('[Shots] no alert window found')
        win?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        await sleep(1200)
        console.log(`[Shots] alert closed by a key press: ${!findAlert()}`)
        findAlert()?.close()
      }
    } catch (err) {
      console.warn('[Shots] step failed', step, err)
    }
  }
  hidePanel()
  console.log('[Shots] done')
  if (process.env['PEAKFLOW_SHOTS_QUIT'] === '1') app.quit()
}
