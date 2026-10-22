/**
 * Kill Process: the running apps with how much memory each uses (helpers
 * included), and quitting one (Enter) or force quitting it (⌘/Ctrl+Enter).
 */

import { execFile } from 'child_process'
import type { LauncherProcess } from '@shared/launcher/types'
import { runMacHelper } from '../native/mac-helper'

let lastList = new Map<number, LauncherProcess>()

function exec(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (_e, out) => resolve(out ?? ''))
  })
}

async function macList(): Promise<LauncherProcess[]> {
  const [appsRaw, ps] = await Promise.all([
    new Promise<unknown>((resolve) => {
      // running-apps prints a JSON array; runMacHelper parses it
      void runMacHelper(['running-apps'], 3000).then(resolve)
    }),
    exec('ps', ['-axo', 'pid=,ppid=,rss='])
  ])
  const apps = Array.isArray(appsRaw) ? (appsRaw as Array<{ pid: number; name: string; path: string }>) : []
  const children = new Map<number, number[]>()
  const rss = new Map<number, number>()
  for (const line of ps.split('\n')) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number)
    if (!pid) continue
    rss.set(pid, (kb || 0) * 1024)
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid)!.push(pid)
  }
  // An app's memory = its process plus everything it started (browser tabs, helpers)
  const total = (pid: number, depth = 0): number =>
    (rss.get(pid) ?? 0) + (depth < 6 ? (children.get(pid) ?? []).reduce((s, c) => s + total(c, depth + 1), 0) : 0)
  return apps.map((a) => ({ pid: a.pid, name: a.name, memory: total(a.pid), path: a.path || undefined }))
}

const WIN_LIST = `
$ErrorActionPreference = 'Stop'
$all = Get-Process
$byName = @{}
foreach ($p in $all) { $byName[$p.ProcessName] = ($byName[$p.ProcessName] + $p.WorkingSet64) }
$apps = $all | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne $PID }
$out = foreach ($p in $apps) {
  $path = ''
  try { $path = $p.Path } catch {}
  $name = $p.ProcessName
  try { if ($p.MainModule.FileVersionInfo.FileDescription) { $name = $p.MainModule.FileVersionInfo.FileDescription } } catch {}
  [pscustomobject]@{ pid = $p.Id; name = $name; memory = $byName[$p.ProcessName]; path = $path }
}
[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($out)))
`

async function winList(): Promise<LauncherProcess[]> {
  const encoded = Buffer.from(WIN_LIST, 'utf16le').toString('base64')
  const out = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', encoded], 8000)
  try {
    const list = JSON.parse(out.trim()) as Array<{ pid: number; name: string; memory: number; path: string }>
    return list.map((p) => ({ pid: p.pid, name: p.name, memory: p.memory || 0, path: p.path || undefined }))
  } catch {
    return []
  }
}

export async function listProcesses(): Promise<LauncherProcess[]> {
  const list = process.platform === 'darwin' ? await macList() : process.platform === 'win32' ? await winList() : []
  const own = process.pid
  const sorted = list.filter((p) => p.pid !== own).sort((a, b) => b.memory - a.memory)
  lastList = new Map(sorted.map((p) => [p.pid, p]))
  return sorted
}

/** Quit an app from the last list. Only PIDs the list showed can be quit. */
export async function quitProcess(pid: unknown, force: unknown): Promise<boolean> {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || !lastList.has(pid)) return false
  const hard = force === true
  if (process.platform === 'darwin') {
    const r = await runMacHelper([hard ? 'force-quit-app' : 'quit-app', String(pid)], 3000)
    return r?.ok === true
  }
  if (process.platform === 'win32') {
    const out = await exec('taskkill', hard ? ['/PID', String(pid), '/F'] : ['/PID', String(pid)])
    return /success/i.test(out)
  }
  return false
}
