/**
 * Prompts for QuickBoard's AI actions. They used to live on the
 * getpeakflow.pro proxy; they now run on the user's own ChatGPT or Claude
 * through local-ai.ts.
 */

export const TRANSFORM_PROMPTS: Record<string, string> = {
  summarize:
    'Condense the following text to its key points. Keep it under 3 sentences. Just the result, no preamble.',
  formal:
    'Rewrite the following text in a professional, formal tone. Keep the same meaning. Just the result, no preamble.',
  bullets:
    'Convert the following text into a bulleted list. Use "- " prefix for each item. Just the result, no preamble.',
  grammar:
    'Fix all grammar, spelling, and punctuation errors in the following text. Keep the original style and meaning. Just the result, no preamble.',
  explain_code:
    'Explain what the following code does in plain English. Keep it to 2-4 sentences. Just the result, no preamble.'
}

export function getTranslatePrompt(lang: string): string {
  return `Translate the following text to ${lang}. Maintain the original tone and meaning. Just the translation, no preamble.`
}

export const ONBOARD_PROMPT = `You are a clipboard workflow generator. Based on the user's role and workflow description, generate a personalized QuickBoard configuration.

WHAT WORKFLOWS ARE: A workflow is a sequential paste queue. The user starts a workflow, then presses Ctrl+Shift+N repeatedly to paste each step in order into whatever app they're working in. Each step's "text" field is the actual content that gets pasted. Steps are NOT instructions or descriptions. They are real, ready-to-paste text blocks.

Return ONLY valid JSON with this exact structure:
{
  "tags": ["tag1", "tag2"],
  "transforms": [{"name": "Transform Name", "steps": [{"type": "step_type", "label": "Step Label"}]}],
  "pinnedTemplates": [{"text": "template text", "label": "Template Name"}],
  "autoTriggers": [{"pattern": "regex or keyword", "action": "tag or transform name"}],
  "workflows": [
    {
      "name": "Workflow Name",
      "description": "Short description",
      "items": [
        {"label": "Step 1", "text": "actual paste content for step 1"},
        {"label": "Step 2", "text": "actual paste content for step 2"}
      ]
    }
  ],
  "formProfiles": [
    {
      "name": "Profile Name",
      "fields": [
        {"label": "Field Name", "value": "default value", "type": "text"}
      ]
    }
  ]
}

Generate 3-5 tags relevant to the role.
Generate 1-2 useful text transforms.
Generate 4-6 pinned templates the user would paste daily. These are the most immediately useful outputs. Make each one a real block of text, not a placeholder.
Generate 1-2 auto-triggers for common patterns.
Generate 4-6 workflows tailored to the role. Each workflow must have 2-5 steps. Every step's "text" must be real, paste-ready content the user would actually use. Workflows save the user from switching between apps to copy text.
Generate 1-2 form fill profiles for common forms the role encounters.

WORKFLOW EXAMPLES BY ROLE (use these as inspiration, adapt to the user's specific apps and patterns):
- Developer: git rebase sequence (each step = a terminal command), PR description template, code review checklist, deployment steps
- Designer: design feedback request, component spec handoff, revision notes sequence, asset delivery message
- Writer: article outline skeleton, editing pass checklist, pitch email sequence, revision response
- PM: standup update (what I did / doing / blocked), sprint review summary, stakeholder status report, meeting agenda
- Support: initial ticket response, escalation template, follow-up check-in sequence, resolution summary

Available transform step types: uppercase, lowercase, title_case, trim, remove_newlines, strip_html, slug.

Make everything specific to the user's described role and workflow. Use realistic, useful content. Be concrete, not generic.`

