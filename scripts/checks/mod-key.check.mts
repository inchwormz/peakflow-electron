/**
 * Check: QuickBoard quick paste (1–9) and Save use ⌘ on a Mac and Ctrl on
 * Windows, with matching labels (Sol review P2 #5).
 * Run: node scripts/checks/mod-key.check.mts
 */
import assert from 'node:assert/strict'
import { isPrimaryMod, modLabel } from '../../src/shared/mod-key.ts'

const k = (meta: boolean, ctrl: boolean, alt = false) => ({ metaKey: meta, ctrlKey: ctrl, altKey: alt })

assert.equal(isPrimaryMod(k(true, false), true), true, '⌘ on Mac')
assert.equal(isPrimaryMod(k(false, true), true), false, 'Ctrl on Mac is not the shortcut')
assert.equal(isPrimaryMod(k(false, true), false), true, 'Ctrl on Windows')
assert.equal(isPrimaryMod(k(true, false), false), false, 'Win key on Windows is not the shortcut')
assert.equal(isPrimaryMod(k(false, true, true), false), false, 'AltGr / Ctrl+Alt passes through')
assert.equal(isPrimaryMod(k(true, false, true), true), false, '⌥⌘ is the tool switcher, not quick paste')

assert.equal(modLabel('1', true), '⌘1')
assert.equal(modLabel('1', false), 'Ctrl+1')
assert.equal(modLabel('S', false), 'Ctrl+S')

console.log('mod-key: ok')
