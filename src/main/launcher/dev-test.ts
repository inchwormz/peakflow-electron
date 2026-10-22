/**
 * Development-only test driver for the launcher. Shows the bar WITHOUT taking
 * the keyboard (so nothing typed by a person at the computer is affected),
 * fills the search box and presses keys inside the page, and saves window
 * screenshots. Never runs in packaged builds.
 *
 *   PEAKFLOW_LAUNCHER_PLAN=/plan.json PEAKFLOW_LAUNCHER_SHOTS=/out npm run dev
 *
 * Plan: JSON array of steps, run in order:
 *   { "open": true }                       show the bar (inactive)
 *   { "query": "10 km to mi" }             set the search text
 *   { "key": "Enter", "mod": true }        press a key in the page (mod = ⌘ / Ctrl)
 *   { "waitFor": "js expression", "timeout": 20000 }
 *   { "wait": 500 }
 *   { "shot": "04-calculator" }            save <name>.png of the bar
 *   { "eval": "js" }                       run JS in the page; result logged
 *   { "hide": true }
 */

import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getLauncherWindow, showLauncher, hideLauncher } from './window'

interface Step {
  open?: boolean
  query?: string
  key?: string
  mod?: boolean
  waitFor?: string
  timeout?: number
  wait?: number
  shot?: string
  eval?: string
  hide?: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runLauncherDevTest(): Promise<void> {
  const planPath = process.env['PEAKFLOW_LAUNCHER_PLAN']
  const out = process.env['PEAKFLOW_LAUNCHER_SHOTS']
  if (!is.dev || app.isPackaged || !planPath || !out) return
  mkdirSync(out, { recursive: true })
  const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as Step[]
  await sleep(2500)
  const js = (code: string): Promise<unknown> => getLauncherWindow()!.webContents.executeJavaScript(code, true)
  const mac = process.platform === 'darwin'
  for (const s of plan) {
    try {
      if (s.open) {
        showLauncher({ at: Date.now(), inactive: true })
        await sleep(250)
      }
      if (s.query !== undefined) {
        await js(`(() => { const i = document.querySelector('.lc-input'); if (!i) return false;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(s.query)});
          i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
        await sleep(200)
      }
      if (s.key) {
        await js(`(() => { const t = document.querySelector('.lc-input') || document.querySelector('.lc-crumb') || document.querySelector('.pf.lc');
          t.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(s.key)}, bubbles: true, ${mac ? 'metaKey' : 'ctrlKey'}: ${!!s.mod} })); return true })()`)
        await sleep(150)
      }
      if (s.waitFor) {
        const end = Date.now() + (s.timeout ?? 15000)
        while (Date.now() < end && !(await js(`!!(${s.waitFor})`))) await sleep(150)
      }
      if (s.wait) await sleep(s.wait)
      if (s.eval) console.log(`[LauncherTest] ${s.eval.slice(0, 60)} → ${JSON.stringify(await js(s.eval)).slice(0, 400)}`)
      if (s.shot) {
        const img = await getLauncherWindow()!.webContents.capturePage()
        writeFileSync(join(out, `${s.shot}.png`), img.toPNG())
        console.log(`[LauncherTest] saved ${s.shot}.png`)
      }
      if (s.hide) hideLauncher()
    } catch (err) {
      console.warn('[LauncherTest] step failed:', JSON.stringify(s), err)
    }
  }
  console.log('[LauncherTest] plan finished')
}
