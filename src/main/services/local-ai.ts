/**
 * TEMPORARY STUB. The launcher (branch feat/launcher) owns the real
 * local-ai.ts: it detects the user's own Codex / Claude Code / Ollama and
 * runs prompts through them. This file only pins the agreed signature so
 * QuickBoard can build against it; it is replaced wholesale at merge.
 */

export type AiProviderId = 'codex' | 'claude' | 'ollama'

export interface AiProvider {
  id: AiProviderId
  label: string
  installed: boolean
  signedIn?: boolean
}

export interface LocalAiOptions {
  prompt: string
  system?: string
  provider?: string
  json?: boolean
  signal?: AbortSignal
  onChunk?: (text: string) => void
}

export interface LocalAiResult {
  ok: boolean
  text?: string
  error?: 'no_provider' | 'not_signed_in' | 'timeout' | 'failed'
}

export async function listAiProviders(): Promise<AiProvider[]> {
  return []
}

export async function getDefaultAiProvider(): Promise<AiProvider | null> {
  return null
}

export async function runLocalAi(_opts: LocalAiOptions): Promise<LocalAiResult> {
  return { ok: false, error: 'no_provider' }
}
