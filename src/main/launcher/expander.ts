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

import { spawn, type ChildProcess } from 'child_process'
import { clipboard } from 'electron'
import { existsSync } from 'fs'
import type { LauncherSnippet } from '@shared/launcher/types'
import { getMacHelperPath } from '../native/mac-helper'
import { simulateCtrlV } from '../native/keyboard'
import { checkAccessibility } from '../services/permissions-darwin'

let child: ChildProcess | null = null
let active = false
let wanted = false
let current: LauncherSnippet[] = []
let restarts = 0
let snippetsWanted = false
let holdKey: string | null = null
let holdListener: ((e: 'down' | 'up' | 'cancel') => void) | null = null

/** Windows virtual-key codes for the hold keys */
const WIN_HOLD_VK: Record<string, number> = { rctrl: 0xa3, ralt: 0xa5 }

export function onHoldKey(fn: (e: 'down' | 'up' | 'cancel') => void): void {
  holdListener = fn
}

/** The dictation key to watch ('rcmd' | 'ropt' | 'rctrl' | 'fn' on Mac, 'rctrl' | 'ralt' on Windows), or null for none. */
export function setHoldKey(key: string | null): void {
  holdKey = key
  refreshWanted()
  if (!wanted) return stopExpansion(false)
  if (!child) start()
  else sendHold()
}

function refreshWanted(): void {
  wanted = snippetsWanted || !!holdKey
}

function sendHold(): void {
  if (!child?.stdin?.writable) return
  if (process.platform === 'darwin') child.stdin.write(JSON.stringify({ hold: holdKey }) + '\n')
  else child.stdin.write(`HOLD ${holdKey ? WIN_HOLD_VK[holdKey] ?? 0 : 0}\n`)
}

export function isExpansionActive(): boolean {
  return active
}

function fillPlaceholders(text: string): string {
  const now = new Date()
  return text
    .replace(/\{date\}/g, now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))
    .replace(/\{time\}/g, now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{clipboard\}/g, clipboard.readText())
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
  const before = clipboard.readText()
  clipboard.writeText(fillPlaceholders(s.text))
  await simulateCtrlV()
  setTimeout(() => clipboard.writeText(before), 400)
}

function onLine(line: string): void {
  try {
    const ev = JSON.parse(line) as { e?: string; trusted?: boolean; keyword?: string }
    if (ev.e === 'ready') {
      active = ev.trusted !== false
      if (!active) console.warn('[Launcher] Snippet expansion needs the Accessibility permission')
      else {
        sendSnippets()
        sendHold()
      }
    } else if (ev.e === 'match' && ev.keyword) {
      void expandOnWindows(ev.keyword)
    } else if (ev.e === 'hold-down') holdListener?.('down')
    else if (ev.e === 'hold-up') holdListener?.('up')
    else if (ev.e === 'hold-cancel') holdListener?.('cancel')
  } catch { /* not ours */ }
}

const WIN_HOOK = `
$src = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

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
  static bool holdDown = false;
  const int WM_KEYUP = 0x0101;
  const int WM_SYSKEYUP = 0x0105;

  static void Emit(string e) { Console.Out.WriteLine("{\\"e\\":\\"" + e + "\\"}"); Console.Out.Flush(); }

  static void Backspaces(int n) {
    INPUT[] inputs = new INPUT[n * 2];
    for (int i = 0; i < n; i++) {
      inputs[i * 2].type = 1; inputs[i * 2].ki.wVk = 0x08;
      inputs[i * 2 + 1].type = 1; inputs[i * 2 + 1].ki.wVk = 0x08; inputs[i * 2 + 1].ki.dwFlags = 2;
    }
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
    try {
      if (nCode >= 0) {
        KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        bool isDown = (int)wParam == WM_KEYDOWN || (int)wParam == WM_SYSKEYDOWN;
        bool isUp = (int)wParam == WM_KEYUP || (int)wParam == WM_SYSKEYUP;
        if ((k.flags & LLKHF_INJECTED) == 0) {
          if (holdVk != 0 && k.vkCode == (uint)holdVk) {
            if (isDown && !holdDown) { holdDown = true; Emit("hold-down"); }
            else if (isUp && holdDown) { holdDown = false; Emit("hold-up"); }
          } else if (isDown) {
            if (holdDown) { holdDown = false; Emit("hold-cancel"); }
            Handle(k);
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
          holdVk = vk;
          holdDown = false;
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
  Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine("Add-Type failed: " + $_.Exception.Message)
  exit 1
}
[PfKeyWatch]::Run()
`

function start(): void {
  if (child || !wanted) return
  if (process.platform === 'darwin') {
    if (!checkAccessibility()) return // started on the next open once permission is granted
    const bin = getMacHelperPath()
    if (!existsSync(bin)) return
    child = spawn(bin, ['keywatch'], { stdio: ['pipe', 'pipe', 'pipe'] })
  } else if (process.platform === 'win32') {
    const encoded = Buffer.from(WIN_HOOK, 'utf16le').toString('base64')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  } else return
  const c = child
  let buf = ''
  c.stdout?.on('data', (d: Buffer) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (l) onLine(l)
    }
  })
  c.stderr?.on('data', (d: Buffer) => console.warn('[Launcher] keywatch:', d.toString().trim().slice(0, 300)))
  c.stdin?.on('error', () => {})
  c.on('exit', (code) => {
    if (child === c) child = null
    active = false
    // Restart after a crash (not after we stopped it), a few times at most
    if (wanted && code !== 0 && restarts++ < 3) setTimeout(start, 2000)
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
    // Running without permission: restart it so the new permission takes effect
    stopExpansion(true)
    start()
  }
}

export function stopExpansion(keepWanted = false): void {
  if (!keepWanted) wanted = false
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
