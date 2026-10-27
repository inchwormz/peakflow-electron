/**
 * Snippet expansion: type a snippet's keyword in any app and it turns into
 * the saved text.
 *
 *   macOS: the helper's `keywatch` mode (Launcher.swift) watches typing with
 *          the Accessibility permission QuickBoard already asks for, and does
 *          the delete + paste itself. Typed text never leaves the helper.
 *   Windows: a low-level keyboard hook in a PowerShell/C# sidecar reports the
 *          keyword it saw (after deleting it); we paste the text with Ctrl+V
 *          and put the clipboard back. NOT RUN ON WINDOWS YET.
 *
 * The same watcher reports dictation's hold-to-talk key going down and up
 * (setHoldKey / onHoldKey), since Electron's shortcuts only see key presses.
 */

import { fillPlaceholders } from './snippet-text'
import { spawn, type ChildProcess } from 'child_process'
import { clipboard } from 'electron'
import { existsSync } from 'fs'
import type { LauncherSnippet } from '@shared/launcher/types'
import { getMacHelperPath } from '../native/mac-helper'
import { pasteAndRestore } from './selection'
import { checkAccessibility } from '../services/permissions-darwin'
import { KeyTaps } from './key-taps'
import { windowsKeyStateSource } from './windows-key-state'
import type { NativeHoldKey } from '@shared/dictation-key'

let child: ChildProcess | null = null
let active = false
let wanted = false
let current: LauncherSnippet[] = []
let restarts = 0
let snippetsWanted = false
let holdKey: NativeHoldKey | null = null
let commandKey: NativeHoldKey | null = null
let commandListener: ((e: 'down' | 'up' | 'cancel', id: number) => void) | null = null
let commandNativeId: number | null = null
export function onCommandKey(fn: NonNullable<typeof commandListener>): void { commandListener = fn }
export function setCommandKey(key: NativeHoldKey | null): void {
  if (process.platform !== 'darwin') return
  if (JSON.stringify(commandKey) === JSON.stringify(key)) return
  if (commandNativeId !== null) commandListener?.('cancel', commandNativeId)
  commandKey = key
  applyHoldKey()
}
export function acceptCommandKey(): void {
  if (process.platform !== 'darwin' || commandNativeId === null) return
  try { child?.stdin?.write(JSON.stringify({ acceptCommand: commandNativeId }) + '\n') } catch { /* Watcher exit cancels the session. */ }
}
export function endCommandKey(): void {
  if (process.platform !== 'darwin') return
  if (child?.stdin?.writable && commandNativeId !== null) child.stdin.write(JSON.stringify({ endCommand: commandNativeId }) + '\n')
  commandNativeId = null
}
let capturingHoldKey = false
const recordedListeners = new Set<(code: number) => void>()
let dictating = false
let holdListener: ((e: 'down' | 'up' | 'cancel') => void) | null = null
const doubleListeners = new Set<() => void>()
const taps = new KeyTaps()

