/**
 * Starting an npm-installed CLI on Windows. npm installs `codex.cmd` /
 * `claude.cmd` shims, and a .cmd file only runs through cmd.exe, which
 * re-reads the whole command line: a user folder with a space
 * (C:\Users\John Smith) splits the path, and `>` `|` `&` or a line break in an
 * argument (Claude's system prompt) are taken as cmd.exe syntax.
 *
 * So we read the shim, find the script it starts, and run that script with
 * node.exe directly, with no shell. Only if the shim isn't one we recognise do
 * we go through cmd.exe, with every part quoted and escaped (the same rules as
 * the cross-spawn package; line breaks become spaces because cmd.exe can't
 * pass them). No Electron imports, so this can be checked from Node.
 */

import { win32 } from 'path'

const { dirname, isAbsolute, join, relative, resolve } = win32

export interface WinCommand {
  command: string
  args: string[]
  /** Pass args to CreateProcess as written (already quoted for cmd.exe) */
  verbatim: boolean
}

export interface WinDeps {
  readFile: (p: string) => string
  exists: (p: string) => boolean
  /** Folders to look in for node.exe when the shim has none beside it */
  pathDirs: string[]
  comspec?: string
}

/** The target an npm (cmd-shim) .cmd file starts: `"%dp0%\node_modules\...\cli.js" %*` */
export function shimTarget(shim: string, body: string, exists: (p: string) => boolean): string | null {
  const m = /"%dp0%\\([^"%]+?\.(?:js|mjs|cjs|exe))"\s+%\*/i.exec(body)
  if (!m) return null
  const dir = dirname(shim)
  const target = resolve(dir, m[1])
  const rel = relative(dir, target)
  // Stay inside the shim's own folder
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return exists(target) ? target : null
}

const META = /([()\][%!^"`<>&|;, *?])/g

function escapeArg(arg: string, double: boolean): string {
  let a = arg.replace(/\r?\n/g, ' ')
  // Backslashes before a quote, and at the end, are doubled; quotes are escaped
  a = a.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1')
  a = `"${a}"`.replace(META, '^$1')
  return double ? a.replace(META, '^$1') : a
}

/** cmd.exe line for a .cmd file and its arguments, every part escaped. */
export function cmdLine(bin: string, args: string[], comspec = 'cmd.exe'): WinCommand {
  // npm .cmd shims hand %* on to node, which parses the line a second time
  const double = /\.cmd$/i.test(bin)
  const line = [bin.replace(META, '^$1'), ...args.map((a) => escapeArg(a, double))].join(' ')
  return { command: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/** How to start `bin args` on Windows without cmd.exe mangling anything. */
export function winCommand(bin: string, args: string[], deps: WinDeps): WinCommand {
  if (!/\.(cmd|bat)$/i.test(bin)) return { command: bin, args, verbatim: false }
  let target: string | null = null
  try {
    target = shimTarget(bin, deps.readFile(bin), deps.exists)
  } catch {
    target = null
  }
  if (target && /\.exe$/i.test(target)) return { command: target, args, verbatim: false }
  if (target) {
    const node = [dirname(bin), ...deps.pathDirs].map((d) => join(d, 'node.exe')).find((p) => deps.exists(p))
    if (node) return { command: node, args: [target, ...args], verbatim: false }
  }
  return cmdLine(bin, args, deps.comspec)
}