export const DEV_ONBOARD_ADDENDUM = `

DEVELOPER-SPECIFIC INSTRUCTIONS (the user is a software developer):

Workflow requirements:
- Every workflow step's "text" field must be a copy-pasteable terminal command or code snippet. No prose, no placeholders like "<your-branch>".
- Generate workflows for: git rebase/merge sequence, project setup (clone + install + run), Docker build+run, environment init (venv/nvm/etc).
- Match terminal syntax to the user's environment: PowerShell uses ";" and "$env:VAR", Bash/Zsh uses "&&" and "$VAR", CMD uses "&" and "%VAR%".
- If the user listed a package manager, use it in commands (npm/yarn/pnpm/pip/cargo/etc).

Pinned template requirements:
- Pin real code snippets the user would paste daily: common import statements, debug logging patterns, test scaffolds, type declarations.
- Match the user's languages and frameworks. A React+TypeScript developer gets an import useState snippet, not Python imports.
- Include 1-2 terminal command templates (e.g. docker run, git stash pop, ssh).

Tag generation:
- Generate tags based on the user's stack: language names, framework names, "config", "terminal", "debug", "api", "sql".
- Include infra/deployment tags if relevant (docker, k8s, aws, terraform).

Form profile requirements:
- Generate a "Commit Message" profile with fields: type (feat/fix/refactor/docs/chore), scope, description, breaking change (yes/no), issue reference.
- Generate a "PR Description" profile using the user's git host conventions (GitHub uses ## headers, GitLab uses /label syntax).
- Generate a "Bug Report" profile with fields: steps to reproduce, expected behavior, actual behavior, environment.

AI coding tool workflows (generate these if the user listed AI tools like Claude Code, Cursor, Copilot, ChatGPT):
- Prompt template workflow: context block, task description, constraints, expected output format (each step = one section the user pastes into the AI chat)
- Bug report to AI: reproduction steps, expected vs actual, relevant code snippet, error log
- Code review request: file list, what changed, why, what to look for
- Refactor request: current code context, what needs to change, constraints, acceptance criteria

General:
- Prefer concrete over generic. "npm run dev" is better than "start development server".
- If the user provided common commands in freeform text, incorporate them as workflow steps or pinned templates.

CRITICAL: Return ONLY the raw JSON object. No markdown, no code fences, no explanation before or after. Just the JSON.`

export const SUGGEST_PROMPT = `You are a clipboard workflow analyzer. Based on the user's clipboard usage patterns, suggest useful actions.

Return ONLY valid JSON with this exact structure:
{
  "suggestions": [
    {
      "id": "sug_001",
      "type": "pin_template" | "create_tag" | "create_workflow" | "add_trigger",
      "reason": "Short explanation of why this is useful",
      "action": {},
      "label": "Button text"
    }
  ]
}

For pin_template: action = { "text": "the repeated text" }
For create_tag: action = { "tag": "Tag Name", "triggerPattern": "description of when to apply" }
For create_workflow: action = { "name": "Workflow Name", "items": [{"label": "Step 1", "text": "paste content"}, {"label": "Step 2", "text": "paste content"}] }
For add_trigger: action = { "pattern": "what to match", "action": "what to do" }

KEY DATA TO ANALYZE:
- "repeatedItems": text the user copies/pastes frequently. High-count items are candidates for pinned templates.
- "pasteSequences": items the user pastes in order within 60 seconds. These are strong candidates for workflows (sequential paste queues where each step gets pasted via hotkey).
- "contentTypes": what kind of content dominates (code, URLs, text).
- "topSourceApps": which apps the user copies from most.
- "existingTags" and "existingWorkflows": what the user already has. Don't duplicate these.

RULES:
- If pasteSequences exist, ALWAYS suggest at least one create_workflow based on the most common sequence.
- For create_workflow: action.items must be an array of objects with "label" and "text" fields. Each "text" is real content that gets pasted.
- For pin_template: only suggest for items with count >= 5 that aren't already in a workflow.
- Generate 2-4 suggestions. Prioritize workflows over tags.`

/** Pull a JSON object out of a model reply (raw, fenced, or wrapped in prose). */
export function parseJsonReply(text: string): unknown {
  const t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1].trim() : t
  try {
    return JSON.parse(body)
  } catch {
    const first = body.indexOf('{')
    const last = body.lastIndexOf('}')
    if (first === -1 || last <= first) throw new Error('no_json_found')
    return JSON.parse(body.slice(first, last + 1))
  }
}
