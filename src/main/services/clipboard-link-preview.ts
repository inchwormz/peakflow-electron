/**
 * clipboard-link-preview.ts — page titles for link clips.
 *
 * Only runs when the person has switched on "Show page titles for links"
 * (off by default) and a link clip is on screen in QuickBoard: never at copy
 * time, so a copied sign-in or confirm link isn't visited behind their back.
 * Public internet only: private, local and reserved addresses are refused,
 * checked again for every redirect and at connect time (link-preview-guard).
 * Reads at most 16 KB, gives up after 5 s, sends no cookies.
 */

import { lookup } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { guardedLookup, previewableUrl } from './link-preview-guard'

interface LinkPreview {
  title: string | null
}

const MAX_BYTES = 16384
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 5000

const resolveAll = (host: string, cb: (err: NodeJS.ErrnoException | null, addrs: Array<{ address: string; family: number }>) => void): void =>
  lookup(host, { all: true, verbatim: true }, (err, addrs) => cb(err, addrs ?? []))
const safeLookup = guardedLookup(resolveAll)

/** One GET; resolves with the response (body unread) or rejects. */
function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        lookup: safeLookup as unknown as LookupFunction,
        signal,
        headers: { 'User-Agent': 'Mozilla/5.0 PeakFlow/2 (link preview)', Accept: 'text/html' }
      },
      resolve
    )
    req.on('error', reject)
    req.end()
  })
}

/** Fetch the title for a copied link. Returns `{ title: null }` for anything refused or failed. */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const opened: IncomingMessage[] = []
  try {
    let url = previewableUrl(raw)
    for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
      const res = await get(url, controller.signal)
      opened.push(res)
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy() // don't read a redirect's body
        let next: URL | null = null
        try {
          next = previewableUrl(new URL(res.headers.location, url).href)
        } catch {
          next = null
        }
        url = next
        continue
      }
      if (status < 200 || status >= 300 || !/text\/html|application\/xhtml/i.test(String(res.headers['content-type'] ?? ''))) {
        res.destroy()
        return { title: null }
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of res) {
        chunks.push(chunk as Buffer)
        size += (chunk as Buffer).length
        if (size >= MAX_BYTES) break
      }
      res.destroy()
      const html = Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8')
      const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
      const title = m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : ''
      return { title: title || null }
    }
    return { title: null }
  } catch (error) {
    console.warn('[QuickBoard] Link preview fetch failed:', (error as Error)?.message ?? error)
    return { title: null }
  } finally {
    clearTimeout(timeout)
    // Close every response and anything still in flight, whatever happened
    for (const r of opened) r.destroy()
    controller.abort()
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
