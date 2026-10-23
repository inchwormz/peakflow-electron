/**
 * Free AI through the person's own plan: their ChatGPT (via the Codex CLI),
 * their Claude (via Claude Code) or a local Ollama model. Used by the
 * launcher and QuickBoard.
 *
 * We only ever START the person's own CLI and read its output. We never read,
 * copy or store their login: the CLI signs in with its own saved login and
 * talks to OpenAI / Anthropic directly. Ollama is a plain HTTP call to
 * localhost:11434.
 *
 * Apps opened from Finder / the Start menu get a bare PATH, so the CLIs are
 * looked for in the login shell's PATH plus the usual install folders.
 */

import { spawn, execFile, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { delimiter, dirname, join } from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import { cliArgs, CODEX_BASE_INSTRUCTIONS } from './local-ai-args'

export type AiProviderId = 'codex' | 'claude' | 'ollama'

export interface AiProviderInfo {
  id: AiProviderId
  label: string
  installed: boolean
  signedIn?: boolean
}

/** light: the provider's smallest, cheapest model (saves the person's usage). best: their CLI's default model. */
export type AiTier = 'light' | 'best'

export interface RunLocalAiOptions {
  prompt: string
  system?: string
  provider?: AiProviderId
  /** Omitted: the person's saved choice for that provider (light unless they picked best) */
  tier?: AiTier
  /** Ask for JSON only; the reply is trimmed to the JSON value */
  json?: boolean
  signal?: AbortSignal
  /** The answer so far (whole text each time, not a delta) */
  onChunk?: (t: string) => void
}

export interface RunLocalAiResult {
  ok: boolean
  text?: string
  error?: 'no_provider' | 'not_signed_in' | 'timeout' | 'failed'
}

const LABELS: Record<AiProviderId, string> = { codex: 'ChatGPT', claude: 'Claude', ollama: 'Local model' }
const ORDER: AiProviderId[] = ['codex', 'claude', 'ollama']
const OLLAMA_URL = 'http://127.0.0.1:11434'
const RUN_TIMEOUT_MS = 120_000
const DEFAULT_SYSTEM = 'You are a helpful assistant inside a desktop launcher. Answer directly and briefly in plain text. No preamble.'
const isWin = process.platform === 'win32'

// ─── finding the CLIs ────────────────────────────────────────────────────────

let shellPath: Promise<string> | null = null

/** The PATH a terminal would have (login shell), read once. Empty on Windows / failure. */
function loginShellPath(): Promise<string> {
  if (isWin) return Promise.resolve('')
  if (!shellPath) {
    shellPath = new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh'
      execFile(shell, ['-ilc', 'printf "__PF_PATH__%s__PF_END__" "$PATH"'], { timeout: 4000 }, (err, stdout) => {
        const m = /__PF_PATH__(.*)__PF_END__/s.exec(stdout ?? '')
        resolve(!err && m ? m[1] : '')
      })
    })
  }
  return shellPath
}

function extraDirs(): string[] {
  const home = homedir()
  if (isWin) {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [join(home, '.local', 'bin'), join(appData, 'npm'), join(local, 'Programs', 'claude'), join(local, 'Microsoft', 'WinGet', 'Links'), join(home, 'scoop', 'shims')]
  }
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, 'Library', 'pnpm'),
    '/usr/bin',
    '/bin'
  ]
}

async function searchPath(): Promise<string[]> {
  const fromShell = (await loginShellPath()).split(delimiter)
  const fromEnv = (process.env.PATH ?? '').split(delimiter)
  return [...new Set([...fromShell, ...fromEnv, ...extraDirs()].filter(Boolean))]
}

const binCache = new Map<string, { at: number; path: string | null }>()

async function findBinary(name: 'codex' | 'claude'): Promise<string | null> {
  const hit = binCache.get(name)
  if (hit && Date.now() - hit.at < 60_000) return hit.path
  const exts = isWin ? ['.exe', '.cmd', ''] : ['']
  let found: string | null = null
  for (const dir of await searchPath()) {
    for (const ext of exts) {
      const p = join(dir, name + ext)
      if (existsSync(p)) {
        found = p
        break
      }
    }
    if (found) break
  }
  binCache.set(name, { at: Date.now(), path: found })
  return found
}

