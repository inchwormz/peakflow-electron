/**
 * Check: copying files clears the remembered image, so copying the same image
 * again afterwards is recorded (Sol review P3 #6).
 * Run: node scripts/checks/clip-dedupe.check.mts
 */
import assert from 'node:assert/strict'
import { afterFileCapture } from '../../src/main/services/clip-dedupe.ts'

// Image A copied, then a file, then image A again
let s = { lastTextHash: '', lastImageHash: 'A', lastFileKey: '' }
s = afterFileCapture('/x/report.pdf', 'names')
assert.equal(s.lastImageHash, '', 'image memory cleared')
assert.equal(s.lastFileKey, '/x/report.pdf')
assert.equal(s.lastTextHash, 'names', "file names aren't recorded as text")
const isNewImage = (hash: string) => hash !== s.lastImageHash
assert.equal(isNewImage('A'), true, 'same image copied again is recorded')

console.log('clip-dedupe: ok')
