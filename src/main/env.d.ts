/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_AI_PROXY_URL?: string
  readonly MAIN_VITE_TODOIST_CLIENT_SECRET?: string
  /** Older single buy link; used as the $5 top-up when _5 is unset */
  readonly MAIN_VITE_DICTATION_TOPUP_URL?: string
  readonly MAIN_VITE_DICTATION_TOPUP_URL_5?: string
  readonly MAIN_VITE_DICTATION_TOPUP_URL_10?: string
  readonly MAIN_VITE_DICTATION_TOPUP_URL_20?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
