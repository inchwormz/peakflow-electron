/**
 * The QuickBoard AI page's run logic (start the AI action, then paste the
 * result), kept out of React so scripts/checks/ai-run.check.mts can drive the
 * exact code with real event orders. AiRun in ClipPages.tsx feeds it its
 * props on every change and disposes it on unmount.
 *
 * Rules: the AI action only starts while the panel is open on this page, and
 * its result only pastes if it is still the newest run and the panel is still
 * open on this page. Closing the panel cancels and goes back to the list.
 */

import { createLatest } from '@shared/latest-only'

export interface AiResult {
  ok: boolean
  result?: string
  error?: string
}

export interface AiRunDeps {
  transform: (type: string, text: string, lang: string | undefined) => Promise<AiResult>
  paste: (clipId: string, text: string) => void
  hide: () => void
  /** Back to the clip list */
  leave: () => void
  setState: (s: { phase: 'run' | 'error'; error: string }) => void
}

export interface AiRunInput {
  /** undefined while history loads; null when the clip is gone */
  clip: { id: string; type: string } | null | undefined
  text: string
  type: string
  lang: string | undefined
  attempt: number
  visible: boolean
}

export function createAiRun(deps: AiRunDeps): { update: (i: AiRunInput) => void; dispose: () => void } {
  const latest = createLatest()
  let ran = ''
  let open = false
  let left = false

  return {
    update(i) {
      open = i.visible
      if (!i.visible) {
        latest.cancel()
        ran = ''
        if (!left) {
          left = true
          deps.leave()
        }
        return
      }
      left = false
      if (!i.clip || i.clip.type !== 'text') return
      const key = `${i.clip.id}|${i.type}|${i.lang}|${i.attempt}`
      if (ran === key) return
      ran = key
      deps.setState({ phase: 'run', error: '' })
      const isCurrent = latest.next()
      const clipId = i.clip.id
      deps
        .transform(i.type, i.text, i.lang)
        .then((res) => {
          if (!isCurrent() || !open) return
          if (res?.ok && res.result) {
            deps.hide()
            deps.paste(clipId, res.result)
            deps.leave()
          } else deps.setState({ phase: 'error', error: res?.error ?? 'failed' })
        })
        .catch(() => {
          if (isCurrent() && open) deps.setState({ phase: 'error', error: 'network_error' })
        })
    },
    // Unmount (left the page). Reset so a remount (React StrictMode) starts afresh.
    dispose() {
      latest.cancel()
      open = false
      ran = ''
    }
  }
}

/* ─── AI access: which of the user's own AIs is connected ────────────────── */

export interface AiAccess {
  allowed: boolean
  reason?: 'not_licensed' | 'no_provider'
  provider?: string
}

export function aiAccessNote(reason: AiAccess['reason']): string {
  return reason === 'not_licensed'
    ? 'AI actions are part of the paid plan.'
    : 'AI uses your own ChatGPT or Claude. Install Codex or Claude Code and sign in once to turn it on.'
}
