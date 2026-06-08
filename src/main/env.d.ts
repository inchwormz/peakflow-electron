/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_AI_PROXY_URL?: string
  readonly MAIN_VITE_TODOIST_CLIENT_SECRET?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
