/**
 * The launcher: a free Raycast-style command bar on ⌥Space (Alt+Space on
 * Windows). Search apps, files, settings and PeakFlow tools; calculator and
 * conversions; Kill Process; quick links and web search; system commands;
 * snippets that expand as you type; and AI through the person's own ChatGPT
 * or Claude (services/local-ai.ts), free, no PeakFlow account.
 *
 * Main owns every path, URL and command: the bar only sends item ids, so a
 * compromised page can't open arbitrary files or run commands.
 */

import { app, clipboard, globalShortcut, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { chmodSync, existsSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, normalize } from 'path'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type {
  AiAskPayload, AiChunk, AiProviderId, AiStatus, AiTextAction, LauncherItem, LauncherLink, LauncherRunOptions,
  LauncherRunResult, LauncherSettings, LauncherSnippet
} from '@shared/launcher/types'
import { launcherStore, DEFAULT_LAUNCHER_HOTKEY } from './store'
import { getApps, isIndexedApp, isIndexedStartApp, settingsItems, settingsUrl } from './apps'
import { searchFiles, filePathFor } from './files'
import { listProcesses, quitProcess } from './processes'
import { getRates } from './rates'
import { systemItems, runSystemCommand, isKeepAwake, stopKeepAwake } from './system'
import { toolItems, runToolCommand } from './tools'
import { windowItems, runWindowCommand } from './window-commands'
import { getSelectedText, pasteText } from './selection'
import { updateExpansion, retryExpansion, isExpansionActive, stopExpansion } from './expander'
import {
  initLauncherWindow, showLauncher, hideLauncher, toggleLauncher, resizeLauncher, sendToLauncher, holdLauncherOpen,
  refocusLauncher, stepAsideLauncher, setLauncherQuitting, getLauncherWindow, onLauncherHidden
} from './window'
import { getAppIcon } from '../services/app-icons'
import { runLauncherDevTest } from './dev-test'
import { initDictation, destroyDictation, runDictationDevTest, getLastDictation, pasteDictation, getKeptDictation, retryDictation } from '../dictation'
import { listAiProviders, getDefaultAiProvider, setDefaultAiProvider, runLocalAi, refreshAiProviders, aiSetupCommand, getAiTier, setAiTier } from '../services/local-ai'

const isMac = process.platform === 'darwin'

// ─── built-in links and web searches ─────────────────────────────────────────

const FOLDERS: Array<[string, string, string]> = [
  ['folder:home', 'Home folder', ''],
  ['folder:desktop', 'Desktop', 'Desktop'],
  ['folder:documents', 'Documents', 'Documents'],
  ['folder:downloads', 'Downloads', 'Downloads'],
  ...(isMac ? ([['folder:applications', 'Applications folder', '/Applications']] as Array<[string, string, string]>) : [])
]

const ENGINES: Array<{ id: string; name: string; prefix: string; url: string; keywords?: string[] }> = [
  { id: 'search:google', name: 'Google', prefix: 'g', url: 'https://www.google.com/search?q=%s' },
  { id: 'search:youtube', name: 'YouTube', prefix: 'yt', url: 'https://www.youtube.com/results?search_query=%s', keywords: ['video'] },
  { id: 'search:duckduckgo', name: 'DuckDuckGo', prefix: 'ddg', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'search:wikipedia', name: 'Wikipedia', prefix: 'wiki', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
  { id: 'search:maps', name: 'Google Maps', prefix: 'maps', url: 'https://www.google.com/maps/search/%s', keywords: ['directions', 'map'] },
  { id: 'search:github', name: 'GitHub', prefix: 'gh', url: 'https://github.com/search?q=%s' },
  { id: 'search:amazon', name: 'Amazon', prefix: 'amz', url: 'https://www.amazon.com/s?k=%s', keywords: ['shop'] }
]

function folderPath(rel: string): string {
  return isAbsolute(rel) ? rel : join(homedir(), rel)
}

function builtInItems(): LauncherItem[] {
  const folders: LauncherItem[] = FOLDERS.map(([id, title, rel]) => ({
    id, kind: 'link', title, subtitle: folderPath(rel).replace(homedir(), '~'), keywords: ['folder'], glyph: 'folder', iconPath: folderPath(rel)
  }))
  const engines: LauncherItem[] = ENGINES.map((e) => ({
    id: e.id, kind: 'search', title: `Search ${e.name}`, subtitle: `Type “${e.prefix} ” then your search`, keywords: [e.prefix, ...(e.keywords ?? [])],
    glyph: 'globe', prefix: e.prefix
  }))
  const own: LauncherItem[] = [
    { id: 'view:kill', kind: 'command', title: 'Kill Process', subtitle: 'Quit apps that are stuck or using memory', keywords: ['force quit', 'task manager', 'quit app', 'memory', 'end task'], glyph: 'kill', view: 'kill' },
    { id: 'view:snippet-form', kind: 'command', title: 'Add Snippet', subtitle: 'Save text you type a lot, then type its keyword anywhere', keywords: ['snippet', 'text expansion', 'new snippet'], glyph: 'plus', view: 'snippet-form' },
    { id: 'view:link-form', kind: 'command', title: 'Add Quick Link', subtitle: 'Save a website or folder to open from here', keywords: ['bookmark', 'quick link', 'new link'], glyph: 'plus', view: 'link-form' },
    { id: 'view:settings', kind: 'command', title: 'Launcher Settings', subtitle: 'Shortcut, snippets, AI', keywords: ['launcher', 'hotkey', 'shortcut', 'preferences'], glyph: 'settings', view: 'settings' },
    { id: 'view:ai-setup', kind: 'ai', title: 'Connect ChatGPT or Claude', subtitle: 'Free AI with your own plan', keywords: ['ai', 'chatgpt', 'claude', 'codex', 'connect'], glyph: 'sparkle', view: 'ai-setup' }
  ]
  return [...own, ...folders, ...engines]
}

function userItems(): LauncherItem[] {
  const links: LauncherItem[] = launcherStore.links().map((l) => ({
    id: `link:${l.id}`, kind: 'link', title: l.name, subtitle: l.target, keywords: ['link'],
    glyph: /^https?:/i.test(l.target) ? 'link' : 'folder', target: l.target, iconPath: /^https?:/i.test(l.target) ? undefined : l.target
  }))
  const snippets: LauncherItem[] = launcherStore.snippets().map((s) => ({
    id: `snip:${s.id}`, kind: 'snippet', title: s.name || s.keyword, subtitle: `${s.keyword}  ·  ${s.text.replace(/\s+/g, ' ').slice(0, 80)}`,
    keywords: ['snippet', s.keyword, s.text.slice(0, 60)], glyph: 'text', snippetKeyword: s.keyword, snippetText: s.text
  }))
  return [...links, ...snippets]
}

/** The last dictation, and the same words as spoken when the clean-up changed them. */
function dictationItems(): LauncherItem[] {
  // A clip that didn't go through (no connection …) is kept to try again (S11)
  const kept = getKeptDictation()
  const retry: LauncherItem[] = kept
    ? [{ id: 'dictation:retry', kind: 'command', title: 'Try Last Dictation Again', subtitle: `${kept.seconds} s of talking that didn’t go through`, keywords: ['dictation', 'voice', 'again', 'retry'], glyph: 'dictation' }]
    : []
  const d = getLastDictation()
  if (!d) return retry
  const preview = (t: string): string => t.replace(/\s+/g, ' ').slice(0, 80)
  const items: LauncherItem[] = [
    ...retry,
    { id: 'dictation:paste', kind: 'command', title: 'Paste Last Dictation', subtitle: preview(d.typed), keywords: ['dictation', 'voice', 'again'], glyph: 'text' }
  ]
  if (d.raw !== d.typed) {
    items.push({ id: 'dictation:paste-raw', kind: 'command', title: 'Paste Last Dictation as Spoken', subtitle: preview(d.raw), keywords: ['dictation', 'raw', 'undo clean up', 'original'], glyph: 'text' })
  }
  return items
}

async function allItems(): Promise<LauncherItem[]> {
  const apps = await getApps()
  return [...apps, ...toolItems(), ...windowItems(), ...systemItems(), ...settingsItems(), ...builtInItems(), ...userItems(), ...dictationItems()]
}

// ─── running items ───────────────────────────────────────────────────────────

/** http(s) only, and never this computer (same rule as the panel's links). */
function safeWebUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (!['https:', 'http:'].includes(u.protocol)) return null
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

function fillPlaceholders(text: string): string {
  const now = new Date()
  return text
    .replace(/\{date\}/g, now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))
    .replace(/\{time\}/g, now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{clipboard\}/g, clipboard.readText())
}

async function openPath(p: string, reveal: boolean): Promise<LauncherRunResult> {
  if (reveal) {
    shell.showItemInFolder(p)
    return { ok: true }
  }
  const err = await shell.openPath(p)
  return err ? { ok: false, message: 'Couldn’t open that', keepOpen: true } : { ok: true }
}

async function runItem(id: string, opts: LauncherRunOptions = {}): Promise<LauncherRunResult> {
  if (typeof id !== 'string' || id.length > 2000) return { ok: false }
  const done = (r: LauncherRunResult): LauncherRunResult => {
    if (r.ok) launcherStore.recordUse(id)
    return r
  }
  // Commands that act on another app's window or the screen run after the bar has gone
  const after = (fn: () => Promise<LauncherRunResult>): Promise<LauncherRunResult> => {
    hideLauncher()
    return new Promise((resolve) => setTimeout(() => void fn().then(resolve, () => resolve({ ok: false })), 60))
  }

  if (id.startsWith('app:')) {
    const p = id.slice(4)
    if (!isIndexedApp(p)) return { ok: false }
    return done(await openPath(p, !!opts.alt))
  }
  if (id === 'dictation:retry') {
    if (!getKeptDictation()) return { ok: false, message: 'Nothing to try again', keepOpen: true }
    hideLauncher({ restoreFocus: true })
    await new Promise((r) => setTimeout(r, 250)) // the app underneath takes the keyboard back
    return done({ ok: await retryDictation() })
  }
  if (id === 'dictation:paste' || id === 'dictation:paste-raw') {
    const d = getLastDictation()
    if (!d) return { ok: false, message: 'Nothing dictated in the last 30 minutes', keepOpen: true }
    hideLauncher({ restoreFocus: true })
    await new Promise((r) => setTimeout(r, 250)) // the app underneath takes the keyboard back
    return done({ ok: await pasteDictation(id === 'dictation:paste-raw' ? d.raw : d.typed) })
  }
  if (id.startsWith('uwp:')) {
    // Store apps have no file to open: the shell starts them by AppUserModelID
    const appId = id.slice(4)
    if (process.platform !== 'win32' || !isIndexedStartApp(appId)) return { ok: false }
    const child = spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
    return done({ ok: true })
  }
  if (id.startsWith('file:')) {
    const p = filePathFor(id)
    return p ? done(await openPath(p, !!opts.alt)) : { ok: false }
  }
  if (id.startsWith('setting:')) {
    const url = settingsUrl(id)
    if (!url) return { ok: false }
    await shell.openExternal(url).catch(() => {})
    return done({ ok: true })
  }
  if (id.startsWith('folder:')) {
    const f = FOLDERS.find((x) => x[0] === id)
    return f ? done(await openPath(folderPath(f[2]), false)) : { ok: false }
  }
  if (id.startsWith('link:')) {
    const l = launcherStore.links().find((x) => `link:${x.id}` === id)
    if (!l) return { ok: false }
    const url = safeWebUrl(l.target)
    if (url) {
      await shell.openExternal(url)
      return done({ ok: true })
    }
    return isAbsolute(l.target) && existsSync(l.target) ? done(await openPath(normalize(l.target), !!opts.alt)) : { ok: false, message: 'That link no longer works', keepOpen: true }
  }
  if (id.startsWith('search:')) {
    const e = ENGINES.find((x) => x.id === id)
    const q = (opts.query ?? '').trim()
    if (!e || !q) return { ok: false }
    await shell.openExternal(e.url.replace('%s', encodeURIComponent(q)))
    return done({ ok: true })
  }
  if (id.startsWith('snip:')) {
    const s = launcherStore.snippets().find((x) => `snip:${x.id}` === id)
    if (!s) return { ok: false }
    const text = fillPlaceholders(s.text)
    if (opts.alt) {
      clipboard.writeText(text)
      hideLauncher({ restoreFocus: true })
      return done({ ok: true, message: 'Copied' })
    }
    const ok = await pasteText(text, hideLauncher)
    return done({ ok: true, message: ok ? undefined : 'Copied (paste needs the Accessibility permission)' })
  }
  if (id.startsWith('window:')) {
    return after(async () => {
      const msg = await runWindowCommand(id)
      if (msg === null) return { ok: false }
      launcherStore.recordUse(id)
      return { ok: true, message: msg }
    })
  }
  if (id.startsWith('tool:')) {
    const r = id === 'tool:focusdim' ? after(() => runToolCommand(id)!) : runToolCommand(id)
    if (!r) return { ok: false }
    if (id !== 'tool:focusdim') hideLauncher()
    return done(await r)
  }
  if (id.startsWith('cmd:')) {
    const r = runSystemCommand(id)
    return r ? done(await r) : { ok: false }
  }
  return { ok: false }
}

// ─── AI ──────────────────────────────────────────────────────────────────────

const ACTION_SYSTEM: Record<AiTextAction, string> = {
  grammar: 'Fix the spelling, grammar and punctuation of the text. Keep its meaning, tone, language and line breaks. Reply with only the corrected text.',
  rewrite: 'Rewrite the text so it reads clearly and naturally. Keep its meaning and language. Reply with only the rewritten text.',
  summarise: 'Summarise the text in a few short bullet points. Reply with only the summary.',
  translate: 'Translate the text into {lang}. Keep the formatting. Reply with only the translation.',
  explain: 'Explain the text simply, in a short paragraph a non-expert would follow.'
}

const QUICK_ASK_SYSTEM = 'You answer quick questions inside a desktop launcher. Be direct and brief: a sentence or a short list unless more is asked for. Plain text, no preamble.'

let aiSeq = 0
const aiRuns = new Map<number, AbortController>()

const AI_ERRORS: Record<string, string> = {
  no_provider: 'No AI is connected yet. Choose “Connect ChatGPT or Claude”.',
  not_signed_in: 'You’re signed out of that AI. Choose “Connect ChatGPT or Claude” to sign in again.',
  timeout: 'The AI took too long to answer. Try again.',
  failed: 'The AI couldn’t answer that. Try again, or switch to another AI.'
}

function askAi(p: AiAskPayload): number {
  const reqId = ++aiSeq
  const ctrl = new AbortController()
  aiRuns.set(reqId, ctrl)
  const chunk = (c: Omit<AiChunk, 'reqId'>): void => sendToLauncher(IPC_SEND.LAUNCHER_AI_CHUNK, { reqId, ...c } satisfies AiChunk)
  const provider = p.provider && (['codex', 'claude', 'ollama'] as const).includes(p.provider) ? p.provider : undefined
  const action = p.action && p.action in ACTION_SYSTEM ? p.action : undefined
  const prompt = String(p.prompt ?? '').slice(0, 20_000)
  const text = String(p.text ?? '').slice(0, 60_000)
  const lang = String(p.language ?? 'English').replace(/[^\p{L} -]/gu, '').slice(0, 40) || 'English'
  const system = action ? ACTION_SYSTEM[action].replace('{lang}', lang) : QUICK_ASK_SYSTEM
  const fullPrompt = action ? `${prompt ? `Extra instruction: ${prompt}\n\n` : ''}Text:\n${text}` : prompt
  const t0 = Date.now()
  let first = 0
  void runLocalAi({
    prompt: fullPrompt,
    system,
    provider,
    signal: ctrl.signal,
    onChunk: (t) => {
      if (!first) first = Date.now() - t0
      chunk({ text: t, done: false })
    }
  }).then((r) => {
    aiRuns.delete(reqId)
    if (ctrl.signal.aborted) return
    console.log(`[Launcher] AI ${provider ?? 'default'} ${r.ok ? 'answered' : r.error}: first text ${first || '-'} ms, done ${Date.now() - t0} ms`)
    chunk(r.ok ? { text: r.text ?? '', done: true } : { text: '', done: true, error: AI_ERRORS[r.error ?? 'failed'] })
  })
  return reqId
}

async function aiStatus(): Promise<AiStatus> {
  const [list, selected] = await Promise.all([listAiProviders(), getDefaultAiProvider()])
  return {
    providers: list.map((p) => ({ id: p.id, name: p.id === 'ollama' ? 'Local model' : p.label, installed: p.installed, signedIn: p.signedIn ?? null, model: p.id === 'ollama' && p.installed ? p.label.replace(/^.*\((.*)\)$/, '$1') : undefined, tier: getAiTier(p.id) })),
    selected
  }
}

/** Open a terminal that installs and signs in to ChatGPT (Codex) or Claude. */
function connectAi(id: unknown): boolean {
  if (id !== 'codex' && id !== 'claude') return false
  refreshAiProviders()
  const name = id === 'codex' ? 'ChatGPT (Codex)' : 'Claude (Claude Code)'
  const cmd = aiSetupCommand(id)
  if (isMac) {
    const file = join(app.getPath('userData'), `connect-${id}.command`)
    writeFileSync(
      file,
      `#!/bin/bash\nclear\necho "PeakFlow: connecting ${name}"\necho "This installs ${id === 'codex' ? 'Codex' : 'Claude Code'} and opens a sign-in page in your browser."\necho "Sign in with your own account. PeakFlow never sees your login."\necho\n${cmd}\necho\necho "All done. You can close this window and go back to PeakFlow."\n`
    )
    chmodSync(file, 0o755)
    execFile('open', ['-a', 'Terminal', file])
    return true
  }
  if (process.platform === 'win32') {
    const script = `Write-Host 'PeakFlow: connecting ${name}'; Write-Host 'Sign in with your own account. PeakFlow never sees your login.'; ${cmd}; Write-Host 'All done. You can close this window.'`
    spawn('cmd.exe', ['/c', 'start', 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, windowsHide: false }).unref()
    return true
  }
  return false
}

// ─── hotkey and settings ─────────────────────────────────────────────────────

let registeredHotkey: string | null = null

function registerHotkey(accel: string): boolean {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = null
  }
  try {
    if (globalShortcut.register(accel, () => toggleLauncher(Date.now()))) {
      registeredHotkey = accel
      console.log(`[PeakFlow] Hotkey registered: ${accel} -> launcher`)
      return true
    }
  } catch (err) {
    console.warn(`[Launcher] Invalid shortcut ${accel}:`, err)
  }
  console.warn(`[Launcher] Couldn't register ${accel}; another app may be using it`)
  return false
}