// Bind a watcher-owned recording identity to Electron's audio identity. Arming is
// local to an eligible key event, then confirmed by Electron after accepting audio.
let mayRecord = false
let nativeEscapeId = 0
let escapeBinding: { native: number; audio: number } | null = null
let escapeListener: ((id: number) => void) | null = null
export function onRecordingEscape(fn: (id: number) => void): void { escapeListener = fn }
/** Availability defaults off, and is replayed when a watcher starts. */
export function setMayRecord(value: boolean): void {
  mayRecord = value
  sendMayRecord()
}
function sendMayRecord(): void {
  if (!child?.stdin?.writable) return
  try {
    if (process.platform === 'darwin') child.stdin.write(JSON.stringify({ mayRecord }) + '\n')
    else child.stdin.write(`MAY-RECORD ${mayRecord ? 1 : 0}\n`)
  } catch { /* A missing watcher must never block audio. */ }
}
export function setRecordingEscape(recording: boolean, id = escapeBinding?.audio): void {
  if (recording) {
    escapeBinding = { native: nativeEscapeId, audio: id! }
    // Never swallow Esc for a speculative press: stale availability or a delayed
    // confirmation can only let Esc pass through, never cancel an unrelated app.
    if (!child?.stdin?.writable) return
    try {
      if (process.platform === 'darwin') child.stdin.write(JSON.stringify({ armEscape: nativeEscapeId }) + '\n')
      else child.stdin.write(`ARM ${nativeEscapeId}\n`)
    } catch { /* Best effort; no acknowledgement wait. */ }
    return
  }
  if (escapeBinding) disarmEscape(escapeBinding.native)
}
function disarmEscape(id: number): void {
  if (!child?.stdin?.writable) return
  try {
    if (process.platform === 'darwin') child.stdin.write(JSON.stringify({ disarmEscape: id }) + '\n')
    else child.stdin.write(`DISARM ${id}\n`)
  } catch { /* Safety net only: a missing or crashed watcher never blocks audio. */ }
}

/** Record physical keys through the same native watcher, including fn and side-specific modifiers. */
export function onHoldKeyRecorded(fn: (code: number) => void): () => void {
  recordedListeners.add(fn)
  return () => { recordedListeners.delete(fn) }
}

export function setHoldKeyCapture(enabled: boolean): void {
  if (enabled) onKey('cancel')
  capturingHoldKey = enabled
  applyHoldKey()
}

export function onHoldKey(fn: (e: 'down' | 'up' | 'cancel') => void): void {
  holdListener = fn
}

/**
 * A quick double tap of the dictation key (SnapGrid's auto-arrange). The key is
 * watched while anything is subscribed, even with dictation off. Returns an unsubscribe.
 */
export function onDictationKeyDouble(fn: () => void): () => void {
  doubleListeners.add(fn)
  applyHoldKey()
  return () => {
    doubleListeners.delete(fn)
    applyHoldKey()
  }
}

/**
 * The validated native dictation key (left/right modifier, fn on Mac, or a function key)
 * and whether a hold dictates. With dictation off the key is still watched for double taps.
 */
export function setHoldKey(key: NativeHoldKey | null, dictate = true): void {
  if (JSON.stringify(holdKey) === JSON.stringify(key) && dictating === dictate) return
  onKey('cancel')
  holdKey = key
  dictating = dictate
  applyHoldKey()
}

/** The key the watcher should report, or null */
function watchedKey(): NativeHoldKey | null {
  return holdKey && (dictating || doubleListeners.size) ? holdKey : null
}

function applyHoldKey(): void {
  taps.reset()
  refreshWanted()
  if (!wanted) return stopExpansion(false)
  if (!child) start()
  else sendHold()
}

function refreshWanted(): void {
  wanted = capturingHoldKey || snippetsWanted || !!watchedKey() || !!commandKey
}

function sendHold(): void {
  if (!child?.stdin?.writable) return
  const key = watchedKey()
  sendMayRecord()
  if (process.platform === 'darwin') child.stdin.write(JSON.stringify({ hold: key, command: commandKey, captureHoldKey: capturingHoldKey, dictate: dictating }) + '\n')
  else {
    child.stdin.write(`DICTATE ${dictating ? 1 : 0}\n`)
    child.stdin.write(`HOLD ${key?.code ?? 0}\n`)
    child.stdin.write(`CAPTURE ${capturingHoldKey ? 1 : 0}\n`)
  }
}

function onKey(e: 'down' | 'up' | 'cancel'): void {
  // Dictation owns double taps while enabled; SnapGrid keeps them while it is off.
  if (dictating) { holdListener?.(e); return }
  for (const a of taps.feed(e, Date.now())) {
    if (a === 'double') doubleListeners.forEach((fn) => fn())
    else if (dictating) holdListener?.(a)
  }
}