/** Environment for the CLIs: ours plus the full PATH (codex is a Node script and needs `node`). */
async function childEnv(bin: string): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env }
  env.PATH = [dirname(bin), ...(await searchPath())].join(delimiter)
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function workDir(): string {
  // A folder of our own, so the CLI doesn't pick up a project's instructions
  const dir = join(app.getPath('userData'), 'local-ai')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Our short instructions for Codex, in our own folder (null if it can't be written: Codex then uses its own). */
function codexInstructionsFile(): string | null {
  try {
    const file = join(workDir(), 'codex-instructions.md')
    if (!existsSync(file) || readFileSync(file, 'utf8') !== CODEX_BASE_INSTRUCTIONS) writeFileSync(file, CODEX_BASE_INSTRUCTIONS)
    return file
  } catch {
    return null
  }
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    // npm installs .cmd shims on Windows, which need a shell; our args are fixed flags only
    const child = spawn(bin, args, { env, cwd: workDir(), shell: isWin && bin.endsWith('.cmd'), windowsHide: true })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    const t = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', () => {
      clearTimeout(t)
      resolve({ code: -1, out })
    })
    child.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, out })
    })
  })
}

// ─── status ──────────────────────────────────────────────────────────────────

const signInCache = new Map<AiProviderId, { at: number; v: boolean }>()

async function signedIn(id: 'codex' | 'claude', bin: string): Promise<boolean> {
  const hit = signInCache.get(id)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.v
  const env = await childEnv(bin)
  // The CLIs report their own login state; we only read that yes/no answer
  const r = await run(bin, id === 'claude' ? ['auth', 'status'] : ['login', 'status'], env, 8000)
  let v = false
  if (id === 'claude') {
    try {
      v = (JSON.parse(r.out.slice(r.out.indexOf('{'))) as { loggedIn?: boolean }).loggedIn === true
    } catch {
      v = r.code === 0 && !/not logged in/i.test(r.out)
    }
  } else {
    v = r.code === 0 && /logged in/i.test(r.out) && !/not logged in/i.test(r.out)
  }
  signInCache.set(id, { at: Date.now(), v })
  return v
}

async function ollamaModel(tier: AiTier = 'light'): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(800) })
    if (!res.ok) return null
    const body = (await res.json()) as { models?: Array<{ name: string; size?: number }> }
    const models = body.models ?? []
    if (!models.length) return null
    // Prefer a stored choice, else the smallest model (light) or the largest (best)
    const chosen = prefs().get('ollamaModel') as string | undefined
    if (chosen && models.some((m) => m.name === chosen)) return chosen
    const bySize = [...models].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
    return (tier === 'best' ? bySize[bySize.length - 1] : bySize[0]).name
  } catch {
    return null
  }
}

export async function listAiProviders(): Promise<AiProviderInfo[]> {
  const [codex, claude, model] = await Promise.all([findBinary('codex'), findBinary('claude'), ollamaModel()])
  const [codexIn, claudeIn] = await Promise.all([
    codex ? signedIn('codex', codex) : Promise.resolve(false),
    claude ? signedIn('claude', claude) : Promise.resolve(false)
  ])
  return [
    { id: 'codex', label: LABELS.codex, installed: !!codex, signedIn: codex ? codexIn : false },
    { id: 'claude', label: LABELS.claude, installed: !!claude, signedIn: claude ? claudeIn : false },
    { id: 'ollama', label: model ? `${LABELS.ollama} (${model})` : LABELS.ollama, installed: !!model, signedIn: model ? true : undefined }
  ]
}

let store: Store | null = null
function prefs(): Store {
  if (!store) store = new Store({ name: 'config-local-ai', clearInvalidConfig: true })
  return store
}

export function setDefaultAiProvider(id: AiProviderId | null): void {
  if (id === null) prefs().delete('provider')
  else if (ORDER.includes(id)) prefs().set('provider', id)
}

/** The person's chosen provider if it's usable, else the first one that is (ChatGPT, Claude, local). Null when none. */
export async function getDefaultAiProvider(): Promise<AiProviderId | null> {
  const list = await listAiProviders()
  const usable = (p: AiProviderInfo): boolean => p.installed && p.signedIn !== false
  const chosen = prefs().get('provider') as AiProviderId | undefined
  const pick = list.find((p) => p.id === chosen && usable(p)) ?? ORDER.map((id) => list.find((p) => p.id === id)!).find(usable)
  return pick?.id ?? null
}