function settings(): LauncherSettings {
  return {
    hotkey: launcherStore.hotkey,
    hotkeyRegistered: registeredHotkey === launcherStore.hotkey,
    expansionEnabled: launcherStore.expansion,
    expansionActive: isExpansionActive(),
    keepAwake: isKeepAwake()
  }
}

function changed(): void {
  updateExpansion(launcherStore.expansion, launcherStore.snippets())
  sendToLauncher(IPC_SEND.LAUNCHER_CHANGED)
}

const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// ─── setup ───────────────────────────────────────────────────────────────────

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)
  const fromLauncher = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === getLauncherWindow()?.webContents

  h(IPC_INVOKE.LAUNCHER_READY, (e, m?: { openMs?: number; searchMs?: number }) => {
    if (!fromLauncher(e)) return
    if (m && typeof m.openMs === 'number') console.log(`[Launcher] opened in ${Math.round(m.openMs)} ms`)
    if (m && typeof m.searchMs === 'number') console.log(`[Launcher] search ranked in ${m.searchMs.toFixed(1)} ms`)
  })
  h(IPC_INVOKE.LAUNCHER_ITEMS, (e) => (fromLauncher(e) ? allItems() : []))
  h(IPC_INVOKE.LAUNCHER_USAGE, (e) => (fromLauncher(e) ? launcherStore.usage() : {}))
  h(IPC_INVOKE.LAUNCHER_RUN, (e, id: string, opts?: LauncherRunOptions) => (fromLauncher(e) ? runItem(id, opts ?? {}) : { ok: false }))
  h(IPC_INVOKE.LAUNCHER_FILES, (e, q: unknown) => (fromLauncher(e) && typeof q === 'string' && q.length < 200 ? searchFiles(q) : []))
  h(IPC_INVOKE.LAUNCHER_ICON, (_e, p: unknown) => {
    if (typeof p !== 'string' || !isAbsolute(p) || p.includes('..') || p.length > 1000) return null
    return getAppIcon({ path: p })
  })
  h(IPC_INVOKE.LAUNCHER_HIDE, (e) => {
    if (fromLauncher(e)) hideLauncher({ restoreFocus: true })
  })
  h(IPC_INVOKE.LAUNCHER_RESIZE, (e, height: unknown) => {
    if (fromLauncher(e)) resizeLauncher(height)
  })
  h(IPC_INVOKE.LAUNCHER_COPY, async (e, text: unknown, opts?: { paste?: boolean }) => {
    if (!fromLauncher(e) || typeof text !== 'string') return false
    if (opts?.paste) return pasteText(text, hideLauncher)
    clipboard.writeText(text)
    hideLauncher({ restoreFocus: true })
    return true
  })
  h(IPC_INVOKE.LAUNCHER_PROCESSES, (e) => (fromLauncher(e) ? listProcesses() : []))
  h(IPC_INVOKE.LAUNCHER_QUIT_PROCESS, (e, pid: unknown, force: unknown) => (fromLauncher(e) ? quitProcess(pid, force) : false))
  h(IPC_INVOKE.LAUNCHER_RATES, () => getRates())
  h(IPC_INVOKE.LAUNCHER_SAVE_SNIPPET, (e, s: Partial<LauncherSnippet>) => {
    if (!fromLauncher(e) || !s || typeof s.keyword !== 'string' || typeof s.text !== 'string') return null
    const keyword = s.keyword.trim().replace(/\s+/g, '').slice(0, 32)
    const text = s.text.slice(0, 20_000)
    if (!keyword || !text) return null
    const list = launcherStore.snippets().filter((x) => x.id !== s.id && x.keyword !== keyword)
    const saved: LauncherSnippet = { id: typeof s.id === 'string' ? s.id : newId(), keyword, text, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : undefined }
    launcherStore.setSnippets([...list, saved])
    changed()
    return saved
  })
  h(IPC_INVOKE.LAUNCHER_DELETE_SNIPPET, (e, id: unknown) => {
    if (!fromLauncher(e)) return
    launcherStore.setSnippets(launcherStore.snippets().filter((x) => `snip:${x.id}` !== id && x.id !== id))
    changed()
  })
  h(IPC_INVOKE.LAUNCHER_SAVE_LINK, (e, l: Partial<LauncherLink>) => {
    if (!fromLauncher(e) || !l || typeof l.target !== 'string' || typeof l.name !== 'string') return null
    let target = l.target.trim()
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(target)) target = `https://${target}` // "example.com" → https://example.com
    if (target.startsWith('~')) target = join(homedir(), target.slice(1))
    if (!safeWebUrl(target) && !(isAbsolute(target) && existsSync(target))) return null
    const saved: LauncherLink = { id: typeof l.id === 'string' ? l.id : newId(), name: l.name.trim().slice(0, 80) || target, target }
    launcherStore.setLinks([...launcherStore.links().filter((x) => x.id !== saved.id), saved])
    changed()
    return saved
  })
  h(IPC_INVOKE.LAUNCHER_DELETE_LINK, (e, id: unknown) => {
    if (!fromLauncher(e)) return
    launcherStore.setLinks(launcherStore.links().filter((x) => `link:${x.id}` !== id && x.id !== id))
    changed()
  })
  h(IPC_INVOKE.LAUNCHER_SETTINGS, () => settings())
  h(IPC_INVOKE.LAUNCHER_SET_SETTING, (e, key: unknown, value: unknown) => {
    if (!fromLauncher(e)) return settings()
    if (key === 'hotkey' && typeof value === 'string' && value.length < 60) {
      const prev = launcherStore.hotkey
      const next = value || DEFAULT_LAUNCHER_HOTKEY
      if (registerHotkey(next)) launcherStore.hotkey = next
      else registerHotkey(prev)
    } else if (key === 'expansion' && typeof value === 'boolean') {
      launcherStore.expansion = value
      changed()
    }
    return settings()
  })
  h(IPC_INVOKE.LAUNCHER_AI_STATUS, () => aiStatus())
  h(IPC_INVOKE.LAUNCHER_AI_SET_PROVIDER, (e, id: unknown) => {
    if (fromLauncher(e) && (id === 'codex' || id === 'claude' || id === 'ollama')) setDefaultAiProvider(id as AiProviderId)
    return aiStatus()
  })
  h(IPC_INVOKE.LAUNCHER_AI_SET_TIER, (e, id: unknown, tier: unknown) => {
    if (fromLauncher(e) && (id === 'codex' || id === 'claude' || id === 'ollama') && (tier === 'light' || tier === 'best')) setAiTier(id, tier)
    return aiStatus()
  })
  h(IPC_INVOKE.LAUNCHER_AI_ASK, (e, p: AiAskPayload) => (fromLauncher(e) && p && typeof p === 'object' ? askAi(p) : 0))
  h(IPC_INVOKE.LAUNCHER_AI_CANCEL, (_e, reqId: unknown) => {
    const c = typeof reqId === 'number' ? aiRuns.get(reqId) : undefined
    c?.abort()
    if (typeof reqId === 'number') aiRuns.delete(reqId)
  })
  h(IPC_INVOKE.LAUNCHER_AI_CONNECT, (e, id: unknown) => (fromLauncher(e) ? connectAi(id) : false))
  h(IPC_INVOKE.LAUNCHER_SELECTION, (e) =>
    fromLauncher(e) ? getSelectedText(stepAsideLauncher, refocusLauncher, holdLauncherOpen) : { text: '', trusted: true }
  )
}

/** Start the launcher: hidden window, hotkey, IPC, snippet expansion. */
export function initLauncher(): void {
  registerIpc()
  initLauncherWindow()
  registerHotkey(launcherStore.hotkey)
  updateExpansion(launcherStore.expansion, launcherStore.snippets())
  initDictation(() => getLauncherWindow()?.webContents)
  // Warm the app index and the AI check so the first open has everything
  void getApps()
  void listAiProviders().catch(() => {})
  onLauncherHidden(() => {
    for (const c of aiRuns.values()) c.abort()
    aiRuns.clear()
  })
  // Retry snippet expansion when the bar opens (the permission may have been granted since)
  getLauncherWindow()?.on('show', () => retryExpansion())
  void runDictationDevTest() // development test driver only (env-gated, never in packaged builds)
  void runLauncherDevTest() // development test driver only (env-gated, never in packaged builds)
}

export function destroyLauncher(): void {
  setLauncherQuitting(true)
  for (const c of aiRuns.values()) c.abort()
  destroyDictation()
  stopExpansion()
  stopKeepAwake()
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
}

export { showLauncher }
