/**
 * Check: the Dictation tool page in the panel (John, 24 Oct 2026: "dictation
 * should be its own simple product in the launch"). The page's rules live in
 * src/shared/dictation-view.ts; this checks them, plus the wiring that moves
 * dictation out of Launcher Settings.
 * Run: node scripts/checks/dictation-tool.check.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import * as v from '../../src/shared/dictation-view.ts'

const src = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const offered = [5, 10, 20] as const
const bal = { state: 'ok', balanceMicros: 4_070_000, minutesLeft: 900, disabled: false, blocked: null, amounts: [...offered] } as const
const settings = { enabled: true, hasKey: true, ownKey: false, viaAddon: true, holdKey: 'fn', model: 'gpt-transcribe', cleanup: true, wordCount: 0, active: true } as const
const granted = { microphone: 'granted', accessibility: true } as const

// ─── paying ──────────────────────────────────────────────────────────────────

test('add-on off (hidden account) or no buy links: own key only, never a buy button', () => {
  assert.deepEqual(v.payView({ state: 'hidden' }), { kind: 'own-key' })
  assert.deepEqual(v.payView(undefined), { kind: 'own-key' })
  assert.deepEqual(v.payView({ state: 'no_addon', amounts: [] }), { kind: 'own-key' })
  assert.deepEqual(v.payView({ state: 'no_addon' }), { kind: 'own-key' })
})

test('before the first purchase: Get dictation with the amount choice', () => {
  const view = v.payView({ state: 'no_addon', amounts: [...offered] })
  assert.deepEqual(view, { kind: 'buy', amounts: [5, 10, 20] })
  assert.equal(v.buyLabel(view, 5), 'Get dictation')
})

test('[AM1 kept] one amount and no choice: Get dictation names the price', () => {
  for (const a of [5, 10, 20] as const) assert.equal(v.buyLabel(v.payView({ state: 'no_addon', amounts: [a] }), a), `Get dictation for US$${a}`)
})

test('[AM2 kept] a chosen amount no longer offered falls back to the smallest offered one', () => {
  assert.equal(v.pickAmount([5, 20], 10), 5)
  assert.equal(v.pickAmount([10, 20], 20), 20)
  assert.equal(v.pickAmount([10, 20], null), 10)
  assert.equal(v.pickAmount([], 5), undefined)
})

test('with a balance: the line shows dollars and about how long it lasts, and Add any offered amount', () => {
  const view = v.payView(bal)
  assert.equal(view.kind, 'balance')
  if (view.kind !== 'balance') return
  assert.equal(view.line, 'US$4.07 left · about 15 hours')
  assert.equal(view.notice, null)
  assert.deepEqual(view.amounts, [5, 10, 20])
  assert.equal(view.paused, false)
  assert.equal(v.buyLabel(view, 10), 'Add US$10')
})

test('low balance: same Add choice, the line counts minutes under an hour', () => {
  const view = v.payView({ ...bal, state: 'low', balanceMicros: 120_000, minutesLeft: 26.4 })
  assert.equal(view.kind === 'balance' && view.line, 'US$0.12 left · about 26 minutes')
  assert.equal(v.balanceLine(270_000, 60), 'US$0.27 left · about 1 hour')
  assert.equal(v.balanceLine(5_000, 1), 'US$0.01 left · about 1 minute')
})

test('only amounts with a buy link are offered', () => {
  const view = v.payView({ ...bal, amounts: [5, 20] })
  assert.deepEqual(view.kind === 'balance' && view.amounts, [5, 20])
})

test('paused (empty, or a negative balance after a refund): notice, no balance line, Add still offered [A2 kept]', () => {
  for (const acc of [{ ...bal, state: 'empty', balanceMicros: 0, minutesLeft: 0 }, { ...bal, state: 'low', balanceMicros: -50_000, minutesLeft: 0 }] as const) {
    const view = v.payView(acc)
    assert.equal(view.kind, 'balance')
    if (view.kind !== 'balance') continue
    assert.equal(view.line, null)
    assert.equal(view.notice, 'Dictation is paused. Top up to keep going.')
    assert.deepEqual(view.amounts, [5, 10, 20])
    assert.equal(view.paused, true)
  }
})

test('[A1 kept] a disabled account (chargeback) is never offered a top-up', () => {
  for (const acc of [{ ...bal, disabled: true }, { ...bal, blocked: 'disabled' }, { ...bal, state: 'empty', disabled: true }] as const) {
    const view = v.payView(acc)
    assert.equal(view.kind === 'balance' && view.amounts.length, 0)
    assert.equal(view.kind === 'balance' && view.line, null)
    assert.equal(view.kind === 'balance' && view.notice, v.COPY.disabled)
  }
})

test('daily limit: notice plus the balance still shown', () => {
  const view = v.payView({ ...bal, blocked: 'daily_limit' })
  assert.equal(view.kind === 'balance' && view.notice, v.COPY.dailyLimit)
  assert.equal(view.kind === 'balance' && view.line, 'US$4.07 left · about 15 hours')
})

test('a third computer: devices notice, nothing to buy', () => {
  assert.deepEqual(v.payView({ state: 'devices' }), { kind: 'devices' })
})

// ─── permissions and status ──────────────────────────────────────────────────

test('missing permission: Accessibility first, then Microphone; unknown (not a Mac) counts as fine', () => {
  assert.equal(v.missingPermission(granted), null)
  assert.equal(v.missingPermission({ microphone: 'unknown', accessibility: true }), null)
  assert.equal(v.missingPermission({ microphone: 'denied', accessibility: false }), 'accessibility')
  for (const m of ['denied', 'not-determined', 'restricted'] as const) assert.equal(v.missingPermission({ microphone: m, accessibility: true }), 'microphone')
  assert.equal(v.missingPermission(undefined), null)
})

test('header status: Off, On, Needs access, Paused (only when the balance is what it runs on)', () => {
  assert.equal(v.dictationStatus(undefined, bal, granted), '')
  assert.equal(v.dictationStatus({ ...settings, enabled: false }, bal, granted), 'Off')
  assert.equal(v.dictationStatus(settings, bal, granted), 'On')
  assert.equal(v.dictationStatus(settings, bal, { microphone: 'denied', accessibility: true }), 'Needs access')
  const empty = { ...bal, state: 'empty', balanceMicros: 0, minutesLeft: 0 } as const
  assert.equal(v.dictationStatus(settings, empty, granted), 'Paused')
  assert.equal(v.dictationStatus({ ...settings, ownKey: true }, empty, granted), 'On', 'their own key takes over')
  assert.equal(v.dictationStatus(settings, { ...bal, blocked: 'daily_limit' }, granted), 'Paused')
})

test('hold key names and the how-to line', () => {
  assert.equal(v.howTo(v.holdKeyName('fn', true)), 'Hold fn, talk, let go')
  assert.equal(v.howTo(v.holdKeyName('rctrl', false)), 'Hold Right Ctrl, talk, let go')
  assert.deepEqual(v.holdKeys(false).map(([k]) => k), ['rctrl', 'ralt'])
  assert.deepEqual(v.holdKeys(true).map(([k]) => k), ['fn', 'ropt', 'rcmd', 'rctrl'])
})

// ─── wiring ──────────────────────────────────────────────────────────────────

test('Launcher Settings no longer holds dictation; it points to the Dictation tool', () => {
  const launcher = src('src/renderer/src/launcher/LauncherApp.tsx')
  assert.ok(!launcher.includes('DictationAccountRow'), 'no balance row in the launcher')
  assert.ok(!launcher.includes('function DictationRows'), 'no dictation rows in the launcher')
  assert.ok(!launcher.includes('DICTATION_SAVE_KEY'), 'the key is entered in the tool, not the launcher')
  assert.ok(launcher.includes("IPC_INVOKE.PANEL_SHOW, 'dictation'"), 'one line opens the tool')
})

test('the pill points people to the Dictation tool, not Launcher Settings', () => {
  const main = src('src/main/dictation/index.ts')
  assert.ok(!main.includes('Launcher Settings'))
})

test('the panel and the launcher may both change dictation; the pill may not', () => {
  const main = src('src/main/dictation/index.ts')
  assert.ok(/fromUi = \(e[^)]*\)[^\n]*getLauncherContents\(\)[^\n]*getPanel\(\)/.test(main), 'fromUi accepts launcher and panel')
  for (const ch of ['DICTATION_ACCOUNT', 'DICTATION_CHECKOUT', 'DICTATION_SET,', 'DICTATION_SAVE_KEY', 'DICTATION_REMOVE_KEY', 'DICTATION_SET_WORDS', 'DICTATION_ALLOW']) {
    const line = main.split('\n').find((l) => l.includes(`IPC_INVOKE.${ch}`))
    assert.ok(line, ch)
    const at = main.indexOf(line!)
    assert.ok(main.slice(at, at + 200).includes('fromUi(e)'), `${ch} checks the sender`)
  }
})

test('Dictation sits in the switcher as the sixth tool, ungated like the free launcher it came from', () => {
  const tools = src('src/renderer/src/panel/tools/index.ts')
  assert.ok(/TOOL_MODULES[^\n]*snapgridTool, dictationTool\]/.test(tools))
  const page = src('src/renderer/src/panel/tools/dictation/index.tsx')
  assert.ok(page.includes('ungated: true'))
  const panel = src('src/renderer/src/panel/PanelApp.tsx')
  // The switch keys come from @shared/global-keys (fix/shortcuts-and-setup): ⌥⌘6 is the sixth, on a Mac only
  const keys = src('src/shared/global-keys.ts')
  assert.ok(keys.includes('[1, 2, 3, 4, 5, 6].map'), 'six switch keys')
  assert.ok(src('src/shared/tool-ids.ts').includes("DICTATION_SWITCH_KEY = 'Alt+CommandOrControl+6'"))
  assert.ok(panel.includes('Digit[1-6]'))
  for (const f of ['src/main/hotkeys.ts', 'src/main/tray.ts']) {
    assert.ok(src(f).includes('builtInAccel(DICTATION_SWITCH_KEY, process.platform)'), `${f}: no ⌥⌘6 on Windows (AltGr+6)`)
  }
  assert.ok(panel.includes("!TOOL_BY_ID[routeTool].ungated"), "ToolGate skips ungated tools")
})

test('[R1] the header status follows the switch: main broadcasts every settings change and the page reloads', () => {
  const main = src('src/main/dictation/index.ts')
  const page = src('src/renderer/src/panel/tools/dictation/index.tsx')
  assert.ok(page.includes('useIpcEvent(IPC_SEND.DICTATION_SETTINGS_CHANGED, reloadS)'))
  const handler = (ch: string): string => { const at = main.indexOf(`IPC_INVOKE.${ch},`); return main.slice(at, main.indexOf('\n  h(', at + 10)) }
  for (const ch of ['DICTATION_SET', 'DICTATION_SET_WORDS', 'DICTATION_REMOVE_KEY']) assert.ok(handler(ch).includes('settingsChanged()'), ch)
  const save = main.slice(main.indexOf('async function saveKey'), main.indexOf('function registerIpc'))
  assert.ok(save.includes('settingsChanged()'), 'saving a key')
  const refresh = main.slice(main.indexOf('function refreshAddon'), main.indexOf('function settingsChanged'))
  assert.ok(refresh.includes('settingsChanged()'), 'the add-on starting or stopping')
  const run = main.slice(main.indexOf('async function runClipSteps'), main.indexOf('let text = r.text'))
  assert.equal((run.match(/keepClip\(/g) ?? []).length, 2, 'a clip kept or cleared')
  const keep = main.slice(main.indexOf('function keepClip'), main.indexOf('/** Keep recording this long'))
  assert.ok(keep.includes('if (had || keptClip) settingsChanged()'), 'keepClip tells the page')
})

test('release 2.1.1: the dictation permission row uses the shared Mac permission wording and guide', () => {
  const page = src('src/renderer/src/panel/tools/dictation/index.tsx')
  // Same notice as SnapGrid and FocusDim (fix/shortcuts-and-setup wording, feat/permission-guide steps)
  assert.ok(page.includes('<PermissionNotice kind={missing}'), 'shared notice')
  assert.ok(page.includes("guideCopy('microphone', false).title"), 'shared title before macOS has asked')
  assert.ok(!page.includes('PERMISSION_TEXT'), 'no private permission wording left')
  const main = src('src/main/dictation/index.ts')
  assert.ok(!main.includes('openMediaSettings'), 'opens Settings through openPermissionPane')
  assert.ok(main.includes('watchForFix(missing'), 'All set when it works again')
})