/** The model size to use for a provider: light (default, saves the person's usage) or best. */
export function getAiTier(id: AiProviderId): AiTier {
  return prefs().get(`tier.${id}`) === 'best' ? 'best' : 'light'
}

export function setAiTier(id: AiProviderId, tier: AiTier): void {
  if (ORDER.includes(id) && (tier === 'light' || tier === 'best')) prefs().set(`tier.${id}`, tier)
}

// The Codex CLI's lightest model, read from its own model list (names change between versions)
let codexLight: { bin: string; model: string | null } | null = null

async function codexLightModel(bin: string): Promise<string | null> {
  if (codexLight?.bin === bin) return codexLight.model
  const r = await run(bin, ['debug', 'models'], await childEnv(bin), 8000)
  let model: string | null = null
  try {
    const body = JSON.parse(r.out.slice(r.out.indexOf('{'))) as { models?: Array<{ slug?: string; visibility?: string; priority?: number }> }
    const light = (body.models ?? [])
      .filter((m) => typeof m.slug === 'string' && m.visibility !== 'hide' && /luna|mini|nano|lite/i.test(m.slug))
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    model = light[0]?.slug ?? null
  } catch { /* old CLI without the list: use its default */ }
  codexLight = { bin, model }
  return model
}

/** Forget cached sign-in answers (after the person signs in from the setup screen). */
export function refreshAiProviders(): void {
  signInCache.clear()
  binCache.clear()
}

// ─── running ─────────────────────────────────────────────────────────────────

const JSON_RULE = 'Reply with only valid JSON. No code fences, no explanation.'

/** Trim a reply to its JSON value (models sometimes wrap it in ``` fences or a sentence). */
function extractJson(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = t.search(/[[{]/)
  if (start < 0) return t
  const open = t[start]
  const end = t.lastIndexOf(open === '{' ? '}' : ']')
  return end > start ? t.slice(start, end + 1) : t
}

const NOT_SIGNED_IN_RE = /not logged in|please (run )?\/?login|log ?in required|unauthori[sz]ed|invalid api key|authentication|sign in/i

function runCli(
  id: 'codex' | 'claude',
  bin: string,
  prompt: string,
  system: string,
  signal: AbortSignal | undefined,
  onChunk: ((t: string) => void) | undefined,
  model: string | null
): Promise<RunLocalAiResult> {
  return new Promise((resolve) => {
    void childEnv(bin).then((env) => {
      const viaShell = isWin && bin.endsWith('.cmd')
      let child: ChildProcess
      try {
        // A shell would split a path with spaces, so .cmd installs keep Codex's own instructions
        const args = cliArgs(id, { model, system, codexInstructionsFile: id === 'codex' && !viaShell ? codexInstructionsFile() : null })
        child = spawn(bin, args, { env, cwd: workDir(), shell: viaShell, windowsHide: true })
      } catch {
        resolve({ ok: false, error: 'failed' })
        return
      }
      let text = ''
      let finalText: string | null = null
      let errText = ''
      let buf = ''
      let settled = false
      const finish = (r: RunLocalAiResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onAbort = (): void => {
        child.kill()
        finish({ ok: false, error: 'failed' })
      }
      const timer = setTimeout(() => {
        child.kill()
        finish({ ok: false, error: 'timeout' })
      }, RUN_TIMEOUT_MS)
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort)

      const line = (l: string): void => {
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(l) as Record<string, unknown>
        } catch {
          errText += l + '\n'
          return
        }
        if (id === 'claude') {
          if (ev.type === 'stream_event') {
            const e = ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined
            if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
              text += e.delta.text
              onChunk?.(text)
            }
          } else if (ev.type === 'result') {
            if (ev.is_error) errText += typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? '')
            else if (typeof ev.result === 'string') finalText = ev.result
          }
        } else {
          const item = ev.item as { type?: string; text?: string } | undefined
          if (ev.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
            text = text ? `${text}\n\n${item.text}` : item.text
            onChunk?.(text)
          } else if (ev.type === 'turn.failed' || ev.type === 'error') {
            errText += JSON.stringify(ev.error ?? ev.message ?? ev) + '\n'
          }
        }
      }
      child.stdout?.on('data', (d: Buffer) => {
        buf += d.toString()
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (l) line(l)
        }
      })
      child.stderr?.on('data', (d: Buffer) => {
        errText += d.toString()
      })
      child.on('error', () => finish({ ok: false, error: 'failed' }))
      child.on('close', (code) => {
        if (buf.trim()) line(buf.trim())
        const answer = (finalText ?? text).trim()
        if (answer && code === 0) return finish({ ok: true, text: answer })
        if (NOT_SIGNED_IN_RE.test(errText)) {
          signInCache.delete(id)
          return finish({ ok: false, error: 'not_signed_in' })
        }
        if (answer) return finish({ ok: true, text: answer })
        console.warn(`[LocalAI] ${id} exited ${code}: ${errText.slice(0, 400)}`)
        finish({ ok: false, error: 'failed' })
      })
      // Prompt goes in on stdin: no length limit, nothing in the process list
      const input = id === 'codex' ? `${system}\n\n${prompt}` : prompt
      child.stdin?.on('error', () => {})
      child.stdin?.end(input)
    })
  })
}

