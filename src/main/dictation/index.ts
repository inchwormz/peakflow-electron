/**
 * Dictation: hold a key, talk, let go, and the words are typed where the
 * cursor is. Speech-to-text uses the person's own OpenAI API key (stored
 * encrypted with the other credentials, never logged). Optional tidy-up runs
 * through their own ChatGPT/Claude (local-ai), free.
 *
 * The hold key comes from the launcher's keyboard watcher (expander.ts); the
 * microphone is recorded by a small pill window that never takes focus, so
 * the paste lands in the app the person is typing in.
 */

import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import Store from 'electron-store'
import { is } from '@electron-toolkit/utils'
import { SystemWindowId } from '@shared/tool-ids'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationHoldKey, DictationSettings, DictationState } from '@shared/launcher/types'
import { storeCredential, getCredential, deleteCredential } from '../security/credentials'
import { ensureMediaAccess } from '../services/permissions-darwin'
import { onHoldKey, setHoldKey, isExpansionActive, retryExpansion } from '../launcher/expander'
import { saveClipboard, restoreClipboard } from '../launcher/selection'
import { simulateCtrlV } from '../native/keyboard'
import { transcribe, checkKey, warmConnection, type DictationModel, type TranscribeError } from './transcribe'
import { parseMyWords, transcriptionPrompt, cleanUp, needsTidy, applyReplacements, type DictationContext } from './smart'
import { runMacHelper } from '../native/mac-helper'
import { getActiveWindow } from '../native/active-window'

const isMac = process.platform === 'darwin'
const CRED_TOOL = 'Dictation'
const CRED_TYPE = 'openai_api_key'
/** Shorter than this is a tap, not a hold: ignored */
const MIN_HOLD_MS = 300
/** Longest recording (OpenAI takes up to 25 MB; ~10 minutes of opus is far below) */
const MAX_HOLD_MS = 5 * 60_000
const PILL_W = 220
const PILL_H = 44

const MAC_KEYS: DictationHoldKey[] = ['rcmd', 'ropt', 'fn', 'rctrl']
const WIN_KEYS: DictationHoldKey[] = ['rctrl', 'ralt']

interface DictationData {
  enabled: boolean
  holdKey: DictationHoldKey
  /** Light clean-up (fillers, punctuation, "no wait"); on by default since it passed the test set */
  tidy: boolean
  /** "My words": one per line; "X -> Y" lines are replacements */
  words: string
}

const store = new Store<DictationData>({
  name: 'config-dictation',
  clearInvalidConfig: true,
  defaults: { enabled: false, holdKey: isMac ? 'rcmd' : 'rctrl', tidy: true, words: '' }
})

let pill: BrowserWindow | null = null
let quitting = false
let downAt = 0
let releasedAt = 0
let recording = false
let maxTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let busy = false
/** gpt-transcribe unless this key turned out not to have it (remembered until restart) */
let model: DictationModel = 'gpt-transcribe'
/** Read on key-down while the person talks: the app and the text around the cursor */
let context: Promise<DictationContext> = Promise.resolve({})
/** The last dictation as spoken and as typed, for "Paste last dictation as spoken" */
let last: { raw: string; typed: string; at: number } | null = null
/** Keep recording this long after the key comes up, so the last word isn't clipped */
const RELEASE_PAD_MS = 150

const hasKey = (): boolean => !!getCredential(CRED_TOOL, CRED_TYPE)

function settings(): DictationSettings {
  const key = hasKey()
  return {
    enabled: store.get('enabled') && key,
    hasKey: key,
    holdKey: store.get('holdKey'),
    model,
    cleanup: store.get('tidy'),
    wordCount: parseMyWords(store.get('words')).hints.length,
    active: store.get('enabled') && key && isExpansionActive()
  }
}

/** Watch the hold key only while dictation is on and has a key. */
function applyWatcher(): void {
  const s = settings()
  setHoldKey(s.enabled ? s.holdKey : null)
}

