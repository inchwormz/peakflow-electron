/**
 * System commands: sleep, lock, screen saver, empty the Bin, eject disks,
 * restart, shut down, log out, and the shared Guarana Keep Awake toggle.
 */

import { execFile } from 'child_process'
import { getGuaranaState, startGuarana, stopGuarana } from '../services/guarana'
import { readdir, realpath } from 'fs/promises'
import type { LauncherItem, LauncherRunResult } from '@shared/launcher/types'
import { runMacHelper } from '../native/mac-helper'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

export function isKeepAwake(): boolean {
  return getGuaranaState().active
}

export function setKeepAwake(on: boolean): boolean {
  const state = getGuaranaState()
  if (on && !state.active) startGuarana(state.defaultMinutes)
  if (!on) stopGuarana()
  return isKeepAwake()
}

function exec(cmd: string, args: string[], timeout = 15000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}` }))
  })
}

function ps(script: string): Promise<{ ok: boolean; out: string }> {
  const encoded = Buffer.from("$ProgressPreference = 'SilentlyContinue'\n" + script, 'utf16le').toString('base64')
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', encoded])
}

function osa(script: string): Promise<{ ok: boolean; out: string }> {
  return exec('osascript', ['-e', script])
}

/** Volumes that can be ejected (not the startup disk). */
async function macVolumes(): Promise<string[]> {
  try {
    const names = await readdir('/Volumes')
    const out: string[] = []
    for (const n of names) {
      const p = `/Volumes/${n}`
      if ((await realpath(p).catch(() => p)) === '/') continue
      out.push(p)
    }
    return out
  } catch {
    return []
  }
}

interface SysCommand {
  id: string
  title: string
  keywords: string[]
  glyph: LauncherItem['glyph']
  confirm?: string
  run: () => Promise<LauncherRunResult>
}

const ok = (message?: string): LauncherRunResult => ({ ok: true, message })
const fail = (message: string): LauncherRunResult => ({ ok: false, message, keepOpen: true })

const COMMANDS: SysCommand[] = [
  {
    id: 'cmd:keep-awake',
    title: 'Keep Awake',
    keywords: ['caffeinate', 'stay awake', 'no sleep', 'amphetamine', 'prevent sleep'],
    glyph: 'coffee',
    run: () => {
      const on = setKeepAwake(!isKeepAwake())
      return Promise.resolve({ ok: true, keepOpen: true, message: on ? 'Keep Awake is on' : 'Keep Awake is off' })
    }
  },
  {
    id: 'cmd:sleep',
    title: 'Sleep',
    keywords: ['suspend', 'sleep computer'],
    glyph: 'moon',
    run: () => {
      // Give the bar a moment to close first
      setTimeout(() => {
        if (isMac) void exec('pmset', ['sleepnow'])
        else if (isWin) void exec('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])
      }, 300)
      return Promise.resolve(ok())
    }
  },
  {
    id: 'cmd:lock',
    title: 'Lock Screen',
    keywords: ['lock', 'lock computer'],
    glyph: 'lock',
    run: async () => {
      if (isMac) {
        const r = await runMacHelper(['lock'], 3000)
        return r?.ok ? ok() : fail('Couldn’t lock the screen')
      }
      if (isWin) return (await exec('rundll32.exe', ['user32.dll,LockWorkStation'])).ok ? ok() : fail('Couldn’t lock the screen')
      return fail('Not available here')
    }
  },
  ...(isMac
    ? [{
        id: 'cmd:screensaver',
        title: 'Start Screen Saver',
        keywords: ['screensaver'],
        glyph: 'moon' as const,
        run: async () => ((await exec('open', ['-a', 'ScreenSaverEngine'])).ok ? ok() : fail('Couldn’t start the screen saver'))
      }]
    : []),
  {
    id: 'cmd:empty-trash',
    title: isMac ? 'Empty Bin' : 'Empty Recycle Bin',
    keywords: ['empty trash', 'trash', 'recycle bin', 'bin', 'delete'],
    glyph: 'trash',
    confirm: 'Empty the Bin? Everything in it is deleted for good.',
    run: async () => {
      if (isMac) {
        const r = await osa('tell application "Finder" to empty trash')
        if (r.ok) return ok('Bin emptied')
        return fail(/not allowed|-1743/i.test(r.out) ? 'PeakFlow needs permission to control Finder: allow it in System Settings › Privacy & Security › Automation' : 'Couldn’t empty the Bin')
      }
      if (isWin) return (await ps('Clear-RecycleBin -Force -ErrorAction Stop')).ok ? ok('Recycle Bin emptied') : fail('Couldn’t empty the Recycle Bin (it may already be empty)')
      return fail('Not available here')
    }
  },
  {
    id: 'cmd:eject',
    title: 'Eject All Disks',
    keywords: ['eject', 'unmount', 'usb', 'drive'],
    glyph: 'eject',
    run: async () => {
      if (isMac) {
        const vols = await macVolumes()
        if (!vols.length) return fail('No disks to eject')
        const results = await Promise.all(vols.map((v) => exec('diskutil', ['eject', v])))
        const failed = results.filter((r) => !r.ok).length
        return failed ? fail(`${failed} of ${vols.length} disks couldn’t be ejected (a file may be open)`) : ok(`Ejected ${vols.length} ${vols.length === 1 ? 'disk' : 'disks'}`)
      }
      if (isWin) {
        const r = await ps(`
