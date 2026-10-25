type Device = { kind: string; deviceId: string; label: string }
export function microphoneOptions(devices: readonly Device[]): Array<[string, string]> {
  return [['', 'System default'], ...devices.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d): [string, string] => [d.deviceId, d.label])]
}
export function microphoneId(chosen: string, devices: readonly Device[]): string {
  return microphoneOptions(devices).some(([id]) => id === chosen) ? chosen : ''
}

/** Ask immediately, preserving first-sample latency. Retry only a missing chosen device. */
export async function openMicrophone<T>(get: (constraints: { audio: { channelCount: number; sampleRate: { ideal: number }; echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean; deviceId?: { exact: string } } }) => Promise<T>, chosen: string, processing: boolean, current: () => boolean): Promise<T> {
  const audio = { channelCount: 1, sampleRate: { ideal: 24000 }, echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing }
  try {
    return await get({ audio: { ...audio, ...(chosen ? { deviceId: { exact: chosen } } : {}) } })
  } catch (error) {
    const name = (error as { name?: string }).name
    if (!chosen || !current() || (name !== 'NotFoundError' && name !== 'OverconstrainedError')) throw error
    return get({ audio })
  }
}
