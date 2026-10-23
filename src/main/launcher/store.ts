/**
 * The launcher's saved settings, snippets, quick links and "most used" counts
 * (config-launcher.json). Its own store: the launcher isn't a ToolId.
 */

import Store from 'electron-store'
import type { LauncherLink, LauncherSnippet } from '@shared/launcher/types'
import type { Usage } from '@shared/launcher/rank'

export const DEFAULT_LAUNCHER_HOTKEY = 'Alt+Space'

/**
 * Snippet expansion starts off on Windows: its system-wide keyboard hook has
 * not had a real Windows run yet (review B6). The customer turns it on in
 * Launcher Settings; the hook starts only then, and only with a snippet.
 */
export const defaultExpansion = (platform: string): boolean => platform !== 'win32'

interface LauncherData {
  hotkey: string
  expansion: boolean
  snippets: LauncherSnippet[]
  links: LauncherLink[]
  usage: Record<string, Usage>
  seeded: boolean
}

let store: Store<LauncherData> | null = null

function s(): Store<LauncherData> {
  if (!store) {
    store = new Store<LauncherData>({
      name: 'config-launcher',
      clearInvalidConfig: true,
      defaults: { hotkey: DEFAULT_LAUNCHER_HOTKEY, expansion: defaultExpansion(process.platform), snippets: [], links: [], usage: {}, seeded: false }
    })
    // Two examples on first run, so snippets make sense the first time you look
    if (!store.get('seeded')) {
      store.set('snippets', [
        { id: 's-date', keyword: ';date', text: '{date}', name: "Today's date" },
        { id: 's-shrug', keyword: ';shrug', text: '¯\\_(ツ)_/¯', name: 'Shrug' }
      ])
      store.set('seeded', true)
    }
  }
  return store
}

export const launcherStore = {
  get hotkey(): string {
    return s().get('hotkey')
  },
  set hotkey(v: string) {
    s().set('hotkey', v)
  },
  get expansion(): boolean {
    return s().get('expansion')
  },
  set expansion(v: boolean) {
    s().set('expansion', v)
  },
  snippets(): LauncherSnippet[] {
    return s().get('snippets')
  },
  setSnippets(v: LauncherSnippet[]): void {
    s().set('snippets', v)
  },
  links(): LauncherLink[] {
    return s().get('links')
  },
  setLinks(v: LauncherLink[]): void {
    s().set('links', v)
  },
  usage(): Record<string, Usage> {
    return s().get('usage')
  },
  recordUse(id: string): void {
    const u = { ...s().get('usage') }
    const prev = u[id]
    u[id] = { n: (prev?.n ?? 0) + 1, at: Date.now() }
    // Keep the 400 most recent, so the file stays small
    const ids = Object.keys(u)
    if (ids.length > 400) {
      ids.sort((a, b) => u[a].at - u[b].at).slice(0, ids.length - 400).forEach((k) => delete u[k])
    }
    s().set('usage', u)
  }
}
