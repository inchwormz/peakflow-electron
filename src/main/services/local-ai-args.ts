/**
 * Command-line arguments for the person's own AI CLIs (Codex for ChatGPT,
 * Claude Code for Claude). No Electron imports, so this can be checked from Node.
 */

/**
 * Codex loads the person's whole agent setup on every call: plugins, apps,
 * memories, browser and computer-use tools and their usage notes, about
 * 28,000 input tokens for a one-line question (measured 24 Oct 2026, Codex
 * 0.162.1). A launcher answer needs none of it, so these `-c` overrides switch
 * it off for our calls only, which brings a call to about 16,000 tokens.
 * They are config overrides, not flags: a Codex version that doesn't know a
 * key ignores it instead of refusing to run. The person's own config file is
 * still read, so a custom model provider keeps working.
 * Codex still reads the person's global ~/.codex/AGENTS.md; it has no
 * override for that, and we never touch their Codex folder.
 */
export const CODEX_LEAN_CONFIG: readonly string[] = [
  'features.apps=false',
  'features.plugins=false',
  'features.memories=false',
  'features.multi_agent=false',
  'features.image_generation=false',
  'features.browser_use=false',
  'features.computer_use=false',
  'features.in_app_browser=false',
  'features.skill_search=false',
  'features.hooks=false',
  'include_apps_instructions=false',
  'include_plugin_usage_instructions=false',
  'include_skills_usage_instructions=false',
  'include_permissions_instructions=false',
  'include_collaboration_mode_instructions=false',
  'include_environment_context=false',
  'web_search="disabled"'
]

/** Replaces Codex's long coding-agent instructions; written once to our own folder. */
export const CODEX_BASE_INSTRUCTIONS = 'You are a helpful assistant inside a desktop app. Follow the instructions in the message. Answer directly in plain text unless asked for JSON.\n'

/** TOML string for a `-c key="value"` override (escapes backslashes and quotes, e.g. Windows paths). */
function tomlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function cliArgs(
  id: 'codex' | 'claude',
  opts: { model: string | null; system: string; codexInstructionsFile?: string | null }
): string[] {
  const pick = opts.model ? ['--model', opts.model] : []
  if (id === 'claude') {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--no-session-persistence',
      '--strict-mcp-config', '--setting-sources', '', ...pick, '--system-prompt', opts.system]
  }
  const lean = CODEX_LEAN_CONFIG.flatMap((c) => ['-c', c])
  const base = opts.codexInstructionsFile ? ['-c', `model_instructions_file=${tomlString(opts.codexInstructionsFile)}`] : []
  return ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-c', 'model_reasoning_effort="low"',
    ...lean, ...base, ...pick, '-']
}
