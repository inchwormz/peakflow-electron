/**
 * Launcher (the ⌥Space / Alt+Space command bar) types shared by main and the
 * launcher window. The launcher is free: it is not a ToolId and needs no
 * licence. Commands that open a paid tool carry that tool's name as a tag and
 * the tool's own access check still applies.
 */

export type LauncherKind =
  | 'app'
  | 'file'
  | 'setting'
  | 'command'
  | 'tool'
  | 'window'
  | 'link'
  | 'search'
  | 'snippet'
  | 'ai'

/** Glyph names drawn by the launcher (a subset of the panel's icon set plus its own). */
export type LauncherGlyph =
  | 'app' | 'file' | 'folder' | 'settings' | 'power' | 'lock' | 'moon' | 'trash' | 'eject' | 'restart'
  | 'logout' | 'coffee' | 'kill' | 'calc' | 'globe' | 'search' | 'link' | 'text' | 'sparkle' | 'plus'
  | 'focusdim' | 'liquidfocus' | 'screenslap' | 'quickboard' | 'window' | 'keyboard'

export interface LauncherItem {
  /** Stable id, e.g. 'app:/Applications/Safari.app', 'cmd:sleep', 'snip:3' */
  id: string
  kind: LauncherKind
  title: string
  subtitle?: string
  /** Extra words that should find it ("shut down" → "power off", "turn off") */
  keywords?: string[]
  /** A real file or app icon (fetched lazily), else a drawn glyph */
  iconPath?: string
  glyph?: LauncherGlyph
  /** Paid tool name shown as a small label ("QuickBoard"); free items have none */
  tag?: string
  /** Ask before running (restart, shut down, empty the bin) */
  confirm?: string
  /** Opens a view inside the launcher instead of running */
  view?: 'kill' | 'snippet-form' | 'link-form' | 'settings' | 'ai-setup'
  /** Search engines: the keyword that triggers them ('g', 'yt') */
  prefix?: string
  /** Snippets: their keyword and text (searchable; Enter pastes) */
  snippetKeyword?: string
  snippetText?: string
  /** Quick links: where it goes */
  target?: string
}

export interface LauncherRunOptions {
  /** The text typed, for search engines */
  query?: string
  /** ⌘ / Ctrl held (alternate action: reveal a file, copy a snippet) */
  alt?: boolean
}

export interface LauncherRunResult {
  ok: boolean
  /** Short message shown in the bar (e.g. "Keep Awake is on") */
  message?: string
  /** Keep the bar open (toggles that report a state) */
  keepOpen?: boolean
}

export interface LauncherProcess {
  pid: number
  name: string
  /** Resident memory in bytes, the app's helper processes included */
  memory: number
  path?: string
}

export type AiProviderId = 'codex' | 'claude' | 'ollama'

export interface AiProviderStatus {
  id: AiProviderId
  /** What people know it as: ChatGPT, Claude, Local model */
  name: string
  installed: boolean
  signedIn: boolean | null
  /** Ollama: the model it will use */
  model?: string
  detail?: string
  /** light: the smallest model (saves the person's usage); best: their default */
  tier: 'light' | 'best'
}

export interface AiStatus {
  providers: AiProviderStatus[]
  selected: AiProviderId | null
}

/** Ready-made actions on selected text */
export type AiTextAction = 'grammar' | 'rewrite' | 'summarise' | 'translate' | 'explain'

export interface AiAskPayload {
  prompt: string
  /** Omitted: the person's saved choice */
  provider?: AiProviderId
  action?: AiTextAction
  /** Text the action works on (selected text) */
  text?: string
  /** translate: target language */
  language?: string
}

export interface AiChunk {
  reqId: number
  /** The answer so far (whole text, not a delta, so a missed chunk can't garble it) */
  text: string
  done: boolean
  error?: string
}

export interface LauncherSnippet {
  id: string
  keyword: string
  text: string
  name?: string
}

export interface LauncherLink {
  id: string
  name: string
  target: string
}

export interface LauncherSettings {
  hotkey: string
  hotkeyRegistered: boolean
  expansionEnabled: boolean
  /** Snippet expansion is running (has the keyboard permission it needs) */
  expansionActive: boolean
  keepAwake: boolean
}

export interface CurrencyRates {
  base: string
  rates: Record<string, number>
  /** When the feed last updated (ISO), shown when offline */
  updated: string
  stale: boolean
}

export interface SelectionResult {
  text: string
  /** false when the OS permission to read it is missing */
  trusted: boolean
}

export interface LauncherOpenInfo {
  /** ms timestamp when main got the hotkey, for the open-time measurement */
  at: number
  /** Show a view straight away ('ai' for a hotkey that goes to Quick Ask) */
  view?: string
}

// ─── dictation ──────────────────────────────────────────────────────────────

export type DictationHoldKey = 'rcmd' | 'ropt' | 'fn' | 'rctrl' | 'ralt'

export interface DictationSettings {
  enabled: boolean
  hasKey: boolean
  holdKey: DictationHoldKey
  model: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe'
  /** Tidy punctuation and filler words with the person's own ChatGPT/Claude (local-ai) */
  cleanup: boolean
  /** The keyboard watcher is running with the permission it needs */
  active: boolean
}

export interface DictationState {
  phase: 'listening' | 'transcribing' | 'done' | 'error' | 'idle'
  message?: string
}
