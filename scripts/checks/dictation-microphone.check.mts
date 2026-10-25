import assert from 'node:assert/strict'
import { test } from 'node:test'
import { microphoneOptions, microphoneId, openMicrophone } from '../../src/shared/dictation-microphone.ts'

test('unlabelled devices show only default; missing choice silently selects default', () => {
  assert.deepEqual(microphoneOptions([{ kind: 'audioinput', deviceId: 'secret-id', label: '' }]), [['', 'System default']])
  const devices = [{ kind: 'audioinput', deviceId: 'usb', label: 'USB mic' }, { kind: 'audioinput', deviceId: 'default', label: 'Default mic' }]
  assert.deepEqual(microphoneOptions(devices), [['', 'System default'], ['usb', 'USB mic']])
  assert.equal(microphoneId('gone', devices), '')
  assert.equal(microphoneId('usb', devices), 'usb')
})
test('disconnected device falls back; permission denial never retries; cancellation skips fallback', async () => {
  const calls: unknown[] = []
  const get = async (c: unknown) => { calls.push(c); if (calls.length === 1) throw { name: 'NotFoundError' }; return 'stream' }
  assert.equal(await openMicrophone(get, 'usb', true, () => true), 'stream')
  assert.equal(calls.length, 2)
  assert.equal((calls[0] as any).audio.deviceId.exact, 'usb')
  assert.equal((calls[1] as any).audio.deviceId, undefined)
  let denied = 0
  await assert.rejects(() => openMicrophone(async () => { denied++; throw Error('denied') }, 'usb', true, () => true))
  assert.equal(denied, 1)
  let cancelled = 0
  await assert.rejects(() => openMicrophone(async () => { cancelled++; throw { name: 'OverconstrainedError' } }, 'usb', false, () => false))
  assert.equal(cancelled, 1)
})
