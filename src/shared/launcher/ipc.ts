/** Launcher IPC channels. Spread into IPC_INVOKE / IPC_SEND so the preload allows them. */

export const LAUNCHER_INVOKE = {
  LAUNCHER_READY: 'launcher:ready',
  LAUNCHER_ITEMS: 'launcher:items',
  LAUNCHER_USAGE: 'launcher:usage',
  LAUNCHER_RUN: 'launcher:run',
  LAUNCHER_FILES: 'launcher:files',
  LAUNCHER_ICON: 'launcher:icon',
  LAUNCHER_HIDE: 'launcher:hide',
  LAUNCHER_RESIZE: 'launcher:resize',
  LAUNCHER_COPY: 'launcher:copy',
  LAUNCHER_PROCESSES: 'launcher:processes',
  LAUNCHER_QUIT_PROCESS: 'launcher:quit-process',
  LAUNCHER_RATES: 'launcher:rates',
  LAUNCHER_SAVE_SNIPPET: 'launcher:save-snippet',
  LAUNCHER_DELETE_SNIPPET: 'launcher:delete-snippet',
  LAUNCHER_SAVE_LINK: 'launcher:save-link',
  LAUNCHER_DELETE_LINK: 'launcher:delete-link',
  LAUNCHER_SETTINGS: 'launcher:settings',
  LAUNCHER_SET_SETTING: 'launcher:set-setting',
  LAUNCHER_AI_STATUS: 'launcher:ai-status',
  LAUNCHER_AI_SET_PROVIDER: 'launcher:ai-set-provider',
  LAUNCHER_AI_SET_TIER: 'launcher:ai-set-tier',
  LAUNCHER_AI_ASK: 'launcher:ai-ask',
  LAUNCHER_AI_CANCEL: 'launcher:ai-cancel',
  LAUNCHER_AI_CONNECT: 'launcher:ai-connect',
  /** Open the launcher on its Connect AI screen (QuickBoard's Connect button) */
  LAUNCHER_AI_OPEN_SETUP: 'launcher:ai-open-setup',
  LAUNCHER_SELECTION: 'launcher:selection',
  // Dictation (hold a key, talk, let go)
  DICTATION_READY: 'dictation:ready',
  /** The pill sends the recorded audio (ArrayBuffer, mime) */
  DICTATION_AUDIO: 'dictation:audio',
  /** The pill couldn't open the microphone ('denied' | 'none' | 'failed') */
  DICTATION_MIC_ERROR: 'dictation:mic-error',
  DICTATION_ACCOUNT: 'dictation:account',
  DICTATION_CHECKOUT: 'dictation:checkout',
  DICTATION_RECORD_KEY: 'dictation:record-key',
  DICTATION_SETTINGS: 'dictation:settings',
  DICTATION_SET: 'dictation:set',
  DICTATION_SAVE_KEY: 'dictation:save-key',
  DICTATION_REMOVE_KEY: 'dictation:remove-key',
  /** My words: the raw text, and saving it */
  DICTATION_WORDS: 'dictation:words',
  DICTATION_SET_WORDS: 'dictation:set-words',
  /** Microphone and Accessibility state (DictationPermissions) */
  DICTATION_PERMISSIONS: 'dictation:permissions',
  /** Ask for the first missing permission; returns DictationPermissions */
  DICTATION_ALLOW: 'dictation:allow',
  /** Try the kept clip again (it failed to turn into text); types into the app underneath */
  DICTATION_RETRY: 'dictation:retry'
} as const

export const LAUNCHER_SEND = {
  /** The bar was shown (LauncherOpenInfo) */
  LAUNCHER_SHOWN: 'launcher:shown',
  LAUNCHER_HIDDEN: 'launcher:hidden',
  /** AI answer so far (AiChunk) */
  LAUNCHER_AI_CHUNK: 'launcher:ai-chunk',
  /** Snippets / links / settings changed: reload items */
  LAUNCHER_CHANGED: 'launcher:changed',
  /** Start recording (the hold key went down) */
  DICTATION_START: 'dictation:start',
  /** Stop recording; send the audio if { send: true } */
  DICTATION_STOP: 'dictation:stop',
  /** Refresh the prepaid balance after a clip or account update. */
  DICTATION_ACCOUNT_CHANGED: 'dictation:account-changed',
  /** Dictation settings changed (switch, key, words, add-on, a kept clip): every page reloads them */
  DICTATION_SETTINGS_CHANGED: 'dictation:settings-changed',
  /** What the pill shows (DictationState) */
  DICTATION_STATE: 'dictation:state'
} as const