$shell = New-Object -ComObject Shell.Application
$drives = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 }
$n = 0
foreach ($d in $drives) { $shell.Namespace(17).ParseName($d.DeviceID).InvokeVerb('Eject'); $n++ }
[Console]::Out.WriteLine($n)`)
        const n = parseInt(r.out.trim(), 10) || 0
        return n ? ok(`Ejecting ${n} ${n === 1 ? 'drive' : 'drives'}`) : fail('No removable drives to eject')
      }
      return fail('Not available here')
    }
  },
  {
    id: 'cmd:restart',
    title: 'Restart',
    keywords: ['reboot', 'restart computer'],
    glyph: 'restart',
    confirm: 'Restart now? Save your work first.',
    run: async () => {
      if (isMac) return (await osa('tell application "loginwindow" to «event aevtrrst»')).ok ? ok() : fail('Couldn’t restart')
      if (isWin) return (await exec('shutdown', ['/r', '/t', '0'])).ok ? ok() : fail('Couldn’t restart')
      return fail('Not available here')
    }
  },
  {
    id: 'cmd:shutdown',
    title: 'Shut Down',
    keywords: ['power off', 'turn off', 'shutdown'],
    glyph: 'power',
    confirm: 'Shut down now? Save your work first.',
    run: async () => {
      if (isMac) return (await osa('tell application "loginwindow" to «event aevtrsdn»')).ok ? ok() : fail('Couldn’t shut down')
      if (isWin) return (await exec('shutdown', ['/s', '/t', '0'])).ok ? ok() : fail('Couldn’t shut down')
      return fail('Not available here')
    }
  },
  {
    id: 'cmd:logout',
    title: isMac ? 'Log Out' : 'Sign Out',
    keywords: ['log out', 'sign out', 'logout', 'switch user'],
    glyph: 'logout',
    confirm: isMac ? 'Log out now? Save your work first.' : 'Sign out now? Save your work first.',
    run: async () => {
      if (isMac) return (await osa('tell application "loginwindow" to «event aevtrlgo»')).ok ? ok() : fail('Couldn’t log out')
      if (isWin) return (await exec('shutdown', ['/l'])).ok ? ok() : fail('Couldn’t sign out')
      return fail('Not available here')
    }
  }
]

export function systemItems(): LauncherItem[] {
  return COMMANDS.map((c) => ({
    id: c.id,
    kind: 'command' as const,
    title: c.id === 'cmd:keep-awake' ? `Keep Awake: turn ${isKeepAwake() ? 'off' : 'on'}` : c.title,
    subtitle: c.id === 'cmd:keep-awake' ? (isKeepAwake() ? 'On · Guarana' : 'Start Guarana with your saved settings') : 'System',
    keywords: c.keywords,
    glyph: c.glyph,
    confirm: c.confirm
  }))
}

export function runSystemCommand(id: string): Promise<LauncherRunResult> | null {
  const c = COMMANDS.find((x) => x.id === id)
  return c ? c.run() : null
}

export function stopKeepAwake(): void {
  setKeepAwake(false)
}
