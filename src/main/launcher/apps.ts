/**
 * Installed apps and system settings pages for the launcher.
 *   macOS: .app bundles in /Applications (and its subfolders), ~/Applications
 *          and the system app folders; settings via x-apple.systempreferences links.
 *   Windows: Start menu shortcuts (all users + this user); settings via ms-settings: links.
 * The list is rebuilt in the background when it's more than a minute old.
 */

import { readdir, realpath } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, join } from 'path'
import type { LauncherItem } from '@shared/launcher/types'

const isMac = process.platform === 'darwin'

let apps: LauncherItem[] = []
let builtAt = 0
let building: Promise<void> | null = null

/** Extra words people type for an app ("settings" for System Settings). */
const APP_KEYWORDS: Record<string, string[]> = {
  'System Settings': ['preferences', 'system preferences', 'control panel'],
  'Activity Monitor': ['task manager', 'processes'],
  'Visual Studio Code': ['vscode', 'code'],
  'Google Chrome': ['chrome', 'browser'],
  Safari: ['browser'],
  Terminal: ['shell', 'command line'],
  'App Store': ['store'],
  Calculator: ['calc'],
  'Microsoft Edge': ['edge', 'browser']
}

async function macApps(): Promise<LauncherItem[]> {
  const home = homedir()
  const roots = ['/Applications', '/System/Applications', join(home, 'Applications')]
  const found = new Map<string, string>()
  const add = (path: string): void => {
    const name = basename(path, '.app')
    if (!found.has(name)) found.set(name, path)
  }
  const scan = async (dir: string, depth: number): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        if (e.name.startsWith('.')) return
        const p = join(dir, e.name)
        if (e.name.endsWith('.app')) add(p)
        else if (depth > 0 && (e.isDirectory() || e.isSymbolicLink())) await scan(p, depth - 1)
      })
    )
  }
  await Promise.all(roots.map((r) => scan(r, 2)))
  add('/System/Library/CoreServices/Finder.app')
  // Icons come from the real bundle: Safari and other Cryptex apps are symlinks, whose icon is blank
  return Promise.all(
    [...found.entries()].map(async ([name, path]) => ({
      id: `app:${path}`,
      kind: 'app' as const,
      title: name,
      subtitle: path.startsWith('/System') ? 'System app' : undefined,
      keywords: APP_KEYWORDS[name],
      iconPath: await realpath(path).catch(() => path)
    }))
  )
}

const SKIP_SHORTCUT = /uninstall|readme|help|documentation|release notes|website|license|eula/i

async function winApps(): Promise<LauncherItem[]> {
  const roots = [
    join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ]
  const found = new Map<string, string>()
  const scan = async (dir: string, depth: number): Promise<void> => {
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        const p = join(dir, e.name)
        if (e.isDirectory() && depth > 0) return scan(p, depth - 1)
        const ext = extname(e.name).toLowerCase()
        if (ext !== '.lnk' && ext !== '.url' && ext !== '.appref-ms') return
        const name = basename(e.name, extname(e.name))
        if (SKIP_SHORTCUT.test(name)) return
        if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), p)
      })
    )
  }
  await Promise.all(roots.map((r) => scan(r, 3)))
  return [...found.values()].map((path) => {
    const name = basename(path, extname(path))
    return { id: `app:${path}`, kind: 'app' as const, title: name, keywords: APP_KEYWORDS[name], iconPath: path }
  })
}

function rebuild(): Promise<void> {
  if (!building) {
    const t0 = Date.now()
    building = (isMac ? macApps() : process.platform === 'win32' ? winApps() : Promise.resolve([]))
      .then((list) => {
        apps = list.sort((a, b) => a.title.localeCompare(b.title))
        builtAt = Date.now()
        console.log(`[Launcher] Indexed ${apps.length} apps in ${builtAt - t0} ms`)
      })
      .catch((err) => console.warn('[Launcher] App index failed:', err))
      .finally(() => {
        building = null
      })
  }
  return building
}

/** Apps now (refreshes in the background when stale). Waits only for the very first index. */
export async function getApps(): Promise<LauncherItem[]> {
  if (!builtAt) await rebuild()
  else if (Date.now() - builtAt > 60_000) void rebuild()
  return apps
}

export function isIndexedApp(path: string): boolean {
  return apps.some((a) => a.id === `app:${path}`)
}

// ─── settings pages ──────────────────────────────────────────────────────────

