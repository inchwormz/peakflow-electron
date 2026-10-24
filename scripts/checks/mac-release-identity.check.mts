/**
 * Check: the self-signed branch of the release identity gate (scripts/checks/mac-release-identity.mjs).
 * Uses canned `codesign -dv` and `codesign -d -r-` output, so it runs anywhere.
 * - right name + right leaf passes;
 * - wrong leaf fails; wrong name fails; no leaf pin fails;
 * - a Developer ID authority skips the leaf check.
 * Run: node scripts/checks/mac-release-identity.check.mts
 */
import assert from 'node:assert/strict'
import { stableIdentityProblems, EXPECTED_LEAF_SHA1 } from './mac-release-identity.mjs'

const LEAF = EXPECTED_LEAF_SHA1.toLowerCase()
const APP_ID = 'pro.getpeakflow.core'

/** codesign -dv output for a self-signed app with the given Authority. */
const info = (authority: string) =>
  `Executable=/x/PeakFlow.app/Contents/MacOS/PeakFlow\nIdentifier=${APP_ID}\nFormat=app bundle with Mach-O thin (arm64)\nAuthority=${authority}\nSignature size=1234\nFlags=0x0(none)\n`

/** codesign -d -r- output that pins the leaf. */
const dr = (leaf: string) =>
  `Executable=/x/PeakFlow.app/Contents/MacOS/PeakFlow\n# designated => identifier "${APP_ID}" and certificate leaf = H"${leaf}"\n`

const env = {} as Record<string, string | undefined>

// 1. Right name + right leaf: passes, and the designated requirement is reported
{
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: dr(LEAF), drStatus: 0, env })
  assert.deepEqual(r.problems, [])
  assert.match(r.designated ?? '', /certificate leaf = H"2c6df1b6/)
}

// 1b. The leaf match is case-insensitive (codesign prints lowercase hex, the pin is uppercase)
{
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: dr(EXPECTED_LEAF_SHA1), drStatus: 0, env })
  assert.deepEqual(r.problems, [])
}

// 2. Wrong leaf: fails
{
  const other = 'a'.repeat(40)
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: dr(other), drStatus: 0, env })
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /does not pin the stable certificate leaf/)
}

// 3. Wrong name: fails (the authority is some other certificate with the right leaf)
{
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing Old'), dr: dr(LEAF), drStatus: 0, env })
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /no "Authority=PeakFlow Code Signing"/)
}

// 3b. Unset env cannot widen the check: a wrong name still fails when PEAKFLOW_MAC_SIGN_IDENTITY is empty or missing
{
  const r = stableIdentityProblems({ info: info('Some Other Cert'), dr: dr(LEAF), drStatus: 0, env: { PEAKFLOW_MAC_SIGN_IDENTITY: '' } })
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /"Authority=PeakFlow Code Signing"/)
}

// 4. No leaf pin in the designated requirement: fails
{
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: `# designated => identifier "${APP_ID}"\n`, drStatus: 0, env })
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /does not pin the stable certificate leaf/)
}

// 4b. designated requirement command failed: fails
{
  const r = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: 'boom', drStatus: 1, env })
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /codesign -d -r- failed/)
}

// 5. Developer ID authority skips the stable name and leaf checks (no designated requirement is read)
{
  const r = stableIdentityProblems({ info: info('Developer ID Application: Test (TEAM)'), dr: 'no leaf here', drStatus: 0, env })
  assert.deepEqual(r.problems, [])
  assert.equal(r.designated, null)
}

// 6. Overrides: PEAKFLOW_MAC_SIGN_IDENTITY and PEAKFLOW_MAC_SIGN_LEAF_SHA1 replace the defaults
{
  const altLeaf = 'b'.repeat(40)
  const r = stableIdentityProblems({
    info: info('Alt Cert'),
    dr: dr(altLeaf),
    drStatus: 0,
    env: { PEAKFLOW_MAC_SIGN_IDENTITY: 'Alt Cert', PEAKFLOW_MAC_SIGN_LEAF_SHA1: altLeaf }
  })
  assert.deepEqual(r.problems, [])
  // an empty leaf override falls back to the pinned default, so it cannot disable the pin
  const fallback = stableIdentityProblems({ info: info('PeakFlow Code Signing'), dr: dr(altLeaf), drStatus: 0, env: { PEAKFLOW_MAC_SIGN_LEAF_SHA1: '' } })
  assert.equal(fallback.problems.length, 1)
}

console.log('mac-release-identity check: OK')
