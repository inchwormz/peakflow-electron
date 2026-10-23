/** Regression: window height follows the page/menu geometry, never a spare header. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { panelHeight, HEAD_H, BODY_PAD, FLUSH_BODY_PAD, MENU_TOP, MENU_INSET } from '../../src/renderer/src/panel/panel-height.ts'

// Guard the helper against drift from the actual CSS (including symmetric width).
const css = readFileSync(new URL('../../src/renderer/src/panel/panel.css', import.meta.url), 'utf8')
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `missing ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}
assert.ok(rule('.pf .panel').includes('width: 100%'))
assert.ok(rule('.pf .p-head').includes(`height: ${HEAD_H}px`))
assert.ok(rule('.pf .p-body').includes('padding: 12px 16px 16px'))
assert.equal(BODY_PAD, 12 + 16)
assert.ok(rule('.pf .p-body.flush').includes('padding: 6px 8px 8px'))
assert.equal(FLUSH_BODY_PAD, 6 + 8)
const menuCss = rule('.pf .ddm')
assert.ok(menuCss.includes(`top: ${MENU_TOP}px`))
assert.ok(menuCss.includes(`left: ${MENU_INSET}px`))
assert.ok(menuCss.includes(`right: ${MENU_INSET}px`))

// Short page, open/close, and the asynchronous trial line growing the menu.
assert.equal(panelHeight(120, 290, false), 336)
assert.equal(panelHeight(120, null, false), 192)
assert.equal(panelHeight(120, 320, false), 366)
assert.equal(panelHeight(120, null, false), 192)
assert.equal(panelHeight(120, null, false, true), 178, 'flush pages use their own padding')
// Real page content remains visible beneath the overlay on taller routes.
assert.equal(panelHeight(400, 290, false), 472)
assert.equal(panelHeight(50, null, true), 280)
assert.equal(panelHeight(400, null, true), 472, 'dialog must not shrink a tall page')

console.log('panel-height: ok')
