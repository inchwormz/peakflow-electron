/**
 * Reads a macOS app bundle's code signature (no Electron imports, so the
 * check scripts can run it under plain Node).
 *
 * `codesign -dv` prints its details on STDERR, even on success, and exits
 * non-zero for an unsigned bundle. Reading stdout alone always sees an empty
 * string, which made every Developer ID build look unsigned.
 */

import { spawnSync } from 'child_process'

export type MacSignatureKind = 'developer-id' | 'adhoc' | 'other' | 'unsigned' | 'unknown'

/** Classify `codesign -dv --verbose=2` output (stdout + stderr combined). */
export function classifyCodesignOutput(status: number | null, output: string): MacSignatureKind {
  if (/Authority=Developer ID Application/.test(output)) return 'developer-id'
  if (/Signature=adhoc/.test(output)) return 'adhoc'
  if (/code object is not signed/.test(output)) return 'unsigned'
  return status === 0 ? 'other' : 'unknown'
}

export function readMacSignature(bundlePath: string, timeoutMs = 5000): MacSignatureKind {
  const r = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', bundlePath], {
    encoding: 'utf8',
    timeout: timeoutMs
  })
  if (r.error) return 'unknown'
  return classifyCodesignOutput(r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`)
}
