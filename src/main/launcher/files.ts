/**
 * File search for the launcher.
 *   macOS: Spotlight (mdfind) in the home folder, names containing the words typed.
 *   Windows: the "Recent items" shortcuts plus Desktop, Documents and Downloads
 *            (top two levels), filtered by name. No indexer service needed.
 * Results are kept so the bar can open one by id (the renderer never sends a path).
 */

import { execFile, type ChildProcess } from 'child_process'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import type { LauncherItem } from '@shared/launcher/types'

const MAX = 12
const known = new Map<string, string>()
let running: ChildProcess | null = null

function item(path: string, isDir: boolean): LauncherItem {
  const id = `file:${path}`
  known.set(id, path)
  const home = homedir()
  const where = dirname(path).startsWith(home) ? '~' + dirname(path).slice(home.length) : dirname(path)
  return { id, kind: 'file', title: basename(path), subtitle: where, iconPath: path, glyph: isDir ? 'folder' : 'file' }
}

export function filePathFor(id: string): string | null {
  return known.get(id) ?? null
}

const SKIP = /\/(Library|node_modules|\.git|\.Trash|\.cache|\.npm|\.cargo|\.rustup|\.local|DerivedData|build|dist|out|\.next)\//

function mdfind(query: string): Promise<string[]> {
  return new Promise((resolve) => {
    running?.kill()
    // Every typed word must be in the name; quotes/backslashes removed so the query stays a query
    const words = query.replace(/["'\\*]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4)
    if (!words.length) return resolve([])
    const expr = words.map((w) => `kMDItemFSName == "*${w}*"cd`).join(' && ')
    const child = execFile('mdfind', ['-onlyin', homedir(), expr], { timeout: 1500, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      if (running === child) running = null
      resolve((stdout ?? '').split('\n').filter(Boolean))
    })
    running = child
  })
}

async function macSearch(query: string): Promise<LauncherItem[]> {
  const paths = (await mdfind(query)).filter((p) => !SKIP.test(p + '/') && !p.includes('.app/'))
  const q = query.toLowerCase()
  // Names that start with the query first, then the most recently changed
  const withTimes = await Promise.all(
    paths.slice(0, 300).map(async (p) => {
      try {
        const st = await stat(p)
        return { p, t: st.mtimeMs, dir: st.isDirectory() }
      } catch {
        return null
      }
    })
  )
  return withTimes
    .filter((x): x is { p: string; t: number; dir: boolean } => !!x && !x.p.endsWith('.app'))
    .sort((a, b) => Number(basename(b.p).toLowerCase().startsWith(q)) - Number(basename(a.p).toLowerCase().startsWith(q)) || b.t - a.t)
    .slice(0, MAX)
    .map((x) => item(x.p, x.dir))
}

let winIndex: { at: number; paths: Array<{ p: string; dir: boolean }> } | null = null

async function winPaths(): Promise<Array<{ p: string; dir: boolean }>> {
  if (winIndex && Date.now() - winIndex.at < 60_000) return winIndex.paths
  const home = homedir()
  const out: Array<{ p: string; dir: boolean }> = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'desktop.ini') continue
      const p = join(dir, e.name)
      out.push({ p, dir: e.isDirectory() })
      if (e.isDirectory() && depth > 0) await walk(p, depth - 1)
    }
  }
  const recent = join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Recent')
  await Promise.all([walk(recent, 0), ...['Desktop', 'Documents', 'Downloads'].map((d) => walk(join(home, d), 1))])
  winIndex = { at: Date.now(), paths: out }
  return out
}

async function winSearch(query: string): Promise<LauncherItem[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const seen = new Set<string>()
  const hits: LauncherItem[] = []
  for (const { p, dir } of await winPaths()) {
    // Recent items are .lnk shortcuts named after the file they point to
    const name = basename(p, extname(p) === '.lnk' ? '.lnk' : '').toLowerCase()
    if (!words.every((w) => name.includes(w)) || seen.has(name)) continue
    seen.add(name)
    hits.push(item(p, dir))
    if (hits.length >= MAX) break
  }
  return hits
}

export function searchFiles(query: string): Promise<LauncherItem[]> {
  if (query.trim().length < 2) return Promise.resolve([])
  if (process.platform === 'darwin') return macSearch(query.trim())
  if (process.platform === 'win32') return winSearch(query.trim())
  return Promise.resolve([])
}
