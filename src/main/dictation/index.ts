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

import { createDictationAccountClient } from './account'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { app, BrowserWindow, clipboard, ipcMain, screen, systemPreferences } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import Store from 'electron-store'
import { is } from '@electron-toolkit/utils'
import { SystemWindowId } from '@shared/tool-ids'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationHoldKey, DictationSettings, DictationState } from '@shared/launcher/types'
import { storeCredential, getCredential, deleteCredential } from '../security/credentials'
import { ensureMediaAccess, checkAccessibility, requestAccessibility, openMediaSettings } from '../services/permissions-darwin'
import { getPanel, hidePanel } from '../panel'
import { missingPermission, type DictationPermissions, type MediaStatus } from '@shared/dictation-view'
import { onHoldKey, setHoldKey, isExpansionActive, retryExpansion } from '../launcher/expander'
import { saveClipboard, restoreClipboard } from '../launcher/selection'
import { simulateCtrlV } from '../native/keyboard'
import { transcribe, checkKey, warmConnection, type DictationModel, type TranscribeError } from './transcribe'
import { KEEP_CLIP_MS, keepsClip, pasteKeys, sayTryAgain, transcribeTimeoutMs } from './retry'
import { parseMyWords, transcriptionPrompt, cleanUp, needsTidy, applyReplacements, type DictationContext } from './smart'
import { runMacHelper } from '../native/mac-helper'
import { getActiveWindow } from '../native/active-window'
import { allowServerOverride, fetchAddonStatus, transcribeViaAddon, addonTidyFetch, type AddonAuth, type AddonStatus } from './addon'

const isMac = process.platform === 'darwin'
const CRED_TOOL = 'Dictation'
const CRED_TYPE = 'openai_api_key'
/** Shorter than this is a tap, not a hold: ignored */
const MIN_HOLD_MS = 300
/** Longest recording (OpenAI takes up to 25 MB; ~10 minutes of opus is far below) */
const MAX_HOLD_MS = 5 * 60_000
const PILL_W = 220
/** Wide enough for an error message with where to try again */
const PILL_ERROR_W = 380
const PILL_H = 44

const MAC_KEYS: DictationHoldKey[] = ['fn', 'ropt', 'rcmd', 'rctrl']
const WIN_KEYS: DictationHoldKey[] = ['rctrl', 'ralt']

interface DictationData {
  enabled: boolean
  holdKey: DictationHoldKey
  /** Light clean-up (fillers, punctuation, "no wait"); on by default since it passed the test set */
  tidy: boolean
  /** "My words": one per line; "X -> Y" lines are replacements */
  words: string
  /** Made up once; the add-on's server allows two computers per licence */
  deviceId?: string
}

const store = new Store<DictationData>({
  name: 'config-dictation',
  clearInvalidConfig: true,
  // fn on Mac (John, 22 Oct: "take over the function key"); settings warn when another app or macOS also uses it
  defaults: { enabled: false, holdKey: isMac ? 'fn' : 'rctrl', tidy: true, words: '' }
})

let pill: BrowserWindow | null = null
let quitting = false
let downAt = 0
let releasedAt = 0
let recording = false
let maxTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let busy = false
/** gpt-transcribe unless this key turned out not to have it (remembered until restart) */
let model: DictationModel = 'gpt-transcribe'
/** Read on key-down while the person talks: the app and the text around the cursor */
let context: Promise<DictationContext> = Promise.resolve({})
/** The last dictation as spoken and as typed, for "Paste last dictation as spoken" */
let last: { raw: string; typed: string; at: number } | null = null
/** A clip that couldn't be turned into text, kept so it can be tried again (S11) */
interface Clip { buf: ArrayBuffer; mime: string; durationMs: number; ctx: DictationContext; at: number }
let keptClip: Clip | null = null
/** Keep recording this long after the key comes up, so the last word isn't clipped */
const RELEASE_PAD_MS = 150

