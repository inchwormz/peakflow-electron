/**
 * Native keyboard simulation using Win32 SendInput API via koffi.
 *
 * Used by QuickBoard to simulate Ctrl+V paste after writing to clipboard.
 */

import koffi from 'koffi'

// ─── Win32 types and bindings ────────────────────────────────────────────────

const user32 = koffi.load('user32.dll')

// INPUT struct for SendInput — keyboard variant
// INPUT_KEYBOARD = 1
// sizeof(INPUT) = 40 on x64 (type:4 + padding:4 + ki:24 + padding:8)
// KEYBDINPUT: wVk(2) + wScan(2) + dwFlags(4) + time(4) + dwExtraInfo(8) = 20 bytes

const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr'
})

const INPUT_KEYBOARD = koffi.struct('INPUT_KEYBOARD', {
  type: 'uint32',
  _padding1: 'uint32',
  ki: KEYBDINPUT,
  _padding2: koffi.array('uint8', 8)
})

const SendInput = user32.func('SendInput', 'uint32', [
  'uint32',                           // nInputs
  koffi.pointer(INPUT_KEYBOARD),      // pInputs
  'int'                               // cbSize
])

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
  try {
    const sizeOfInput = koffi.sizeof(INPUT_KEYBOARD)

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

    const result = SendInput(inputs.length, inputs, sizeOfInput)
    return result === inputs.length
  } catch (error) {
    console.error('[Keyboard] SendInput error:', error)
    return false
  }
}

function makeKeyInput(vk: number, flags: number): InstanceType<typeof INPUT_KEYBOARD> {
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
  } as unknown as InstanceType<typeof INPUT_KEYBOARD>
}
