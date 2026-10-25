/**
 * Check: the updater's signature reader sees codesign's stderr.
 * Run: node scripts/checks/mac-signature.check.mts [path/to/PeakFlow.app]
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { classifyCodesignOutput, readMacSignature } from '../../src/main/services/mac-signature.ts'

// Shape of `codesign -dv --verbose=2` for a Developer ID build (all on stderr, exit 0).
const developerId = [
  'Executable=/Applications/PeakFlow.app/Contents/MacOS/PeakFlow',
  'Identifier=pro.getpeakflow.core',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=513 flags=0x10000(runtime) hashes=5+7 location=embedded',
  'Signature size=9045',
  'Authority=Developer ID Application: Example Ltd (ABCDE12345)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=19 Oct 2026 at 10:00:00',
  'TeamIdentifier=ABCDE12345'
].join('\n')
assert.equal(classifyCodesignOutput(0, developerId), 'developer-id')
assert.equal(classifyCodesignOutput(0, 'Signature=adhoc\nTeamIdentifier=not set'), 'adhoc')
assert.equal(classifyCodesignOutput(1, '/x.app: code object is not signed at all'), 'unsigned')
assert.equal(classifyCodesignOutput(0, ''), 'other') // old bug: stdout-only always looked like this

const app = process.argv[2] ?? 'release/mac-arm64/PeakFlow.app'
if (process.platform === 'darwin' && existsSync(app)) {
  const kind = readMacSignature(app)
  console.log(`${app}: ${kind}`)
  assert.notEqual(kind, 'developer-id', 'local builds are not Developer ID signed')
  // Release builds are self-signed with "PeakFlow Code Signing", which reads as 'other'.
  assert.ok(kind === 'adhoc' || kind === 'unsigned' || kind === 'other', `expected adhoc/unsigned/self-signed, got ${kind}`)
}
console.log('mac-signature check: OK')