const MAC_SETTINGS: Array<[string, string, string[]?]> = [
  ['Wi-Fi', 'com.apple.wifi-settings-extension', ['wifi', 'wireless', 'internet']],
  ['Bluetooth', 'com.apple.BluetoothSettings'],
  ['Network', 'com.apple.Network-Settings.extension', ['internet', 'vpn']],
  ['Displays', 'com.apple.Displays-Settings.extension', ['screen', 'monitor', 'resolution', 'brightness']],
  ['Sound', 'com.apple.Sound-Settings.extension', ['volume', 'audio', 'speakers', 'microphone']],
  ['Notifications', 'com.apple.Notifications-Settings.extension'],
  ['Focus', 'com.apple.Focus-Settings.extension', ['do not disturb', 'dnd']],
  ['Battery', 'com.apple.Battery-Settings.extension', ['power', 'energy']],
  ['Keyboard', 'com.apple.Keyboard-Settings.extension', ['shortcuts', 'input']],
  ['Trackpad', 'com.apple.Trackpad-Settings.extension'],
  ['Mouse', 'com.apple.Mouse-Settings.extension'],
  ['Privacy & Security', 'com.apple.settings.PrivacySecurity.extension', ['permissions', 'privacy', 'security']],
  ['Accessibility', 'com.apple.Accessibility-Settings.extension'],
  ['Desktop & Dock', 'com.apple.Desktop-Settings.extension', ['dock', 'mission control', 'hot corners']],
  ['Wallpaper', 'com.apple.Wallpaper-Settings.extension', ['background']],
  ['Appearance', 'com.apple.Appearance-Settings.extension', ['dark mode', 'light mode', 'theme']],
  ['Software Update', 'com.apple.Software-Update-Settings.extension', ['update', 'upgrade macos']],
  ['Storage', 'com.apple.settings.Storage', ['disk space', 'free space']],
  ['Login Items', 'com.apple.LoginItems-Settings.extension', ['startup', 'open at login']],
  ['Users & Groups', 'com.apple.Users-Groups-Settings.extension', ['accounts']],
  ['Date & Time', 'com.apple.Date-Time-Settings.extension', ['clock', 'time zone']],
  ['Printers & Scanners', 'com.apple.Print-Scan-Settings.extension', ['printer']],
  ['Screen Time', 'com.apple.Screen-Time-Settings.extension'],
  ['Lock Screen', 'com.apple.Lock-Screen-Settings.extension', ['screen saver']],
  ['Passwords', 'com.apple.Passwords-Settings.extension'],
  ['Sharing', 'com.apple.Sharing-Settings.extension', ['airdrop', 'screen sharing']]
]

const WIN_SETTINGS: Array<[string, string, string[]?]> = [
  ['Wi-Fi', 'network-wifi', ['wifi', 'wireless', 'internet']],
  ['Bluetooth & devices', 'bluetooth', ['bluetooth']],
  ['Network & internet', 'network', ['internet', 'vpn']],
  ['Display', 'display', ['screen', 'monitor', 'resolution', 'brightness']],
  ['Sound', 'sound', ['volume', 'audio', 'speakers', 'microphone']],
  ['Notifications', 'notifications'],
  ['Focus', 'quiethours', ['do not disturb']],
  ['Power & battery', 'powersleep', ['battery', 'sleep', 'energy']],
  ['Keyboard', 'keyboard', ['typing', 'input']],
  ['Mouse', 'mousetouchpad', ['touchpad']],
  ['Privacy & security', 'privacy', ['permissions', 'security']],
  ['Accessibility', 'easeofaccess'],
  ['Personalisation', 'personalization', ['wallpaper', 'background', 'theme', 'dark mode']],
  ['Taskbar', 'taskbar'],
  ['Windows Update', 'windowsupdate', ['update']],
  ['Storage', 'storagesense', ['disk space', 'free space']],
  ['Startup apps', 'startupapps', ['login items', 'startup']],
  ['Installed apps', 'appsfeatures', ['uninstall', 'apps & features', 'programs']],
  ['Default apps', 'defaultapps'],
  ['Accounts', 'yourinfo', ['users']],
  ['Date & time', 'dateandtime', ['clock', 'time zone']],
  ['Printers & scanners', 'printers', ['printer']],
  ['About this PC', 'about', ['system info', 'specs']]
]

export function settingsItems(): LauncherItem[] {
  const list = isMac ? MAC_SETTINGS : process.platform === 'win32' ? WIN_SETTINGS : []
  return list.map(([title, pane, keywords]) => ({
    id: `setting:${pane}`,
    kind: 'setting' as const,
    title,
    subtitle: isMac ? 'System Settings' : 'Settings',
    keywords: ['settings', ...(keywords ?? [])],
    glyph: 'settings' as const
  }))
}

/** The URL that opens a settings page, or null for an id we didn't make. */
export function settingsUrl(id: string): string | null {
  const pane = id.replace(/^setting:/, '')
  if (isMac && MAC_SETTINGS.some((s) => s[1] === pane)) return `x-apple.systempreferences:${pane}`
  if (process.platform === 'win32' && WIN_SETTINGS.some((s) => s[1] === pane)) return `ms-settings:${pane}`
  return null
}