async function runOllama(prompt: string, system: string, json: boolean, signal: AbortSignal | undefined, onChunk: ((t: string) => void) | undefined, tier: AiTier): Promise<RunLocalAiResult> {
  const model = await ollamaModel(tier)
  if (!model) return { ok: false, error: 'no_provider' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS)
  const onAbort = (): void => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  let timedOut = false
  ctrl.signal.addEventListener('abort', () => (timedOut = !signal?.aborted))
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, ...(json ? { format: 'json' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      signal: ctrl.signal
    })
    if (!res.ok || !res.body) return { ok: false, error: 'failed' }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let text = ''
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!l) continue
        try {
          const ev = JSON.parse(l) as { message?: { content?: string } }
          if (ev.message?.content) {
            text += ev.message.content
            onChunk?.(text)
          }
        } catch { /* partial line */ }
      }
    }
    return text.trim() ? { ok: true, text: text.trim() } : { ok: false, error: 'failed' }
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'failed' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Ask the person's own AI. Streams through onChunk when the provider supports it. */
export async function runLocalAi(opts: RunLocalAiOptions): Promise<RunLocalAiResult> {
  const provider = opts.provider ?? (await getDefaultAiProvider())
  if (!provider) return { ok: false, error: 'no_provider' }
  const system = [opts.system?.trim() || DEFAULT_SYSTEM, opts.json ? JSON_RULE : ''].filter(Boolean).join('\n\n')
  let result: RunLocalAiResult
  const tier = opts.tier ?? getAiTier(provider)
  if (provider === 'ollama') {
    result = await runOllama(opts.prompt, system, !!opts.json, opts.signal, opts.onChunk, tier)
  } else {
    const bin = await findBinary(provider)
    if (!bin) return { ok: false, error: 'no_provider' }
    // Light: Claude's Haiku tier; Codex's smallest listed model. Best: the CLI's own default.
    const model = tier === 'best' ? null : provider === 'claude' ? 'haiku' : await codexLightModel(bin)
    result = await runCli(provider, bin, opts.prompt, system, opts.signal, opts.onChunk, model)
    // The plan doesn't offer that model (or this CLI doesn't know it): use the default instead
    if (!result.ok && model && result.error === 'failed' && !opts.signal?.aborted) {
      console.warn(`[LocalAI] ${provider} light model ${model} failed; using the default model`)
      if (provider === 'codex') codexLight = { bin, model: null }
      result = await runCli(provider, bin, opts.prompt, system, opts.signal, opts.onChunk, null)
    }
  }
  if (result.ok && opts.json && result.text) result = { ...result, text: extractJson(result.text) }
  return result
}

/** The terminal command that installs and signs in to a provider (shown in plain words first). */
export function aiSetupCommand(id: 'codex' | 'claude'): string {
  if (isWin) {
    return id === 'claude'
      ? 'irm https://claude.ai/install.ps1 | iex; claude auth login'
      : 'npm install -g @openai/codex; codex login'
  }
  return id === 'claude'
    ? 'curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude auth login'
    : '(command -v npm >/dev/null || { echo "Codex needs Node.js first: opening nodejs.org"; open https://nodejs.org/en/download; exit 1; }) && npm install -g @openai/codex && codex login'
}