const hasKey = (): boolean => !!getCredential(CRED_TOOL, CRED_TYPE)

// ─── the $5 add-on (PeakFlow's server instead of the person's own key) ────────

let addon: AddonStatus = { state: 'none' }
let addonCheckedAt = 0
let addonRefresh: Promise<void> | null = null
let addonRetry: ReturnType<typeof setTimeout> | null = null
/** Last time the Dictation page made the add-on check early (after a purchase) */
let catchUpAt = 0

function addonAuth(): AddonAuth | null {
  const licence = getCredential('license', 'key')?.trim()
  if (!licence) return null
  let deviceId = store.get('deviceId')
  if (!deviceId) store.set('deviceId', (deviceId = randomUUID()))
  return { licence, deviceId }
}

const { getDictationAccount, openDictationCheckout } = createDictationAccountClient(addonAuth)

const viaAddon = (): boolean => ['ok', 'low', 'empty'].includes(addon.state) && !addon.disabled && addon.blocked !== 'disabled'

/**
 * Ask the server how the add-on stands (at most once a minute unless forced;
 * callers share one request in flight). A temporary failure (offline, server
 * error) keeps the last answer and tries again in a minute; only a definite
 * answer (off, no add-on, a third computer) changes it.
 */
function refreshAddon(force = false): Promise<void> {
  if (addonRefresh) return addonRefresh
  if (!force && Date.now() - addonCheckedAt < 60_000) return Promise.resolve()
  addonCheckedAt = Date.now()
  addonRefresh = (async () => {
    const auth = addonAuth()
    const next = await fetchAddonStatus(auth)
    const temporary = next.state === 'error' && next.error !== 'devices'
    if (addonRetry) clearTimeout(addonRetry)
    addonRetry = temporary && auth ? setTimeout(() => void refreshAddon(true), 60_000) : null
    if (temporary && viaAddon()) return
    const before = addon.state
    const wasUsable = viaAddon()
    addon = next
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_SEND.DICTATION_ACCOUNT_CHANGED)
    if (addon.state !== before || viaAddon() !== wasUsable) {
      console.log(`[Dictation] add-on: ${addon.state}${addon.error ? ` (${addon.error})` : ''}`)
      applyWatcher()
      settingsChanged()
      // Dictation just became usable: load the recording window now so the first hold records
      if (settings().enabled) getPill()
    }
  })().finally(() => {
    addonRefresh = null
  })
  return addonRefresh
}

/** Tell every window (the Dictation page and its header status) to reload the settings. */
function settingsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_SEND.DICTATION_SETTINGS_CHANGED)
  }
}

function settings(): DictationSettings {
  const key = hasKey() || viaAddon()
  return {
    enabled: store.get('enabled') && key,
    hasKey: key,
    ownKey: hasKey(),
    viaAddon: viaAddon(),
    holdKey: store.get('holdKey'),
    model,
    cleanup: store.get('tidy'),
    wordCount: parseMyWords(store.get('words')).hints.length,
    active: store.get('enabled') && key && isExpansionActive(),
    kept: getKeptDictation()?.seconds
  }
}

const DICTATION_APPS = /wispr|superwhisper|macwhisper|voiceink|aqua voice|willow/i

/**
 * Plain-words warnings for the chosen key: another dictation app running
 * (it may listen to the same key), or macOS's own fn action still switched on.
 * We can't read other apps' shortcut settings, so this says "may".
 */
