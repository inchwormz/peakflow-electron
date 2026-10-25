/**
 * Pure rules for the Mac update offer (review S12), so scripts/checks can
 * test them: semver compare, "Skip this version", and download progress.
 */

export function parseSemver(tag: string): [number, number, number] | null {
  const match = tag.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

/** True if `remote` is newer than `local`. */
export function isNewer(remote: string, local: string): boolean {
  const r = parseSemver(remote)
  const l = parseSemver(local)
  if (!r || !l) return false
  if (r[0] !== l[0]) return r[0] > l[0]
  if (r[1] !== l[1]) return r[1] > l[1]
  return r[2] > l[2]
}

/**
 * Offer `latest`? Only when newer. The automatic check (every 4 hours) skips
 * the version the customer chose to skip; a check they start themselves
 * always offers it.
 */
export function shouldOffer(latest: string | null, current: string, skipped: string | null, silent: boolean): boolean {
  if (!latest || !isNewer(latest, current)) return false
  if (silent && skipped && skipped.replace(/^v/, '') === latest.replace(/^v/, '')) return false
  return true
}

/** Whole-number percent, or null when the size is unknown. */
export function percentOf(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)))
}

/** The Mac's chip, including Intel builds running under Rosetta. */
export function macDmgArch(arch: string, translated: boolean): 'arm64' | 'x64' {
  return arch === 'arm64' || translated ? 'arm64' : 'x64'
}

/** What the panel's Updates page shows while a Mac update downloads. */
export interface UpdateProgress {
  state: 'idle' | 'downloading' | 'downloaded' | 'error'
  version?: string
  /** 0–100, or null while the size is unknown */
  percent?: number | null
  message?: string
}
