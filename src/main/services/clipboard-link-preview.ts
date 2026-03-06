/**
 * clipboard-link-preview.ts — Fetches page title + favicon for URL clips.
 *
 * Uses Electron's net.fetch (runs in main process, respects system proxy).
 * Results are cached on the ClipboardItem itself (linkTitle, linkFavicon).
 */

import { net } from 'electron'

// ─── Types ──────────────────────────────────────────────────────────────────

interface LinkPreview {
  title: string | null
  favicon: string | null
}

// ─── Fetching ───────────────────────────────────────────────────────────────

/** Fetch title and favicon for a URL. Times out after 5s. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await net.fetch(url, {
      signal: controller.signal as AbortSignal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PeakFlow/1.0',
        'Accept': 'text/html'
      }
    })

    clearTimeout(timeout)

    if (!response.ok) return { title: null, favicon: null }

    // Only read first 16KB to find <title> and favicon — don't download full pages
    const reader = response.body?.getReader()
    if (!reader) return { title: null, favicon: null }

    let html = ''
    const decoder = new TextDecoder()
    let bytesRead = 0
    const MAX_BYTES = 16384

    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      bytesRead += value.byteLength
    }

    reader.cancel().catch(() => {})

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : null

    // Extract favicon from <link> tags
    let favicon: string | null = null
    const iconMatch = html.match(
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i
    ) || html.match(
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i
    )

    if (iconMatch) {
      const iconHref = iconMatch[1]
      try {
        const resolved = new URL(iconHref, url).href
        favicon = resolved
      } catch {
        favicon = iconHref
      }
    } else {
      // Fallback: try /favicon.ico
      try {
        const origin = new URL(url).origin
        favicon = `${origin}/favicon.ico`
      } catch {
        // invalid URL
      }
    }

    return { title, favicon }
  } catch (error) {
    console.warn('[QuickBoard] Link preview fetch failed:', error)
    return { title: null, favicon: null }
  }
}
