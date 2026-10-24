/**
 * Check: the Accessibility prompt decision (review S1): trusted or no feature
 * on means nothing; missing and never granted means first run; missing after
 * it was granted means macOS forgot PeakFlow after an update.
 * Run: node scripts/checks/accessibility-prompt.check.mts
 */
import assert from 'node:assert/strict'
import { accessibilityPrompt } from '../../src/shared/accessibility-prompt.ts'

const cases: Array<[Parameters<typeof accessibilityPrompt>[0], string]> = [
  [{ trusted: true, everGranted: true, featuresOn: true }, 'none'],
  [{ trusted: true, everGranted: false, featuresOn: true }, 'none'],
  [{ trusted: true, everGranted: false, featuresOn: false }, 'none'],
  [{ trusted: false, everGranted: true, featuresOn: false }, 'none'],
  [{ trusted: false, everGranted: false, featuresOn: false }, 'none'],
  [{ trusted: false, everGranted: false, featuresOn: true }, 'first-run'],
  [{ trusted: false, everGranted: true, featuresOn: true }, 'forgot-after-update']
]
for (const [input, want] of cases) {
  assert.equal(accessibilityPrompt(input), want, JSON.stringify(input))
}
console.log('accessibility-prompt check: OK')
