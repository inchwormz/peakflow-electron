/**
 * Check: the focus-detection camera stops when detection is turned off
 * mid-session, or the session pauses or stops (Sol review P1 #2).
 * Run: node scripts/checks/camera-stop.check.mts
 */
import assert from 'node:assert/strict'
import { detectorShouldRun, stopStream } from '../../src/renderer/src/tools/liquidfocus/camera.ts'

const running = { mode: 'work', status: 'running' }
assert.equal(detectorShouldRun(true, running), true)
assert.equal(detectorShouldRun(false, running), false, 'detection turned off mid-session')
assert.equal(detectorShouldRun(true, { mode: 'work', status: 'paused' }), false, 'paused')
assert.equal(detectorShouldRun(true, { mode: 'work', status: 'idle' }), false, 'stopped')
assert.equal(detectorShouldRun(true, { mode: 'short_break', status: 'running' }), false, 'break')
assert.equal(detectorShouldRun(true, null), false)

// Every track is stopped, even if one throws
let stopped = 0
const track = () => ({ stop: () => { stopped++ } })
const bad = { stop: () => { stopped++; throw new Error('gone') } }
const stream = { getTracks: () => [track(), bad, track()] }
assert.equal(stopStream(stream), null)
assert.equal(stopped, 3)
assert.equal(stopStream(null), null)

console.log('camera-stop: ok')
