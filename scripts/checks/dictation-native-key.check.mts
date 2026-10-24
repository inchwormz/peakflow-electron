import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const swift = readFileSync(new URL('../../sidecar/darwin/PeakFlowHelper/Sources/Launcher.swift', import.meta.url), 'utf8')
const hook = readFileSync(new URL('../../src/main/launcher/expander.ts', import.meta.url), 'utf8')
assert.ok(swift.includes('hold-key-recorded'), 'Mac watcher must record native key codes')
assert.ok(swift.includes('CGEventType.keyUp.rawValue'), 'Mac watcher must swallow hold-key releases')
assert.ok(swift.includes('captureHoldKey'), 'Mac capture must use the existing watcher')
assert.ok(hook.includes('hold-key-recorded'), 'Windows watcher must record native key codes')
assert.ok(hook.includes('setHoldKeyCapture'), 'Capture must keep watcher running with dictation off')
assert.ok(hook.includes('return new IntPtr(1)'), 'Windows hook must swallow non-modifier hold keys')
console.log('Native hold-key wiring checks passed')
