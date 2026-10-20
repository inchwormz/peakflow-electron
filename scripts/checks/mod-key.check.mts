/**
 * Check: QuickBoard quick paste (1–9) and Save use ⌘ on a Mac and Ctrl on
 * Windows, with matching labels (Sol review P2 #5).
 * Run: node scripts/checks/mod-key.check.mts
 */
import assert from 'node:assert/strict'
import { isPrimaryMod, isSwitchMod, modLabel } from '../../src/shared/mod-key.ts'

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

// Panel menu labels and keys (switcher menu, 20 Oct): settings and quit
assert.equal(modLabel(',', false), 'Ctrl+,')
assert.equal(modLabel('Q', false), 'Ctrl+Q')
assert.equal(modLabel(',', true), '⌘,')
assert.equal(modLabel('Q', true), '⌘Q')
assert.equal(isPrimaryMod(k(false, true), false), true, 'Ctrl+, / Ctrl+Q on Windows')

// Tool switch: ⌥⌘1–4 on a Mac, Alt+Ctrl+1–4 on Windows
assert.equal(isSwitchMod(k(true, false, true), true), true)
assert.equal(isSwitchMod(k(false, true, true), false), true)
assert.equal(isSwitchMod(k(false, true, true), true), false, 'Ctrl+⌥ on a Mac is not the switch')
assert.equal(isSwitchMod(k(false, true, false), false), false, 'Ctrl alone is not the switch')

console.log('mod-key: ok')
