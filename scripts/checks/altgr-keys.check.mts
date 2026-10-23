/**
 * Check (review B5): on Windows, PeakFlow's built-in system-wide shortcuts
 * never use Ctrl+Alt with a character key, because Windows sends AltGr as
 * Ctrl+Alt (AltGr+E = € in German, AltGr+2 = @ in Spanish). Arrows stay.
 * Run: node scripts/checks/altgr-keys.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, srcUrl } from './fixtures/ts-hooks.mjs'
installTsHooks()
const { clashesWithAltGr, builtInAccel, switchAccel, launcherFallbacks, chooseLauncherKey } = await import(srcUrl('src/shared/global-keys.ts'))
const { SNAP_LAYOUTS, SNAP_UNDO_ACCEL, snapAccel } = await import(srcUrl('src/shared/snapgrid-layouts.ts'))

// The characters from the review
for (const k of ['E', 'Q', '2', '3', '7', '8', '9', '0', 'C', 'F', 'G', '`', 'Space', 'Shift+E']) {
  assert.equal(clashesWithAltGr(`Control+Alt+${k}`, 'win32'), true, `Ctrl+Alt+${k} is AltGr on Windows`)
  assert.equal(clashesWithAltGr(`Control+Alt+${k}`, 'darwin'), false, `⌃⌥${k} is fine on a Mac`)
}
assert.equal(clashesWithAltGr('Alt+CommandOrControl+1', 'win32'), true, 'switcher digits')
assert.equal(clashesWithAltGr('Control+Alt+Shift+D', 'win32'), true, 'AltGr+Shift types capitals (Ę)')
for (const k of ['Left', 'Right', 'Up', 'Down', 'Shift+Up', 'Shift+Right', 'Enter', 'Backspace', 'F5']) {
  assert.equal(clashesWithAltGr(`Control+Alt+${k}`, 'win32'), false, `Ctrl+Alt+${k} types nothing`)
}
assert.equal(clashesWithAltGr('CommandOrControl+Shift+V', 'win32'), false, 'no Alt, no AltGr')
assert.equal(clashesWithAltGr('Alt+Space', 'win32'), false, 'no Ctrl, no AltGr')

// SnapGrid on Windows: only the arrow, Enter and Backspace keys stay bound
const win = SNAP_LAYOUTS.filter((l) => snapAccel(l, 'win32'))
assert.deepEqual(win.map((l) => l.key).sort(), ['bottom', 'fill', 'left', 'next', 'right', 'top'])
assert.equal(builtInAccel(SNAP_UNDO_ACCEL, 'win32'), SNAP_UNDO_ACCEL)
assert.equal(SNAP_LAYOUTS.every((l) => snapAccel(l, 'darwin') === l.accel), true, 'Mac keeps every key')

// Tool switcher: ⌥⌘1–5 on a Mac, none on Windows
assert.equal(switchAccel(0, 'darwin'), 'Alt+CommandOrControl+1')
assert.equal(switchAccel(4, 'darwin'), 'Alt+CommandOrControl+5')
assert.equal(switchAccel(0, 'win32'), null)
assert.equal(switchAccel(9, 'darwin'), null)

// Launcher fallbacks never clash with AltGr on Windows
assert.equal(launcherFallbacks('win32').some((a) => clashesWithAltGr(a, 'win32')), false)
assert.equal(launcherFallbacks('darwin')[0], 'Control+Alt+Space', 'John’s own Mac shortcut is the first fallback')

// Launcher start-up: ⌥Space taken by Raycast → the first free fallback, and say so
const taken = new Set(['Alt+Space'])
const reg = (a: string) => !taken.has(a)
assert.deepEqual(chooseLauncherKey('Alt+Space', 'darwin', reg), { key: 'Control+Alt+Space', movedFrom: 'Alt+Space' })
taken.add('Control+Alt+Space')
assert.deepEqual(chooseLauncherKey('Alt+Space', 'darwin', reg), { key: 'Control+Shift+Space', movedFrom: 'Alt+Space' })
assert.deepEqual(chooseLauncherKey('Alt+Space', 'win32', reg), { key: 'Control+Shift+Space', movedFrom: 'Alt+Space' }, 'Windows never tries Ctrl+Alt+Space')
assert.deepEqual(chooseLauncherKey('Control+Alt+Space', 'darwin', () => true), { key: 'Control+Alt+Space' }, 'John’s saved key is kept')
assert.deepEqual(chooseLauncherKey('Alt+Space', 'darwin', () => false), { key: null }, 'nothing free')

console.log('altgr-keys: ok')