async function keyHint(holdKey: DictationHoldKey): Promise<string | undefined> {
  if (!isMac) return undefined
  const hints: string[] = []
  const apps = (await runMacHelper(['running-apps'], 3000)) as unknown
  const other = Array.isArray(apps)
    ? (apps as Array<{ name?: unknown }>).map((a) => (typeof a.name === 'string' ? a.name : '')).find((n) => DICTATION_APPS.test(n))
    : undefined
  if (other) hints.push(`${other} is running and may use the same key. If both react, pick another key here or in ${other}.`)
  if (holdKey === 'fn') {
    // 0 = Do Nothing; missing or anything else means macOS also acts on fn (emoji, input source, its own dictation)
    const fnAction = await new Promise<string>((resolve) =>
      execFile('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType'], { timeout: 2000 }, (err, out) => resolve(err ? '' : String(out).trim()))
    )
    if (fnAction !== '0') hints.push('So macOS doesn’t also react to fn, set System Settings › Keyboard › “Press fn key to” to “Do Nothing”.')
  }
  return hints.length ? hints.join(' ') : undefined
}

async function settingsWithHint(): Promise<DictationSettings> {
  await refreshAddon()
  const s = settings()
  return s.enabled ? { ...s, hint: await keyHint(s.holdKey) } : s
}

/** Holding the key dictates only while dictation is on (the key is still watched for SnapGrid's double tap). */
function applyWatcher(): void {
  const s = settings()
  setHoldKey(s.holdKey, s.enabled)
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

function showPill(width = PILL_W): void {
  const w = getPill()
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  w.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + wa.height - PILL_H - 28), width, height: PILL_H })
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
  no_key: 'Add your OpenAI key in PeakFlow › Dictation',
  bad_key: 'OpenAI didn’t accept your key',
  network: 'No internet connection',
  no_speech: 'Didn’t hear anything',
  failed: 'Couldn’t turn that into text',
  model_unavailable: 'Couldn’t turn that into text',
  addon_empty: 'Dictation is paused. Top up in PeakFlow › Dictation',
  addon_devices: 'Dictation is already on two other computers',
  addon_daily: 'That’s 3 hours today. Dictation starts again tomorrow',
  addon_off: 'Dictation isn’t on for this licence',
  mic_denied: 'PeakFlow can’t use the microphone',
  mic_none: 'No microphone found'
}

function fail(code: keyof typeof ERROR_TEXT, kept = false): void {
  clearShowTimer()
  recording = false
  busy = false
  const tryAgain = kept && sayTryAgain(code)
  showPill(PILL_ERROR_W)
  state({ phase: 'error', message: tryAgain ? `${ERROR_TEXT[code]}. Try again in PeakFlow › Dictation` : ERROR_TEXT[code] })
  hidePill(tryAgain ? 4500 : 2600)
}

// ─── hold → record → let go → type ───────────────────────────────────────────