export function isExpansionActive(): boolean {
  return active
}


function sendSnippets(): void {
  if (!child?.stdin?.writable) return
  if (process.platform === 'darwin') {
    const map: Record<string, string> = {}
    for (const s of current) if (s.keyword) map[s.keyword] = s.text
    child.stdin.write(JSON.stringify({ snippets: map }) + '\n')
  } else {
    // Keywords only (the hook never needs the text); tab-separated, base64 so any character is safe
    child.stdin.write('SET ' + current.filter((s) => s.keyword).map((s) => Buffer.from(s.keyword, 'utf8').toString('base64')).join(' ') + '\n')
  }
}

async function expandOnWindows(keyword: string): Promise<void> {
  const s = current.find((x) => x.keyword === keyword)
  if (!s) return
  // Pastes, then puts the clipboard back with every format (selection.ts)
  await pasteAndRestore(fillPlaceholders(s.text, () => clipboard.readText()))
}

function onLine(line: string): void {
  try {
    const ev = JSON.parse(line) as { e?: string; trusted?: boolean; keyword?: string; code?: number; sessionId?: number }
    if (ev.e === 'ready') {
      active = ev.trusted !== false
      if (!active) logUntrustedOnce()
      else {
        respawnDelayMs = RESPAWN_MIN_MS // working again: the next kill-and-restart backs off from the minimum
        sendSnippets()
        sendHold()
      }
    } else if (ev.e === 'match' && ev.keyword) {
      void expandOnWindows(ev.keyword)
    } else if (ev.e?.startsWith('hold-') && process.env['PEAKFLOW_KEYWATCH_DEBUG'] === '1') console.log(`[Launcher] keywatch ${ev.e}`)
    if (process.platform === 'darwin' && ev.e?.startsWith('command-') && typeof ev.sessionId === 'number') {
      if (ev.e === 'command-down') commandNativeId = ev.sessionId
      if (ev.sessionId === commandNativeId) commandListener?.(ev.e === 'command-down' ? 'down' : ev.e === 'command-up' ? 'up' : 'cancel', ev.sessionId)
    }
    if (ev.e === 'recording-escape') {
      if (escapeBinding && ev.sessionId === escapeBinding.native) escapeListener?.(escapeBinding.audio)
    }
    if (ev.e === 'hold-key-recorded' && capturingHoldKey && Number.isInteger(ev.code)) {
      capturingHoldKey = false
      recordedListeners.forEach((fn) => fn(ev.code!))
      applyHoldKey()
    } else if (ev.e === 'hold-down') {
      nativeEscapeId = ev.sessionId ?? 0
      onKey('down')
      if (escapeBinding?.native !== nativeEscapeId) disarmEscape(nativeEscapeId)
    }
    else if (ev.e === 'hold-up') onKey('up')
    else if (ev.e === 'hold-cancel') onKey('cancel')
  } catch { /* not ours */ }
}

