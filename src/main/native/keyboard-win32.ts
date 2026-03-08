/**
 * Native keyboard simulation using Win32 SendInput API via koffi.
 *
 * Used by QuickBoard to simulate Ctrl+V paste after writing to clipboard.
 *
 * All koffi/DLL bindings are deferred to first use via initBindings()
 * so this module can be safely imported on macOS without crashing.
 */

// ─── Lazy koffi bindings ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let K: any = null
let _KEYBDINPUT: any, _INPUT_KEYBOARD: any, _SendInput: any
let _bindingsReady = false

function initBindings(): void {
  if (_bindingsReady) return

  K = require('koffi')
  const user32 = K.load('user32.dll')

  _KEYBDINPUT = K.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })

  _INPUT_KEYBOARD = K.struct('INPUT_KEYBOARD', {
    type: 'uint32',
    _padding1: 'uint32',
    ki: _KEYBDINPUT,
    _padding2: K.array('uint8', 8)
  })

  _SendInput = user32.func('SendInput', 'uint32', [
    'uint32',
    K.pointer(_INPUT_KEYBOARD),
    'int'
  ])

  _bindingsReady = true
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INPUT_TYPE_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002

// Virtual key codes
const VK_CONTROL = 0x11
const VK_V = 0x56

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Simulate Ctrl+V keystroke to paste from clipboard.
 * Sends: Ctrl down → V down → V up → Ctrl up
 */
export function simulateCtrlV(): boolean {
  initBindings()
  try {
    const sizeOfInput = K.sizeof(_INPUT_KEYBOARD)

    const inputs = [
      // Ctrl down
      makeKeyInput(VK_CONTROL, 0),
      // V down
      makeKeyInput(VK_V, 0),
      // V up
      makeKeyInput(VK_V, KEYEVENTF_KEYUP),
      // Ctrl up
      makeKeyInput(VK_CONTROL, KEYEVENTF_KEYUP)
    ]

    const result = _SendInput(inputs.length, inputs, sizeOfInput)
    return result === inputs.length
  } catch (error) {
    console.error('[Keyboard] SendInput error:', error)
    return false
  }
}

function makeKeyInput(vk: number, flags: number): unknown {
  return {
    type: INPUT_TYPE_KEYBOARD,
    _padding1: 0,
    ki: {
      wVk: vk,
      wScan: 0,
      dwFlags: flags,
      time: 0,
      dwExtraInfo: 0
    },
    _padding2: [0, 0, 0, 0, 0, 0, 0, 0]
  }
}