function onDown(): void {
  if (recording || busy || !settings().enabled) return
  downAt = Date.now()
  recording = true
  // Recording starts now (nothing said is lost) but the pill waits until this is
  // clearly a hold, so taps and double taps (SnapGrid) never flash it
  clearShowTimer()
  showTimer = setTimeout(() => {
    showTimer = null
    if (recording) showPill()
  }, MIN_HOLD_MS)
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
  clearShowTimer()
  if (Date.now() - downAt < MIN_HOLD_MS) return cancel()
  showPill()
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
function clearShowTimer(): void {
  if (showTimer) clearTimeout(showTimer)
  showTimer = null
}

function cancel(): void {
  clearShowTimer()
  if (maxTimer) clearTimeout(maxTimer)
  maxTimer = null
  recording = false
  sendPill(IPC_SEND.DICTATION_STOP, { send: false })
  state({ phase: 'idle' })
  hidePill()
}

async function onAudio(buf: ArrayBuffer, mime: string): Promise<void> {
  const ctx = await context
  await runClip({ buf, mime, durationMs: releasedAt - downAt + RELEASE_PAD_MS, ctx, at: Date.now() })
}

/** Speech to text, clean-up and typing for one clip (a new recording, or a kept one tried again). */
async function runClip(clip: Clip): Promise<void> {
  const { buf, mime, durationMs, ctx } = clip
  const key = getCredential(CRED_TOOL, CRED_TYPE)
  const words = parseMyWords(store.get('words'))
  const prompt = transcriptionPrompt(words, ctx)
  // Long clips get longer to upload and come back (S11: a fixed 30 s lost long dictations on slow connections)
  const timeoutMs = transcribeTimeoutMs(durationMs)
  let auth = viaAddon() ? addonAuth() : null
  let r = auth
    ? await transcribeViaAddon(new Uint8Array(buf), auth, { mime, prompt, durationMs, timeoutMs: transcribeTimeoutMs(durationMs, 45_000) })
    : await transcribe(new Uint8Array(buf), { key, model, mime, prompt, stream: true, timeoutMs })
  if (auth) void refreshAddon(true)
  // The add-on couldn't do it (switched off, used up, offline …) but they have their own key: don't lose what they said
  if (auth && !r.ok && r.error !== 'no_speech' && key) {
    console.warn(`[Dictation] add-on: ${r.error}${r.detail ? ` (${r.detail})` : ''}; using your own key for this one`)
    auth = null
    r = await transcribe(new Uint8Array(buf), { key, model, mime, prompt, stream: true, timeoutMs })
  }
  if (!auth && r.error === 'model_unavailable' && model !== 'gpt-4o-mini-transcribe') {
    console.warn(`[Dictation] ${model} not available on this key (${r.detail}); using gpt-4o-mini-transcribe`)
    model = 'gpt-4o-mini-transcribe'
    r = await transcribe(new Uint8Array(buf), { key, model, mime, prompt, stream: true, timeoutMs })
  }
  const sttMs = Date.now() - releasedAt
  if (!r.ok || !r.text) {
    if (r.detail) console.warn(`[Dictation] ${r.error}: ${r.detail}`)
    // Keep the audio so nothing said is lost; it can be tried again for 30 minutes
    const kept = keepsClip(r.error)
    keptClip = kept ? { ...clip, at: Date.now() } : null
    settingsChanged()
    return fail(r.error ?? 'failed', kept)
  }
  if (keptClip) {
    keptClip = null
    settingsChanged()
  }
  let text = r.text
  let tidyNote = 'off'
  // With the add-on the clean-up goes through PeakFlow's server too (and is metered there)
  const tidyKey = auth ? 'add-on' : key
  if (store.get('tidy') && tidyKey && !needsTidy(r.text, words)) tidyNote = 'not needed'
  else if (store.get('tidy') && tidyKey) {
    const c = await cleanUp(r.text, { key: tidyKey, words, ctx, ...(auth ? { fetchImpl: addonTidyFetch(auth), timeoutMs: 6000 } : {}) })
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
  state({ phase: ok ? 'done' : 'error', message: ok ? undefined : `Copied: press ${pasteKeys(isMac)} to paste` })
  hidePill(ok ? 500 : 2600)
}

/** A kept clip that can still be tried again: how long it was, in seconds. */
export function getKeptDictation(): { seconds: number } | null {
  if (!keptClip || Date.now() - keptClip.at > KEEP_CLIP_MS) {
    keptClip = null
    return null
  }
  return { seconds: Math.max(1, Math.round(keptClip.durationMs / 1000)) }
}

/**
 * Try the kept clip again and type the result into the app in front. The
 * caller has already put that app back in front (panel or launcher hidden).
 */
export async function retryDictation(): Promise<boolean> {
  const clip = getKeptDictation() ? keptClip : null
  if (!clip || recording || busy) return false
  busy = true
  releasedAt = Date.now()
  showPill()
  state({ phase: 'transcribing' })
  await runClip(clip)
  return true
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
  if (process.env['PEAKFLOW_KEYWATCH_DEBUG'] === '1') console.log(`[Dictation] pasting ${text.length} chars into ${(await readContext()).app ?? 'unknown app'}`)
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
  settingsChanged()
  return { ok: true, settings: settings() }
}

// ─── permissions (the Dictation tool's Allow button) ──────────────────────────

/** Microphone and Accessibility on a Mac; everything is allowed elsewhere. */
function permissions(): DictationPermissions {
  if (!isMac) return { microphone: 'granted', accessibility: true }
  // Development screenshots only: PEAKFLOW_DICTATION_PERMS=granted | no-mic | no-ax (never in packaged builds)
  const fake = app.isPackaged ? undefined : process.env['PEAKFLOW_DICTATION_PERMS']
  if (fake === 'granted' || fake === 'no-mic' || fake === 'no-ax') {
    return { microphone: fake === 'no-mic' ? 'denied' : 'granted', accessibility: fake !== 'no-ax' }
  }
  const mic = systemPreferences.getMediaAccessStatus('microphone')
  const known: MediaStatus[] = ['granted', 'denied', 'not-determined', 'restricted']
  const p: DictationPermissions = { microphone: known.includes(mic as MediaStatus) ? (mic as MediaStatus) : 'unknown', accessibility: checkAccessibility() }
  // Permission granted since the key watcher started without it: restart it now
  if (p.accessibility && store.get('enabled') && !isExpansionActive()) retryExpansion()
  return p
}

/** Ask for the first missing permission: macOS's own prompt if it never asked, otherwise its settings page. */
async function allowNext(): Promise<DictationPermissions> {
  const missing = missingPermission(permissions())
  if (missing === 'accessibility') requestAccessibility()
  else if (missing === 'microphone') {
    if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') await systemPreferences.askForMediaAccess('microphone')
    else openMediaSettings('microphone')
  }
  applyWatcher()
  return permissions()
}

function registerIpc(getLauncherContents: () => Electron.WebContents | undefined): void {
  const h = ipcMain.handle.bind(ipcMain)
  const fromPill = (e: Electron.IpcMainInvokeEvent): boolean => !!pill && !pill.isDestroyed() && e.sender === pill.webContents
  // Settings and paying: the Dictation tool in the panel (and the launcher's own pages)
  const fromUi = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === getLauncherContents() || e.sender === getPanel()?.webContents

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
  h(IPC_INVOKE.DICTATION_ACCOUNT, async (e) => {
    if (!fromUi(e)) return { state: 'hidden' }
    const account = await getDictationAccount()
    // Just bought (the balance shows but dictation doesn't run on it yet): catch up now, not within the minute.
    // One direction only, so a build without buy links (account hidden, add-on usable) can't loop.
    // At most every 10 s, so a server that answers the two requests differently can't keep it busy.
    if ('balanceMicros' in account && !account.disabled && account.blocked !== 'disabled' && !viaAddon() && Date.now() - catchUpAt > 10_000) {
      catchUpAt = Date.now()
      void refreshAddon(true)
    }
    return account
  })
  h(IPC_INVOKE.DICTATION_CHECKOUT, (e, amount: unknown) => fromUi(e) ? openDictationCheckout(amount) : false)
  h(IPC_INVOKE.DICTATION_SETTINGS, () => settingsWithHint())
  h(IPC_INVOKE.DICTATION_PERMISSIONS, () => permissions())
  h(IPC_INVOKE.DICTATION_ALLOW, (e) => (fromUi(e) ? allowNext() : permissions()))
  // "Try again" on the Dictation page: give the app underneath the keyboard back, then type into it
  h(IPC_INVOKE.DICTATION_RETRY, async (e) => {
    if (!fromUi(e) || !getKeptDictation()) return false
    hidePanel()
    await new Promise((r) => setTimeout(r, 400))
    return retryDictation()
  })
  h(IPC_INVOKE.DICTATION_SET, (e, key: unknown, value: unknown) => {
    if (!fromUi(e)) return settings()
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
    settingsChanged()
    return settingsWithHint()
  })
  h(IPC_INVOKE.DICTATION_SAVE_KEY, (e, key: unknown) => (fromUi(e) ? saveKey(key) : { ok: false, error: 'failed', settings: settings() }))
  h(IPC_INVOKE.DICTATION_WORDS, (e) => (fromUi(e) ? store.get('words') : ''))
  h(IPC_INVOKE.DICTATION_SET_WORDS, (e, text: unknown) => {
    if (!fromUi(e) || typeof text !== 'string') return settings()
    store.set('words', text.slice(0, 20_000))
    settingsChanged()
    return settings()
  })
  h(IPC_INVOKE.DICTATION_REMOVE_KEY, (e) => {
    if (!fromUi(e)) return settings()
    deleteCredential(CRED_TOOL, CRED_TYPE)
    // With the add-on, dictation carries on without their own key
    if (!viaAddon()) store.set('enabled', false)
    applyWatcher()
    settingsChanged()
    return settings()
  })
}

export function initDictation(getLauncherContents: () => Electron.WebContents | undefined): void {
  if (!app.isPackaged) allowServerOverride()
  // Development screenshots only: a tiny kept clip (too short to send anywhere, so trying it again ends as "Didn't hear anything")
  if (!app.isPackaged && process.env['PEAKFLOW_DICTATION_KEPT_DEMO'] === '1') keptClip = { buf: new ArrayBuffer(10), mime: 'audio/webm', durationMs: 12_000, ctx: {}, at: Date.now() }
  registerIpc(getLauncherContents)
  onHoldKey((e) => {
    if (e === 'down') onDown()
    else if (e === 'up') onUp()
    else cancel()
  })
  applyWatcher()
  // Load the pill early when dictation is on, so the first hold records straight away
  if (settings().enabled) getPill()
  // Someone with the add-on and no key of their own: dictation turns on once the server says so
  void refreshAddon(true).then(() => {
    if (settings().enabled) getPill()
  })
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
  const frames = process.env['PEAKFLOW_DICTATION_FRAMES'] === '1'
  if (!is.dev || app.isPackaged || (!audioPath && !frames) || !out) return
  mkdirSync(out, { recursive: true })
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  if (frames || !audioPath) return recordPillFrames(join(out, 'frames'))
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

/**
 * Development only: records the pill's animation as numbered PNG frames, using
 * a made-up speech level instead of the microphone (no mic, no keyboard, no API).
 */
async function recordPillFrames(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const w = getPill()
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()))
  await new Promise((r) => setTimeout(r, 600))
  showPill()
  // Syllables at about 4 a second, in phrases with short pauses, then silence
  const level = (t: number): number => {
    if (t < 0.5 || (t > 2.3 && t < 2.8) || t > 4.4) return 0.02
    const syl = Math.pow(Math.max(0, Math.sin(t * Math.PI * 4.2 + Math.sin(t * 3.1))), 1.6)
    return 0.15 + 0.75 * syl * (0.7 + 0.3 * Math.sin(t * 1.7))
  }
  const plan: Array<[number, DictationState]> = [[0, { phase: 'listening' }], [5.2, { phase: 'transcribing' }], [6.6, { phase: 'done' }], [7.3, { phase: 'idle' }]]
  const t0 = Date.now()
  let n = 0
  let step = 0
  while (true) {
    const t = (Date.now() - t0) / 1000
    if (t > 7.6) break
    while (step < plan.length && t >= plan[step][0]) state(plan[step++][1])
    await w.webContents.executeJavaScript(`window.__pfLevel = ${level(t).toFixed(3)}`)
    const img = await w.webContents.capturePage()
    writeFileSync(join(dir, `${String(n++).padStart(4, '0')}-${Math.round(t * 1000)}.png`), img.toPNG())
    await new Promise((r) => setTimeout(r, 12))
  }
  hidePill()
  console.log(`[DictationTest] ${n} pill frames in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${dir}`)
}

export function destroyDictation(): void {
  quitting = true
  if (maxTimer) clearTimeout(maxTimer)
  if (pill && !pill.isDestroyed()) pill.destroy()
}
