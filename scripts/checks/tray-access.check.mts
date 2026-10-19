/**
 * Check: the tray menu's FocusDim "Enable" goes through the access-checked
 * requestToggle(), never the raw toggle() (Sol review 2, P1). Loads the real
 * src/main/tray.ts; electron and the services are fakes.
 * Run: node scripts/checks/tray-access.check.mts
 */
import assert from 'node:assert/strict'
import { installTsHooks, fake, srcUrl } from './fixtures/ts-hooks.mjs'

const g = globalThis as unknown as { __tray: { calls: string[]; enabled: boolean } }
g.__tray = { calls: [], enabled: false }
const S = 'globalThis.__tray'
installTsHooks({
  electron: fake(`export const Tray = class {}; export const Menu = { buildFromTemplate: (t) => t };
    export const app = { getLoginItemSettings: () => ({ openAtLogin: false }), getAppPath: () => '/x', isPackaged: false };
    export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) };`),
  '@electron-toolkit/utils': fake('export const is = { dev: true }'),
  './windows': fake(`export const openToolWithAccessCheck = (id) => ${S}.calls.push('open:' + id)`),
  './panel': fake(`export const setPanelAnchor = () => {}; export const togglePanel = () => {};
    export const showPanel = (r) => ${S}.calls.push('panel:' + r)`),
  './services/auto-updater': fake('export const checkForUpdates = () => {}'),
  './security/trial': fake('export const isToolInstalled = () => true'),
  './services/bug-report': fake('export const sendViaEmail = () => {}; export const revealLogFile = () => {}'),
  './services/config-store': fake(`export const getConfig = () => ({ hotkey: 'CommandOrControl+Shift+D' })`),
  './services/focus-dim': fake(`export const getFocusDimService = () => ({
    getState: () => ({ enabled: ${S}.enabled, opacity: 0.5 }),
    toggle: () => ${S}.calls.push('RAW-TOGGLE'),
    requestToggle: async () => { ${S}.calls.push('requestToggle') },
    setOpacity: (v) => ${S}.calls.push('opacity:' + v) })`)
})
const { buildContextMenu } = await import(srcUrl('src/main/tray.ts'))

type Item = { label?: string; submenu?: Item[]; click?: () => void }
const fdMenu = () => (buildContextMenu() as Item[]).find((i) => i.label === 'FocusDim')!.submenu!

// Enable (locked or not, the guard inside requestToggle decides)
fdMenu().find((i) => i.label === 'Enable')!.click!()
g.__tray.enabled = true
fdMenu().find((i) => i.label === 'Disable')!.click!()
// Intensity presets only change a setting; they never turn dimming on
fdMenu().find((i) => i.label === 'Heavy (70%)')!.click!()
// The other tools open the panel through the access-checked opener
const top = buildContextMenu() as Item[]
for (const name of ['Liquid Focus', 'ScreenSlap', 'QuickBoard']) top.find((i) => i.label === name)?.click?.()

assert.ok(!g.__tray.calls.includes('RAW-TOGGLE'), 'tray never calls the unguarded toggle()')
assert.deepEqual(g.__tray.calls.slice(0, 3), ['requestToggle', 'requestToggle', 'opacity:0.7'])
assert.deepEqual(g.__tray.calls.slice(3), ['open:liquidfocus', 'open:screenslap', 'open:quickboard'])

console.log('tray-access: ok')
