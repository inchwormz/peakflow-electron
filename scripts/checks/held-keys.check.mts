/**
 * Check (review S7): ⇧⌘N and ⇧⌘Q are taken only while a paste queue,
 * workflow or form fill runs, and given back when it ends. Drives the real
 * HeldKeys class and the paste-run notifier with a fake globalShortcut.
 * Run: node scripts/checks/held-keys.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, srcUrl } from './fixtures/ts-hooks.mjs'
installTsHooks()
const { HeldKeys } = await import(srcUrl('src/main/held-keys.ts'))
const { onPasteRunChanged, pasteRunChanged } = await import(srcUrl('src/main/services/paste-run.ts'))

const os = new Map<string, () => void>()
const api = {
  register: (a: string, fn: () => void) => (os.has(a) ? false : (os.set(a, fn), true)),
  unregister: (a: string) => void os.delete(a),
  isRegistered: (a: string) => os.has(a)
}
let pasted = 0
const keys = new HeldKeys(api, [
  { accel: 'CommandOrControl+Shift+N', action: () => pasted++ },
  { accel: 'CommandOrControl+Shift+Q', action: () => {} }
])

let running = false
onPasteRunChanged(() => keys.sync(running))

assert.equal(os.size, 0, 'nothing held at start: Chrome’s ⇧⌘N still works')
running = true
pasteRunChanged()
assert.deepEqual([...os.keys()].sort(), ['CommandOrControl+Shift+N', 'CommandOrControl+Shift+Q'], 'held while a run is going')
os.get('CommandOrControl+Shift+N')!()
assert.equal(pasted, 1)
pasteRunChanged() // a second change while running doesn't double-register
assert.equal(os.size, 2)
running = false
pasteRunChanged()
assert.equal(os.size, 0, 'released when the run ends')

// A key another part of PeakFlow already holds is left alone, and never released by us
os.set('CommandOrControl+Shift+Q', () => {})
running = true
pasteRunChanged()
assert.equal(keys.isHeld('CommandOrControl+Shift+Q'), false)
running = false
pasteRunChanged()
assert.equal(os.has('CommandOrControl+Shift+Q'), true, 'not ours, not released')

// A listener that throws doesn't stop the others
let after = 0
onPasteRunChanged(() => { throw new Error('boom') })
onPasteRunChanged(() => after++)
const warn = console.warn
console.warn = () => {}
pasteRunChanged()
console.warn = warn
assert.equal(after, 1)

console.log('held-keys: ok')
