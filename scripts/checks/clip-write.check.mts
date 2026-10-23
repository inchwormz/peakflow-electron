/**
 * Check: the paste queue writes file clips as files, and never pastes when
 * nothing was written (Sol review P2 #4).
 * Run: node scripts/checks/clip-write.check.mts
 */
import assert from 'node:assert/strict'
import { writeClip, type ClipWriters } from '../../src/main/services/clip-write.ts'

let log: string[] = []
const w = (filesOk = true, imageOk = true): ClipWriters => ({
  text: (t) => { log.push(`text:${t}`) },
  image: (p) => { log.push(`image:${p}`); return imageOk },
  files: (p) => { log.push(`files:${p.join(',')}`); return filesOk }
})

// A file clip writes its files, not text
assert.equal(writeClip({ type: 'file', text: 'report.pdf', filePaths: ['/x/report.pdf'] }, w()), true)
assert.deepEqual(log, ['files:/x/report.pdf'])

// File write fails, or no paths: nothing written, so the caller sends no paste
log = []
assert.equal(writeClip({ type: 'file', text: null, filePaths: ['/x/a'] }, w(false)), false)
assert.equal(writeClip({ type: 'file', text: null, filePaths: [] }, w()), false)
assert.deepEqual(log, ['files:/x/a'])

// Text prefers the edit; an override wins; empty text writes nothing
log = []
assert.equal(writeClip({ type: 'text', text: 'a', editedText: 'b' }, w()), true)
assert.equal(writeClip({ type: 'text', text: 'a' }, w(), 'c'), true)
assert.equal(writeClip({ type: 'text', text: '' }, w()), false)
assert.deepEqual(log, ['text:b', 'text:c'])

// Image: missing path or failed load writes nothing
log = []
assert.equal(writeClip({ type: 'image', text: null }, w()), false)
assert.equal(writeClip({ type: 'image', text: null, imagePath: '/i.png' }, w(true, false)), false)
assert.equal(writeClip({ type: 'image', text: null, imagePath: '/i.png' }, w()), true)

console.log('clip-write: ok')
