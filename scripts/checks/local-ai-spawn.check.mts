/**
 * Check: on Windows, an npm-installed Codex or Claude (.cmd shim) starts with
 * node.exe directly, with no cmd.exe, so a user folder with a space and
 * Claude's system prompt (with > | and line breaks) arrive intact. A shim we
 * don't recognise goes through cmd.exe with every part quoted and escaped.
 * Run: node scripts/checks/local-ai-spawn.check.mts
 */
import assert from 'node:assert/strict'
import { cmdLine, shimTarget, winCommand } from '../../src/main/services/local-ai-spawn.ts'

// What npm's cmd-shim writes for @openai/codex
const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`
const npm = 'C:\\Users\\John Smith\\AppData\\Roaming\\npm'
const shim = `${npm}\\codex.cmd`
const entry = `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`
const node = 'C:\\Program Files\\nodejs\\node.exe'
const files = new Set([shim, entry, node])
const deps = { readFile: (p: string) => (p === shim ? SHIM : ''), exists: (p: string) => files.has(p), pathDirs: ['C:\\Program Files\\nodejs'], comspec: 'C:\\Windows\\system32\\cmd.exe' }

const sys = 'Fix the text.\nReply with only <the text> | nothing & no "quotes" 100%'
const args = ['-p', '--tools', '', '--system-prompt', sys]

// Shim: node.exe + the script, args untouched, no shell
assert.equal(shimTarget(shim, SHIM, deps.exists), entry)
assert.deepEqual(winCommand(shim, args, deps), { command: node, args: [entry, ...args], verbatim: false })

// node.exe next to the shim wins
files.add(`${npm}\\node.exe`)
assert.equal(winCommand(shim, args, deps).command, `${npm}\\node.exe`)
files.delete(`${npm}\\node.exe`)

// A shim that points at a native program runs that program
const exeShim = `@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`
const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
files.add(exe)
assert.deepEqual(winCommand(`${npm}\\claude.cmd`, args, { ...deps, readFile: () => exeShim }), { command: exe, args, verbatim: false })

// .exe installs run as they are
assert.deepEqual(winCommand('C:\\Users\\John Smith\\.local\\bin\\claude.exe', args, deps), { command: 'C:\\Users\\John Smith\\.local\\bin\\claude.exe', args, verbatim: false })

// A target outside the shim's folder is not trusted
assert.equal(shimTarget(shim, '"%dp0%\\..\\..\\evil.js" %*', () => true), null)

// Unknown shim (or no node.exe): cmd.exe, everything quoted and escaped, never a bare > | & or line break
const fallback = winCommand(shim, args, { ...deps, readFile: () => '@echo off\r\nnode something %*' })
assert.equal(fallback.command, 'C:\\Windows\\system32\\cmd.exe')
assert.equal(fallback.verbatim, true)
assert.deepEqual(fallback.args.slice(0, 3), ['/d', '/s', '/c'])
const line = fallback.args[3]
assert.ok(!/\n/.test(line), 'line break reached cmd.exe')
assert.ok(line.includes('C:\\Users\\John^ Smith\\AppData\\Roaming\\npm\\codex.cmd'), line)
for (const ch of ['<', '>', '|', '&', '%']) {
  // every metacharacter in the line is escaped with ^
  for (let i = line.indexOf(ch); i >= 0; i = line.indexOf(ch, i + 1)) assert.equal(line[i - 1], '^', `unescaped ${ch} in ${line}`)
}
// Empty argument (--tools '') survives as an empty quoted string
assert.ok(cmdLine('x.cmd', ['']).args[3].endsWith(' ^^^"^^^""'), cmdLine('x.cmd', ['']).args[3])
console.log('local-ai-spawn: ok')