const WIN_HOOK = `
# No progress records: they reach stderr as CLIXML noise
$ProgressPreference = 'SilentlyContinue'
$src = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

${windowsKeyStateSource()}
public static class PfKeyWatch {
  const int WH_KEYBOARD_LL = 13;
  const int WM_KEYDOWN = 0x0100;
  const int WM_SYSKEYDOWN = 0x0104;
  const uint LLKHF_INJECTED = 0x10;
  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; [FieldOffset(8)] public long pad1; [FieldOffset(16)] public long pad2; [FieldOffset(24)] public long pad3; [FieldOffset(32)] public long pad4; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetKeyState(int vk);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern bool GetKeyboardState(byte[] state);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr pid);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] static extern int ToUnicodeEx(uint vk, uint scan, byte[] state, StringBuilder buf, int size, uint flags, IntPtr layout);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  static HookProc proc = Hook;
  static IntPtr hook = IntPtr.Zero;
  static StringBuilder typed = new StringBuilder();
  static volatile string[] keywords = new string[0];
  static volatile int holdVk = 0;
  static bool captureHoldKey = false;
  static volatile bool recordingEscape = false;
  static bool mayRecord = false, escapeAccepted = false;
  static int escapeId = 0;
  static bool escapeDown = false;
  static bool dictate = false, escapeLocked = false;
  static long escapePressAt = -1, escapeTapUpAt = -1000;
  static bool escapeSecond = false;
  static readonly Stopwatch escapeClock = Stopwatch.StartNew();
  static readonly object keyLock = new object();
  static NativeKeyState keyState = new NativeKeyState();
  static HashSet<uint> PhysicalKeys() {
    HashSet<uint> keys = new HashSet<uint>();
    for (int vk = 8; vk < 256; vk++) {
      // Generic modifier aliases duplicate the side-specific keys.
      if (vk == 0x10 || vk == 0x11 || vk == 0x12) continue;
      if ((GetAsyncKeyState(vk) & 0x8000) != 0) keys.Add((uint)vk);
    }
    return keys;
  }
  static void EmitEvents(List<string> events) {
    foreach (string e in events) {
      if (dictate) {
        long now = escapeClock.ElapsedMilliseconds;
        if (e == "down" && mayRecord) {
          escapePressAt = now;
          escapeSecond = now - escapeTapUpAt <= 400;
          if (!escapeLocked) { escapeId++; escapeAccepted = false; recordingEscape = false; }
        } else if (e == "cancel") {
          escapePressAt = -1; escapeTapUpAt = -1000;
          if (!escapeLocked) recordingEscape = false;
        } else if (e == "up" && escapePressAt >= 0) {
          bool tap = now - escapePressAt < 300;
          escapePressAt = -1;
          if (escapeLocked) {
            if (tap) { escapeLocked = false; recordingEscape = false; escapeTapUpAt = -1000; }
          } else if (tap && escapeSecond && escapeAccepted) {
            escapeLocked = true; recordingEscape = true; escapeTapUpAt = -1000;
          } else { recordingEscape = false; escapeTapUpAt = tap ? now : -1000; }
        }
      }
      EmitSession("hold-" + e);
    }
  }
  static bool IsModifier(uint vk) { return (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C; }
  static bool IsAllowedHold(int vk) { return IsModifier((uint)vk) || (vk >= 0x70 && vk <= 0x87); }
  const int WM_KEYUP = 0x0101;
  const int WM_SYSKEYUP = 0x0105;

  static void Emit(string e) { Console.Out.WriteLine("{\\"e\\":\\"" + e + "\\"}"); Console.Out.Flush(); }

  static void EmitSession(string e) { Console.Out.WriteLine("{\\"e\\":\\"" + e + "\\",\\"sessionId\\":" + escapeId + "}"); Console.Out.Flush(); }

  static void Backspaces(int n) {
    INPUT[] inputs = new INPUT[n * 2];
    for (int i = 0; i < n; i++) {
      inputs[i * 2].type = 1; inputs[i * 2].ki.wVk = 0x08;
      inputs[i * 2 + 1].type = 1; inputs[i * 2 + 1].ki.wVk = 0x08; inputs[i * 2 + 1].ki.dwFlags = 2;
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  static void Tap(ushort vk) {
    INPUT[] inputs = new INPUT[2];
    inputs[0].type = 1; inputs[0].ki.wVk = vk;
    inputs[1].type = 1; inputs[1].ki.wVk = vk; inputs[1].ki.dwFlags = 2;
    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
    try {
      if (nCode >= 0) {
        KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        bool isDown = (int)wParam == WM_KEYDOWN || (int)wParam == WM_SYSKEYDOWN;
        bool isUp = (int)wParam == WM_KEYUP || (int)wParam == WM_SYSKEYUP;
        if ((k.flags & LLKHF_INJECTED) == 0) {
          lock (keyLock) {
            if (k.vkCode == 27) {
              if (isDown && (recordingEscape || escapeDown)) {
                if (!escapeDown) { escapeDown = true; recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = -1; escapeTapUpAt = -1000; EmitSession("recording-escape"); }
                return new IntPtr(1);
              }
              if (isUp && escapeDown) { escapeDown = false; return new IntPtr(1); }
            }
            HashSet<uint> physical = PhysicalKeys();
            bool otherModifier = false;
            foreach (uint other in physical) {
              if (IsModifier(other) && other != k.vkCode && !(holdVk == 0xA5 && other == 0xA2)) otherModifier = true;
            }
            // KBDLLHOOKSTRUCT has no repeat bit (unlike WM_KEYDOWN lParam).
            // Async state still describes the previous state for this key here.
            // The state machine also retains observed presses and the capture-start snapshot.
            bool repeat = isDown && physical.Contains(k.vkCode);
            // AltGr's fake Left Ctrl is not a chord or snippet input.
            bool altGrCompanion = !captureHoldKey && holdVk == 0xA5 && k.vkCode == 0xA2 && (k.scanCode & 0x200) != 0;
            NativeKeyResult result = keyState.Feed(k.vkCode, isDown && !altGrCompanion, isUp, repeat,
              IsModifier(k.vkCode), !IsModifier(k.vkCode), otherModifier, physical);
            EmitEvents(result.events);
            if (result.recorded >= 0) {
              captureHoldKey = false;
              Console.Out.WriteLine("{\\"e\\":\\"hold-key-recorded\\",\\"code\\":" + result.recorded + "}");
              Console.Out.Flush();
            }
            if (result.events.Contains("down") && (holdVk == 0xA4 || holdVk == 0xA5 || holdVk == 0x5B || holdVk == 0x5C)) ThreadPool.QueueUserWorkItem(delegate { Tap(0xE8); });
            if (result.swallow) return new IntPtr(1);
            // Preserve AltGr's synthetic Ctrl without cancelling the Right Alt hold.
            if (isDown && !altGrCompanion) Handle(k);
          }
        }
      }
    } catch (Exception ex) { Console.Error.WriteLine("hook error: " + ex.Message); }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }

  static void Handle(KBDLLHOOKSTRUCT k) {
    bool ctrl = (GetKeyState(0x11) & 0x8000) != 0;
    bool win = (GetKeyState(0x5B) & 0x8000) != 0 || (GetKeyState(0x5C) & 0x8000) != 0;
    if (ctrl || win) { typed.Length = 0; return; }
    if (k.vkCode == 0x08) { if (typed.Length > 0) typed.Length -= 1; return; }
    if (k.vkCode == 0x0D || k.vkCode == 0x09 || k.vkCode == 0x1B || (k.vkCode >= 0x21 && k.vkCode <= 0x28)) { typed.Length = 0; return; }
    byte[] state = new byte[256];
    GetKeyboardState(state);
    if ((GetKeyState(0x10) & 0x8000) != 0) state[0x10] = 0x80;
    if ((GetKeyState(0x14) & 1) != 0) state[0x14] = 1;
    uint thread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    StringBuilder buf = new StringBuilder(8);
    int n = ToUnicodeEx(k.vkCode, k.scanCode, state, buf, 8, 4, GetKeyboardLayout(thread));
    if (n <= 0) return;
    typed.Append(buf.ToString(0, n));
    if (typed.Length > 64) typed.Remove(0, typed.Length - 64);
    string t = typed.ToString();
    string best = null;
    foreach (string kw in keywords) { if (kw.Length > 0 && t.EndsWith(kw, StringComparison.Ordinal) && (best == null || kw.Length > best.Length)) best = kw; }
    if (best == null) return;
    typed.Length = 0;
    string match = best;
    ThreadPool.QueueUserWorkItem(delegate {
      Thread.Sleep(30);
      Backspaces(match.Length);
      Thread.Sleep(30);
      Console.Out.WriteLine("{\\"e\\":\\"match\\",\\"keyword\\":\\"" + match.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"}");
      Console.Out.Flush();
    });
  }

  public static void Run() {
    Thread reader = new Thread(delegate () {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        if (line.StartsWith("HOLD ")) {
          int vk = 0;
          int.TryParse(line.Substring(5).Trim(), out vk);
          lock (keyLock) {
            holdVk = IsAllowedHold(vk) ? vk : 0;
            EmitEvents(keyState.Configure(holdVk, captureHoldKey, PhysicalKeys()));
          }
        } else if (line.StartsWith("DICTATE ")) {
          lock (keyLock) {
            bool enabled = line.Substring(8).Trim() == "1";
            if (dictate != enabled) {
              dictate = enabled;
              recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = -1; escapeTapUpAt = -1000;
            }
          }
        } else if (line.StartsWith("MAY-RECORD ")) {
          lock (keyLock) {
            mayRecord = line.Substring(11).Trim() == "1";
            if (!mayRecord) {
              recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = -1; escapeTapUpAt = -1000;
            }
          }
        } else if (line.StartsWith("ARM ")) {
          lock (keyLock) {
            int id;
            if (int.TryParse(line.Substring(4).Trim(), out id) && id == escapeId && mayRecord && dictate && (escapePressAt >= 0 || escapeLocked)) {
              escapeAccepted = true; recordingEscape = true;
            }
          }
        } else if (line.StartsWith("DISARM ")) {
          lock (keyLock) {
            int id;
            if (int.TryParse(line.Substring(7).Trim(), out id) && id == escapeId) {
              recordingEscape = false; escapeAccepted = false; escapeLocked = false; escapePressAt = -1;
            }
          }
        } else if (line.StartsWith("CAPTURE ")) {
          lock (keyLock) {
            captureHoldKey = line.Substring(8).Trim() == "1";
            EmitEvents(keyState.Configure(holdVk, captureHoldKey, PhysicalKeys()));
          }
        } else if (line.StartsWith("SET")) {
          List<string> list = new List<string>();
          foreach (string part in line.Substring(3).Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)) {
            try { list.Add(Encoding.UTF8.GetString(Convert.FromBase64String(part))); } catch (Exception ex) { Console.Error.WriteLine("bad keyword: " + ex.Message); }
          }
          keywords = list.ToArray();
        }
      }
      Environment.Exit(0);
    });
    reader.IsBackground = true;
    reader.Start();
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName), 0);
    Console.Out.WriteLine(hook == IntPtr.Zero ? "{\\"e\\":\\"ready\\",\\"trusted\\":false}" : "{\\"e\\":\\"ready\\",\\"trusted\\":true}");
    Console.Out.Flush();
    Application.Run();
  }
}
"@
try {
  Add-Type -TypeDefinition $src -ReferencedAssemblies System,System.Core,System.Windows.Forms -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine("Add-Type failed: " + $_.Exception.Message)
  exit 1
}
[PfKeyWatch]::Run()
`