// ─── the pill ────────────────────────────────────────────────────────────────

function getPill(): BrowserWindow {
  if (pill && !pill.isDestroyed()) return pill
  const w = new BrowserWindow({
    width: PILL_W,
    height: PILL_H,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    transparent: true,
    backgroundColor: '#00000000',
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.setIgnoreMouseEvents(true)
  w.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    w.hide()
  })
  w.on('closed', () => {
    pill = null
  })
  const query = { toolId: SystemWindowId.Dictation }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query).toString()}`)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  pill = w
  return w
}

function sendPill(channel: string, ...args: unknown[]): void {
  const w = pill && !pill.isDestroyed() ? pill : null
  if (!w || w.webContents.isLoading()) return
  try {
    w.webContents.send(channel, ...args)
  } catch { /* reloading */ }
}

function showPill(): void {
  const w = getPill()
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  w.setBounds({ x: Math.round(wa.x + (wa.width - PILL_W) / 2), y: Math.round(wa.y + wa.height - PILL_H - 28), width: PILL_W, height: PILL_H })
  if (!w.isVisible()) w.showInactive()
}

function hidePill(afterMs = 0): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (!recording && pill && !pill.isDestroyed()) pill.hide()
  }, afterMs)
}

function state(s: DictationState): void {
  sendPill(IPC_SEND.DICTATION_STATE, s)
}

const ERROR_TEXT: Record<TranscribeError | 'mic_denied' | 'mic_none', string> = {
  no_key: 'Add your OpenAI key in Launcher Settings',
  bad_key: 'OpenAI didn’t accept your key',
  network: 'No internet connection',
  no_speech: 'Didn’t hear anything',
  failed: 'Couldn’t turn that into text',
  model_unavailable: 'Couldn’t turn that into text',
  mic_denied: 'PeakFlow can’t use the microphone',
  mic_none: 'No microphone found'
}

function fail(code: keyof typeof ERROR_TEXT): void {
  recording = false
  busy = false
  state({ phase: 'error', message: ERROR_TEXT[code] })
  hidePill(2600)
}

// ─── hold → record → let go → type ───────────────────────────────────────────

function onDown(): void {
  if (recording || busy || !settings().enabled) return
  downAt = Date.now()
  recording = true
  showPill()
  state({ phase: 'listening' })
  // PEAKFLOW_DICTATION_MIC_RAW=1 (testing): no echo cancelling, noise suppression or auto gain
  sendPill(IPC_SEND.DICTATION_START, { at: downAt, processing: process.env['PEAKFLOW_DICTATION_MIC_RAW'] !== '1' })
  // While they talk: open the connection to OpenAI and read where the text is going
  warmConnection(getCredential(CRED_TOOL, CRED_TYPE))
  context = readContext()
  if (maxTimer) clearTimeout(maxTimer)
  maxTimer = setTimeout(() => onUp(), MAX_HOLD_MS)
}

function onUp(): void {
  if (!recording) return
  if (maxTimer) clearTimeout(maxTimer)
  maxTimer = null
  recording = false
  if (Date.now() - downAt < MIN_HOLD_MS) return cancel()
  releasedAt = Date.now()
  busy = true
  state({ phase: 'transcribing' })
  setTimeout(() => sendPill(IPC_SEND.DICTATION_STOP, { send: true }), RELEASE_PAD_MS)
}

/** The front app and up to 500 characters each side of the cursor (never password fields). */
async function readContext(): Promise<DictationContext> {
  if (isMac) {
    const r = await runMacHelper(['context'], 800)
    if (!r || r.secure === true) return { app: typeof r?.app === 'string' ? r.app : undefined }
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
    return { app: str(r.app), before: str(r.before), after: str(r.after) }
  }
  try {
    // Windows: the window title's last part is usually the app ("Report - Word")
    const title = getActiveWindow()?.title ?? ''
    return { app: title.split(' - ').pop()?.trim().slice(0, 60) || undefined }
  } catch {
    return {}
  }
}

/** Tap, or another key pressed with the hold key (a shortcut, not dictation). */
function cancel(): void {
  if (maxTimer) clearTimeout(maxTimer)
  maxTimer = null
  recording = false
  sendPill(IPC_SEND.DICTATION_STOP, { send: false })
  state({ phase: 'idle' })
  hidePill()
}

async function onAudio(buf: ArrayBuffer, mime: string): Promise<void> {
  const key = getCredential(CRED_TOOL, CRED_TYPE)
  const words = parseMyWords(store.get('words'))
  const ctx = await context
  const prompt = transcriptionPrompt(words, ctx)
  let r = await transcribe(new Uint8Array(buf), { key, model, mime, prompt, stream: true })
  if (r.error === 'model_unavailable' && model !== 'gpt-4o-mini-transcribe') {
    console.warn(`[Dictation] ${model} not available on this key (${r.detail}); using gpt-4o-mini-transcribe`)
    model = 'gpt-4o-mini-transcribe'
    r = await transcribe(new Uint8Array(buf), { key, model, mime, prompt, stream: true })
  }
  const sttMs = Date.now() - releasedAt
  if (!r.ok || !r.text) {
    if (r.detail) console.warn(`[Dictation] ${r.error}: ${r.detail}`)
    return fail(r.error ?? 'failed')
  }
  let text = r.text
  let tidyNote = 'off'
  if (store.get('tidy') && key && !needsTidy(r.text, words)) tidyNote = 'not needed'
  else if (store.get('tidy') && key) {
    const c = await cleanUp(r.text, { key, words, ctx })
    text = c.text
    tidyNote = c.cleaned ? `${c.ms} ms` : `kept as spoken: ${c.rejected}`
  }
  text = applyReplacements(text, words.replacements)
  last = { raw: applyReplacements(r.text, words.replacements), typed: text, at: Date.now() }
  const ok = await typeText(text)
  console.log(
    `[Dictation] let go → typed in ${pastedAt - releasedAt} ms (speech-to-text ${sttMs} ms incl. ${RELEASE_PAD_MS} ms pad, tidy ${tidyNote}, ` +
      `${(buf.byteLength / 1024).toFixed(0)} KB, ${ctx.app ?? 'unknown app'}${ctx.before ? `, ${ctx.before.length} chars context` : ''})`
  )
  busy = false
  state({ phase: ok ? 'done' : 'error', message: ok ? undefined : 'Copied: press ⌘V to paste' })
  hidePill(ok ? 500 : 2600)
}

/** The last dictation, for the launcher's "Paste last dictation" commands (kept for 30 minutes). */
export function getLastDictation(): { raw: string; typed: string } | null {
  return last && Date.now() - last.at < 30 * 60_000 ? { raw: last.raw, typed: last.typed } : null
}

/** Paste text into the app in front (from the launcher, after the bar has gone). */
export function pasteDictation(text: string): Promise<boolean> {
  return typeText(text)
}

/** Paste into the app in front, then put the clipboard back as it was. */
let pastedAt = 0

async function typeText(text: string): Promise<boolean> {
  const before = clipboard.readText()
  const saved = saveClipboard()
  clipboard.writeText(text)
  const ok = await simulateCtrlV()
  pastedAt = Date.now()
  if (ok) {
    // Give the app time to read the clipboard before restoring it
    await new Promise((r) => setTimeout(r, 400))
    restoreClipboard(saved, before)
  }
  return ok
}

// ─── IPC and lifecycle ───────────────────────────────────────────────────────

/** Check a pasted key with OpenAI, then store it encrypted and turn dictation on. */
async function saveKey(key: unknown): Promise<{ ok: boolean; error?: string; settings: DictationSettings }> {
  if (typeof key !== 'string') return { ok: false, error: 'failed', settings: settings() }
  const k = key.trim()
  if (!/^sk-[\w-]{20,300}$/.test(k)) return { ok: false, error: 'bad_key', settings: settings() }
  const check = await checkKey(k)
  if (check !== 'ok') return { ok: false, error: check, settings: settings() }
  if (!storeCredential(CRED_TOOL, CRED_TYPE, k)) return { ok: false, error: 'failed', settings: settings() }
  // Saving a key turns dictation on: that's why someone adds it
  store.set('enabled', true)
  void ensureMediaAccess('Dictation', ['microphone'])
  retryExpansion()
  applyWatcher()
  getPill()
  return { ok: true, settings: settings() }
}

function registerIpc(getLauncherContents: () => Electron.WebContents | undefined): void {
  const h = ipcMain.handle.bind(ipcMain)
  const fromPill = (e: Electron.IpcMainInvokeEvent): boolean => !!pill && !pill.isDestroyed() && e.sender === pill.webContents
  const fromLauncher = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === getLauncherContents()

  h(IPC_INVOKE.DICTATION_READY, (e, m?: { micMs?: number }) => {
    // The pill reports how long the microphone took to open after the key went down
    if (fromPill(e) && m && typeof m.micMs === 'number') console.log(`[Dictation] microphone open ${Math.round(m.micMs)} ms after key-down`)
  })
  h(IPC_INVOKE.DICTATION_AUDIO, (e, buf: unknown, mime: unknown) => {
    if (!fromPill(e) || !busy) return
    if (!(buf instanceof ArrayBuffer) && !ArrayBuffer.isView(buf)) return fail('failed')
    const ab = buf instanceof ArrayBuffer ? buf : (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    if (ab.byteLength > 25 * 1024 * 1024) return fail('failed')
    void onAudio(ab, typeof mime === 'string' && mime.length < 60 ? mime : 'audio/webm')
  })
  h(IPC_INVOKE.DICTATION_MIC_ERROR, (e, kind: unknown) => {
    if (!fromPill(e)) return
    fail(kind === 'denied' ? 'mic_denied' : kind === 'none' ? 'mic_none' : 'failed')
    if (kind === 'denied') void ensureMediaAccess('Dictation', ['microphone'])
  })
  h(IPC_INVOKE.DICTATION_SETTINGS, () => settings())
  h(IPC_INVOKE.DICTATION_SET, (e, key: unknown, value: unknown) => {
    if (!fromLauncher(e)) return settings()
    if (key === 'enabled' && typeof value === 'boolean') {
      store.set('enabled', value)
      if (value) {
        void ensureMediaAccess('Dictation', ['microphone'])
        retryExpansion()
      }
    } else if (key === 'holdKey' && typeof value === 'string' && (isMac ? MAC_KEYS : WIN_KEYS).includes(value as DictationHoldKey)) {
      store.set('holdKey', value as DictationHoldKey)
    } else if (key === 'cleanup' && typeof value === 'boolean') {
      store.set('tidy', value)
    }
    applyWatcher()
    if (settings().enabled) getPill()
    return settings()
  })
  h(IPC_INVOKE.DICTATION_SAVE_KEY, (e, key: unknown) => (fromLauncher(e) ? saveKey(key) : { ok: false, error: 'failed', settings: settings() }))
  h(IPC_INVOKE.DICTATION_WORDS, (e) => (fromLauncher(e) ? store.get('words') : ''))
  h(IPC_INVOKE.DICTATION_SET_WORDS, (e, text: unknown) => {
    if (!fromLauncher(e) || typeof text !== 'string') return settings()
    store.set('words', text.slice(0, 20_000))
    return settings()
  })
  h(IPC_INVOKE.DICTATION_REMOVE_KEY, (e) => {
    if (!fromLauncher(e)) return settings()
    deleteCredential(CRED_TOOL, CRED_TYPE)
    store.set('enabled', false)
    applyWatcher()
    return settings()
  })
}

export function initDictation(getLauncherContents: () => Electron.WebContents | undefined): void {
  registerIpc(getLauncherContents)
  onHoldKey((e) => {
    if (e === 'down') onDown()
    else if (e === 'up') onUp()
    else cancel()
  })
  applyWatcher()
  // Load the pill early when dictation is on, so the first hold records straight away
  if (settings().enabled) getPill()
}

/**
 * Development-only check of the real path minus the microphone and the paste:
 * saves the key through saveKey, shows the pill states (screenshots), and
 * transcribes a sample file. Never types anything. Never runs packaged.
 *   PEAKFLOW_DICTATION_TEST_AUDIO=/sample.wav PEAKFLOW_LAUNCHER_SHOTS=/out OPENAI_API_KEY=… npm run dev
 */
export async function runDictationDevTest(): Promise<void> {
  const audioPath = process.env['PEAKFLOW_DICTATION_TEST_AUDIO']
  const out = process.env['PEAKFLOW_LAUNCHER_SHOTS']
  if (!is.dev || app.isPackaged || !audioPath || !out) return
  mkdirSync(out, { recursive: true })
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const shot = async (name: string): Promise<void> => {
    await sleep(350)
    const img = await getPill().webContents.capturePage()
    writeFileSync(join(out, `${name}.png`), img.toPNG())
  }
  const bad = await saveKey('sk-not-a-real-key-000000000000000000')
  console.log(`[DictationTest] wrong key → ${bad.ok ? 'accepted (WRONG)' : bad.error}`)
  const saved = await saveKey(process.env['OPENAI_API_KEY'] ?? '')
  console.log(`[DictationTest] key saved: ${saved.ok ? 'yes' : saved.error}; settings ${JSON.stringify(saved.settings)}`)
  const w = getPill()
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()))
  await sleep(800)
  showPill()
  state({ phase: 'listening' })
  await shot('30-dictation-listening')
  state({ phase: 'transcribing' })
  await shot('31-dictation-typing')
  const audio = new Uint8Array(readFileSync(audioPath))
  for (const m of ['gpt-transcribe', 'gpt-4o-mini-transcribe'] as const) {
    const t0 = Date.now()
    const r = await transcribe(audio, { key: getCredential(CRED_TOOL, CRED_TYPE), model: m, mime: 'audio/wav' })
    console.log(`[DictationTest] ${m}: ${Date.now() - t0} ms → ${r.ok ? JSON.stringify(r.text) : r.error}`)
  }
  // The whole pipeline minus the paste: hints, streamed transcription, clean-up, replacements
  {
    const words = parseMyWords(store.get('words'))
    const ctx: DictationContext = { app: 'Mail' }
    const t0 = Date.now()
    const r = await transcribe(audio, { key: getCredential(CRED_TOOL, CRED_TYPE), model, mime: 'audio/wav', prompt: transcriptionPrompt(words, ctx), stream: true })
    const sttMs = Date.now() - t0
    if (r.ok && r.text) {
      const c = needsTidy(r.text, words) ? await cleanUp(r.text, { key: getCredential(CRED_TOOL, CRED_TYPE) ?? '', words, ctx }) : null
      const typed = applyReplacements(c?.text ?? r.text, words.replacements)
      last = { raw: applyReplacements(r.text, words.replacements), typed, at: Date.now() }
      console.log(`[DictationTest] pipeline: ${sttMs} ms speech-to-text, clean-up ${c ? `${c.ms} ms${c.rejected ? ` (kept raw: ${c.rejected})` : ''}` : 'not needed'} → ${JSON.stringify(typed)} (raw ${JSON.stringify(r.text)})`)
    }
  }
  state({ phase: 'error', message: ERROR_TEXT.no_speech })
  await shot('32-dictation-error')
  hidePill()
  console.log('[DictationTest] finished')
}

export function destroyDictation(): void {
  quitting = true
  if (maxTimer) clearTimeout(maxTimer)
  if (pill && !pill.isDestroyed()) pill.destroy()
}
