interface Snippet { id: string; keyword: string; text: string }
interface VoiceSnippet extends Snippet { trigger: string }
export interface SnippetSpan { start: number; end: number; snippet: VoiceSnippet }

const edges = /^[\s.,!?…:;"“”‘’()\[\]]+|[\s.,!?…:;"“”‘’()\[\]]+$/gu
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function normalizeKeyword(keyword: string): string {
  return keyword.replace(edges, '').replace(/\s+/gu, ' ').toLowerCase()
}

/** Ambiguous aliases are all disabled, including a spoken alias of a ;keyword. */
export function voiceSnippets(saved: Snippet[]): VoiceSnippet[] {
  const counts = new Map<string, number>()
  const entries = saved.map((s) => ({ ...s, trigger: normalizeKeyword(s.keyword) }))
  for (const s of entries) counts.set(s.trigger, (counts.get(s.trigger) ?? 0) + 1)
  return entries.filter((s) => s.trigger && counts.get(s.trigger) === 1)
}

export function snippetSpans(text: string, snippets: VoiceSnippet[]): SnippetSpan[] {
  const found: SnippetSpan[] = []
  for (const snippet of snippets) {
    const phrase = snippet.trigger.split(' ').map(escapeRe).join('\\s+')
    const re = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_]);?${phrase}(?![\\p{L}\\p{N}\\p{M}_])`, 'giu')
    for (const m of text.matchAll(re)) found.push({ start: m.index!, end: m.index! + m[0].length, snippet })
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const spans: SnippetSpan[] = []
  let end = 0
  for (const span of found) {
    if (span.start < end) continue
    spans.push(span)
    end = span.end
  }
  return spans
}

export function exactSnippet(text: string, snippets: VoiceSnippet[]): VoiceSnippet | undefined {
  return snippets.find((s) => s.trigger === normalizeKeyword(text))
}

/** Only original spans are expanded; ordinary text alone gets My words replacements. */
export function expandSnippets(
  text: string, spans: SnippetSpan[], ordinary: (text: string) => string, body: (text: string) => string
): string {
  let out = ''
  let end = 0
  for (const span of spans) {
    out += ordinary(text.slice(end, span.start)) + body(span.snippet.text)
    end = span.end
  }
  return out + ordinary(text.slice(end))
}
