/**
 * macOS mic mute control via CoreAudio C API through koffi.
 *
 * Loads the CoreAudio framework and uses AudioObjectGetPropertyData /
 * AudioObjectSetPropertyData to read and toggle the mute state of
 * the default input (capture) device.
 *
 * CoreAudio is a pure C API (not Objective-C), so koffi can call it directly.
 */

import { BrowserWindow } from 'electron'
import { IPC_SEND } from '@shared/ipc-types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MicMuteResult {
  muted: boolean
  error: string | null
}

// ─── CoreAudio bindings via koffi (deferred to first use) ───────────────────

let loaded = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let K: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AudioObjectGetPropertyData: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AudioObjectSetPropertyData: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _AudioObjectPropertyAddress: any

function loadCoreAudio(): boolean {
  if (loaded) return true
  try {
    K = require('koffi')

    _AudioObjectPropertyAddress = K.struct('AudioObjectPropertyAddress', {
      mSelector: 'uint32',
      mScope: 'uint32',
      mElement: 'uint32'
    })

    const lib = K.load('/System/Library/Frameworks/CoreAudio.framework/CoreAudio')

    AudioObjectGetPropertyData = lib.func(
      'AudioObjectGetPropertyData', 'int32', [
        'uint32',                                      // inObjectID
        K.pointer(_AudioObjectPropertyAddress),        // inAddress
        'uint32',                                      // inQualifierDataSize
        'void *',                                      // inQualifierData
        K.inout(K.pointer('uint32')),                  // ioDataSize
        'void *'                                       // outData
      ]
    )

    AudioObjectSetPropertyData = lib.func(
      'AudioObjectSetPropertyData', 'int32', [
        'uint32',                                      // inObjectID
        K.pointer(_AudioObjectPropertyAddress),        // inAddress
        'uint32',                                      // inQualifierDataSize
        'void *',                                      // inQualifierData
        'uint32',                                      // inDataSize
        'void *'                                       // inData
      ]
    )

    loaded = true
    return true
  } catch (err) {
    console.error('[MicMute-Darwin] Failed to load CoreAudio:', err)
    return false
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const kAudioObjectSystemObject = 1
// 'dIn ' in big-endian → 0x64496E20
const kAudioHardwarePropertyDefaultInputDevice = 0x64496E20
// 'mute' in big-endian → 0x6D757465
const kAudioDevicePropertyMute = 0x6D757465
// 'inpt' in big-endian → 0x696E7074
const kAudioDevicePropertyScopeInput = 0x696E7074
// 'glob' in big-endian → 0x676C6F62
const kAudioObjectPropertyScopeGlobal = 0x676C6F62
// 'mast' in big-endian → 0x6D617374
const kAudioObjectPropertyElementMain = 0x6D617374

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDefaultInputDevice(): number | null {
  const address = {
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  }
  const size = [4]
  const deviceId = Buffer.alloc(4)

  const status = (AudioObjectGetPropertyData as Function)(
    kAudioObjectSystemObject, address, 0, null, size, deviceId
  )
  if (status !== 0) return null
  return deviceId.readUInt32LE()
}

function getMuteValue(deviceId: number): boolean | null {
  const address = {
    mSelector: kAudioDevicePropertyMute,
    mScope: kAudioDevicePropertyScopeInput,
    mElement: kAudioObjectPropertyElementMain
  }
  const size = [4]
  const muted = Buffer.alloc(4)

  const status = (AudioObjectGetPropertyData as Function)(
    deviceId, address, 0, null, size, muted
  )
  if (status !== 0) return null
  return muted.readUInt32LE() === 1
}

function setMuteValue(deviceId: number, muted: boolean): boolean | null {
  const address = {
    mSelector: kAudioDevicePropertyMute,
    mScope: kAudioDevicePropertyScopeInput,
    mElement: kAudioObjectPropertyElementMain
  }
  const value = Buffer.alloc(4)
  value.writeUInt32LE(muted ? 1 : 0)

  const status = (AudioObjectSetPropertyData as Function)(
    deviceId, address, 0, null, 4, value
  )
  if (status !== 0) return null

  // Read back to confirm
  return getMuteValue(deviceId)
}

// ─── Broadcast helper ───────────────────────────────────────────────────────

function broadcastMuteState(muted: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_SEND.MIC_MUTE_CHANGED, muted)
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getMicMuteState(): Promise<MicMuteResult> {
  if (!loadCoreAudio()) {
    return { muted: false, error: 'CoreAudio not available' }
  }
  try {
    const deviceId = getDefaultInputDevice()
    if (deviceId === null) {
      return { muted: false, error: 'No microphone found' }
    }
    const muted = getMuteValue(deviceId)
    if (muted === null) {
      return { muted: false, error: 'Failed to read mute state' }
    }
    return { muted, error: null }
  } catch (err) {
    return { muted: false, error: (err as Error).message }
  }
}

export async function setMicMute(muted: boolean): Promise<MicMuteResult> {
  if (!loadCoreAudio()) {
    return { muted: false, error: 'CoreAudio not available' }
  }
  try {
    const deviceId = getDefaultInputDevice()
    if (deviceId === null) {
      return { muted: false, error: 'No microphone found' }
    }
    const result = setMuteValue(deviceId, muted)
    if (result === null) {
      return { muted: false, error: 'Failed to set mute state' }
    }
    broadcastMuteState(result)
    return { muted: result, error: null }
  } catch (err) {
    return { muted: false, error: (err as Error).message }
  }
}

export async function toggleMicMute(): Promise<MicMuteResult> {
  if (!loadCoreAudio()) {
    return { muted: false, error: 'CoreAudio not available' }
  }
  try {
    const deviceId = getDefaultInputDevice()
    if (deviceId === null) {
      return { muted: false, error: 'No microphone found' }
    }
    const current = getMuteValue(deviceId)
    if (current === null) {
      return { muted: false, error: 'Failed to read mute state' }
    }
    const result = setMuteValue(deviceId, !current)
    if (result === null) {
      return { muted: false, error: 'Failed to toggle mute' }
    }
    broadcastMuteState(result)
    return { muted: result, error: null }
  } catch (err) {
    return { muted: false, error: (err as Error).message }
  }
}
