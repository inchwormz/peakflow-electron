/**
 * Real app icons for the v2 panel (QuickBoard clip sources, FocusDim excluded
 * apps, ScreenSlap meeting apps). They are the only colour in the UI, so they
 * come from the OS rather than being drawn by us:
 *   - a link → the app macOS/Windows would open it with (getApplicationInfoForProtocol)
 *   - a bundle id or app name → the .app on disk → app.getFileIcon (NSWorkspace on macOS)
 *
 * Results (including misses) are cached as data URLs for the session.
 */

import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AppIconQuery } from '@shared/ipc-types'

const cache = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()

const BUNDLE_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const APP_DIRS = ['/Applications', '/System/Applications', '/System/Applications/Utilities', join(app.getPath('home'), 'Applications')]

/** Meeting links → the URL scheme of the native app that handles them. */
function nativeSchemeFor(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host.endsWith('zoom.us') || host.endsWith('zoom.com')) return 'zoommtg://'
    if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return 'msteams://'
    if (host.endsWith('webex.com')) return 'webex://'
    if (host.endsWith('slack.com')) return 'slack://'
    return `${u.protocol}//`
  } catch {
    return url
  }
}

function findAppByBundleId(bundleId: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId.replace(/'/g, '')}'`], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null)
      const first = stdout.split('\n').find((l) => l.endsWith('.app'))
      resolve(first ?? null)
    })
  })
}

function findAppByName(name: string): string | null {
  const clean = name.replace(/[/\\]/g, '').trim()
  if (!clean) return null
  for (const dir of APP_DIRS) {
    const p = join(dir, `${clean}.app`)
    if (existsSync(p)) return p
  }
  return null
}

async function iconForPath(path: string): Promise<string | null> {
  try {
    const img = await app.getFileIcon(path, { size: 'normal' })
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

async function resolve(q: AppIconQuery): Promise<string | null> {
  if (q.url) {
    try {
      const info = await app.getApplicationInfoForProtocol(nativeSchemeFor(q.url))
      if (info?.icon && !info.icon.isEmpty()) return info.icon.toDataURL()
    } catch {
      // No app registered for that scheme: fall back to the browser
      try {
        const info = await app.getApplicationInfoForProtocol('https://')
        if (info?.icon && !info.icon.isEmpty()) return info.icon.toDataURL()
      } catch { /* none */ }
    }
    return null
  }
  if (q.path) return iconForPath(q.path)
  if (process.platform !== 'darwin') return null
  let path: string | null = null
  if (q.bundleId && BUNDLE_ID_RE.test(q.bundleId)) path = await findAppByBundleId(q.bundleId)
  if (!path && q.name) path = findAppByName(q.name)
  return path ? iconForPath(path) : null
}

export function getAppIcon(q: AppIconQuery): Promise<string | null> {
  const key = JSON.stringify([q.bundleId ?? '', q.name ?? '', q.path ?? '', q.url ? nativeSchemeFor(q.url) : ''])
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null)
  const pending = inFlight.get(key)
  if (pending) return pending
  const p = resolve(q)
    .catch(() => null)
    .then((v) => {
      cache.set(key, v)
      inFlight.delete(key)
      return v
    })
  inFlight.set(key, p)
  return p
}
