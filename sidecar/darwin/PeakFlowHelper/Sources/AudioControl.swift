/**
 * CoreAudio mic mute control for macOS.
 *
 * Uses AudioObjectGetPropertyData / AudioObjectSetPropertyData to read and
 * toggle the mute state of the default input (capture) device.
 */

import CoreAudio
import Foundation

// MARK: - Constants

private let kAudioObjectSystemObject: AudioObjectID = 1

private var defaultInputDeviceAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)

private func muteAddress() -> AudioObjectPropertyAddress {
    return AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyMute,
        mScope: kAudioDevicePropertyScopeInput,
        mElement: kAudioObjectPropertyElementMain
    )
}

// MARK: - Helpers

private func getDefaultInputDevice() -> AudioDeviceID? {
    var deviceId: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)

    let status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &defaultInputDeviceAddress,
        0, nil,
        &size, &deviceId
    )

    return status == noErr ? deviceId : nil
}

private func getMuteValue(device: AudioDeviceID) -> Bool? {
    var address = muteAddress()
    var muted: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)

    let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &muted)
    return status == noErr ? (muted == 1) : nil
}

private func setMuteValue(device: AudioDeviceID, muted: Bool) -> Bool? {
    var address = muteAddress()
    var value: UInt32 = muted ? 1 : 0
    let size = UInt32(MemoryLayout<UInt32>.size)

    let status = AudioObjectSetPropertyData(device, &address, 0, nil, size, &value)
    if status != noErr { return nil }

    // Read back to confirm
    return getMuteValue(device: device)
}

// MARK: - Public API (returns JSON strings)

func getMicMuteState() -> String {
    guard let device = getDefaultInputDevice() else {
        return "{\"muted\":false,\"error\":\"No microphone found\"}"
    }
    guard let muted = getMuteValue(device: device) else {
        return "{\"muted\":false,\"error\":\"Failed to read mute state\"}"
    }
    return "{\"muted\":\(muted),\"error\":null}"
}

func setMicMute(muted: Bool) -> String {
    guard let device = getDefaultInputDevice() else {
        return "{\"muted\":false,\"error\":\"No microphone found\"}"
    }
    guard let result = setMuteValue(device: device, muted: muted) else {
        return "{\"muted\":false,\"error\":\"Failed to set mute state\"}"
    }
    return "{\"muted\":\(result),\"error\":null}"
}

func toggleMicMute() -> String {
    guard let device = getDefaultInputDevice() else {
        return "{\"muted\":false,\"error\":\"No microphone found\"}"
    }
    guard let current = getMuteValue(device: device) else {
        return "{\"muted\":false,\"error\":\"Failed to read mute state\"}"
    }
    guard let result = setMuteValue(device: device, muted: !current) else {
        return "{\"muted\":false,\"error\":\"Failed to toggle mute\"}"
    }
    return "{\"muted\":\(result),\"error\":null}"
}
