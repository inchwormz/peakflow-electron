/**
 * Check: the Accessibility prompt decision (review S1). Trusted, or no feature
 * on, means nothing. Missing and never granted means first run. Missing after
 * it was trusted under an earlier app version means macOS forgot PeakFlow after
 * an update. Missing after it was trusted under this same version means a
 * deliberate revoke: the normal wording.
 * Run: node scripts/checks/accessibility-prompt.check.mts
 */
import assert from 'node:assert/strict'
import { accessibilityPrompt } from '../../src/shared/accessibility-prompt.ts'

type Facts = Parameters<typeof accessibilityPrompt>[0]
const NOW = '2.1.3'
const cases: Array<[Facts, string]> = [
  // Trusted, or no feature on: nothing to say
  [{ trusted: true, everGranted: true, lastTrustedVersion: NOW, currentVersion: NOW, featuresOn: true }, 'none'],
  [{ trusted: true, everGranted: false, currentVersion: NOW, featuresOn: true }, 'none'],
  [{ trusted: true, everGranted: false, currentVersion: NOW, featuresOn: false }, 'none'],
  [{ trusted: false, everGranted: true, lastTrustedVersion: '2.1.2', currentVersion: NOW, featuresOn: false }, 'none'],
  [{ trusted: false, everGranted: false, currentVersion: NOW, featuresOn: false }, 'none'],
  // Never granted on this Mac: the first-time set-up
  [{ trusted: false, everGranted: false, currentVersion: NOW, featuresOn: true }, 'first-run'],
  // Trusted under an earlier version, missing now: an update made macOS forget it
  [{ trusted: false, everGranted: true, lastTrustedVersion: '2.1.2', currentVersion: NOW, featuresOn: true }, 'forgot-after-update'],
  // Record from before versions were stored: the update case is the one that shipped
  [{ trusted: false, everGranted: true, lastTrustedVersion: null, currentVersion: NOW, featuresOn: true }, 'forgot-after-update'],
  [{ trusted: false, everGranted: true, currentVersion: NOW, featuresOn: true }, 'forgot-after-update'],
  // Same version, was trusted, now off: a deliberate revoke, normal wording
  [{ trusted: false, everGranted: true, lastTrustedVersion: NOW, currentVersion: NOW, featuresOn: true }, 'first-run']
]
for (const [input, want] of cases) {
  assert.equal(accessibilityPrompt(input), want, JSON.stringify(input))
}
console.log('accessibility-prompt check: OK')