/** macOS: retry until Accessibility is trusted, so the watcher starts once it is switched on (no reopen needed). */
let trustRetry: ReturnType<typeof setTimeout> | null = null
const TRUST_RETRY_MS = 3000

/** Set once per app session: the untrusted message is logged once, not on every retry. */
const UNTRUSTED_LOG = '[Launcher] Hold key and snippets need the Accessibility permission (not trusted)'
let loggedUntrusted = false
function logUntrustedOnce(): void {
  if (loggedUntrusted) return
  loggedUntrusted = true
  console.warn(UNTRUSTED_LOG)
}

/** A crash restart waiting to run; cleared whenever the watcher is stopped on purpose. */
let crashRestart: ReturnType<typeof setTimeout> | null = null

/** Respawn backoff for retryExpansion's kill-and-restart (min 10 s, doubling, max 5 min). */
const RESPAWN_MIN_MS = 10_000
const RESPAWN_MAX_MS = 5 * 60_000
let respawnDelayMs = RESPAWN_MIN_MS
let respawnNotBefore = 0

function scheduleTrustRetry(): void {
  if (trustRetry || !wanted) return
  trustRetry = setTimeout(() => {
    trustRetry = null
    if (wanted && !child) start()
  }, TRUST_RETRY_MS)
}

function start(): void {
  if (child || !wanted) return
  if (process.platform === 'darwin') {
    if (!checkAccessibility()) { logUntrustedOnce(); scheduleTrustRetry(); return } // starts once permission is granted
    const bin = getMacHelperPath()
    if (!existsSync(bin)) return
    child = spawn(bin, ['keywatch'], { stdio: ['pipe', 'pipe', 'pipe'] })
  } else if (process.platform === 'win32') {
    const encoded = Buffer.from(WIN_HOOK, 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  } else return
  escapeBinding = null
  nativeEscapeId = 0
  const c = child
  let buf = ''
  c.stdout?.on('data', (d: Buffer) => {
    if (child !== c) return
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (l) onLine(l)
    }
  })
  c.stderr?.on('data', (d: Buffer) => {
    // PowerShell writes progress and some host messages to stderr as CLIXML: not errors
    const t = d.toString().trim()
    if (t && !t.startsWith('#< CLIXML') && !t.startsWith('<Objs')) console.warn('[Launcher] keywatch:', t.slice(0, 300))
  })
  c.stdin?.on('error', () => {})
  c.on('exit', (code) => {
    // Only the current child may change state. A child we stopped on purpose (or replaced) has already been cleared.
    if (child !== c) return
    if (process.platform === 'darwin' && commandNativeId !== null) commandListener?.('cancel', commandNativeId)
    child = null
    active = false
    // Restart after a crash (not after we stopped it), a few times at most
    if (wanted && code !== 0 && restarts++ < 3) {
      if (crashRestart) clearTimeout(crashRestart)
      crashRestart = setTimeout(() => {
        crashRestart = null
        start()
      }, 2000)
    }
  })
}

