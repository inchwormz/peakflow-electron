/**
 * Check: password-manager clips are recognised, personal details are blanked
 * before anything goes to the AI, and AI replies parse with or without fences.
 * Run: node scripts/checks/quickboard-private.check.mts
 */
import assert from 'node:assert/strict'
import { isPrivateClipboard, redactPersonalInfo } from '../../src/main/security/secret-detection.ts'
import { parseJsonReply } from '../../src/main/services/clipboard-ai-prompts.ts'

const on = (...f: string[]) => (x: string) => f.includes(x)
assert.equal(isPrivateClipboard(on('public.utf8-plain-text', 'org.nspasteboard.ConcealedType')), true, '1Password on Mac')
assert.equal(isPrivateClipboard(on('ExcludeClipboardContentFromMonitorProcessing')), true, 'Windows password manager')
assert.equal(isPrivateClipboard(on('public.utf8-plain-text')), false, 'ordinary text')
assert.equal(isPrivateClipboard(() => { throw new Error('x') }), false, 'a failing check never blocks capture')

const r = redactPersonalInfo('Mail jo@example.com or call +64 21 555 0199, key ghp_abcdefghijklmnopqrstuvwxyz0123456789AB, see SIT-612 in 2026')
assert.ok(!r.includes('jo@example.com') && r.includes('[email]'), r)
assert.ok(r.includes('[phone]') && !r.includes('555 0199'), r)
assert.ok(r.includes('[secret]') && !r.includes('ghp_'), r)
assert.ok(r.includes('SIT-612') && r.includes('2026'), 'ticket IDs and years survive: ' + r)

assert.deepEqual(parseJsonReply('{"a":1}'), { a: 1 })
assert.deepEqual(parseJsonReply('Here you go:\n```json\n{"a":2}\n```'), { a: 2 })
assert.deepEqual(parseJsonReply('Sure! {"suggestions":[]} Hope that helps'), { suggestions: [] })
assert.throws(() => parseJsonReply('no json here'))

console.log('quickboard-private: ok')
