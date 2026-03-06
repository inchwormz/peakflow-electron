/**
 * Fuzzy search scoring for QuickBoard clipboard items.
 * No external dependencies — runs entirely in the renderer.
 */

export function fuzzyScore(query: string, text: string): number {
  if (!query || !text) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  if (t.includes(q)) return 100

  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0

  let score = 0
  for (const token of tokens) {
    if (t.includes(token)) {
      score += 10
      const idx = t.indexOf(token)
      if (idx === 0 || t[idx - 1] === ' ' || t[idx - 1] === '/') score += 5
    } else {
      let qi = 0
      let consecutive = 0
      for (let ti = 0; ti < t.length && qi < token.length; ti++) {
        if (t[ti] === token[qi]) {
          qi++
          consecutive++
          score += consecutive
        } else {
          consecutive = 0
        }
      }
      if (qi < token.length) return 0
    }
  }
  return score
}

/**
 * Score a ClipboardItem against a search query.
 * Searches across text, preview, ocrText, tags, and sourceApp.
 * Supports "from:appname" syntax for source app filtering.
 */
export function scoreItem(
  query: string,
  item: { text: string | null; preview: string; ocrText: string | null; tags: string[]; sourceApp: string | null }
): number {
  let searchQuery = query
  let fromFilter: string | null = null
  const fromMatch = query.match(/^from:(\S+)\s*(.*)$/i)
  if (fromMatch) {
    fromFilter = fromMatch[1].toLowerCase()
    searchQuery = fromMatch[2]
  }

  if (fromFilter && item.sourceApp) {
    if (!item.sourceApp.toLowerCase().includes(fromFilter)) return 0
    if (!searchQuery) return 50
  } else if (fromFilter) {
    return 0
  }

  if (!searchQuery) return 1

  let best = 0
  if (item.text) best = Math.max(best, fuzzyScore(searchQuery, item.text))
  if (item.preview) best = Math.max(best, fuzzyScore(searchQuery, item.preview))
  if (item.ocrText) best = Math.max(best, fuzzyScore(searchQuery, item.ocrText))
  if (item.sourceApp) best = Math.max(best, fuzzyScore(searchQuery, item.sourceApp) * 0.5)
  for (const tag of item.tags) {
    best = Math.max(best, fuzzyScore(searchQuery, tag) * 0.8)
  }
  return best
}