/** Turn expansion on/off and give it the current snippets. Safe to call often. */
export function updateExpansion(enabled: boolean, snippets: LauncherSnippet[]): void {
  snippetsWanted = enabled && snippets.some((s) => s.keyword)
  // Expansion off: the watcher may still run for dictation, with no keywords
  current = snippetsWanted ? snippets : []
  refreshWanted()
  if (!wanted) return stopExpansion(false)
  if (!child) start()
  else sendSnippets()
}

/** The bar opened: if permission was granted since, start now. */
export function retryExpansion(): void {
  if (wanted && !child) {
    restarts = 0
    start()
  } else if (wanted && child && !active && process.platform === 'darwin' && checkAccessibility()) {
    // Running without permission: restart it so the new permission takes effect.
    // Backed off, so repeated calls cannot respawn the helper in a loop.
    if (Date.now() < respawnNotBefore) return
    respawnNotBefore = Date.now() + respawnDelayMs
    respawnDelayMs = Math.min(respawnDelayMs * 2, RESPAWN_MAX_MS)
    stopExpansion(true)
    start()
  }
}

export function stopExpansion(keepWanted = false): void {
  if (process.platform === 'darwin' && commandNativeId !== null) commandListener?.('cancel', commandNativeId)
  if (!keepWanted) wanted = false
  if (!wanted && trustRetry) { clearTimeout(trustRetry); trustRetry = null }
  if (crashRestart) { clearTimeout(crashRestart); crashRestart = null }
  const c = child
  child = null
  active = false
  if (c) {
    try {
      c.stdin?.end()
    } catch { /* gone */ }
    c.kill()
  }
}
