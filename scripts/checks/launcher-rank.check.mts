/**
 * Check: launcher search ranking (prefix, initials, fuzzy, most-used boost).
 * Run: node scripts/checks/launcher-rank.check.mts
 */
import assert from 'node:assert/strict'
import { rankItems, matchScore } from '../../src/shared/launcher/rank.ts'

const app = (title: string, kind = 'app') => ({ id: `${kind}:${title}`, kind, title }) as any
const items = [
  app('Safari'), app('System Settings'), app('Visual Studio Code'), app('Terminal'), app('Slack'),
  app('Bluetooth', 'setting'), app('Sleep', 'command'), app('Search Google', 'search'), app('safari-notes.txt', 'file'),
  app('QuickBoard: Search clipboard', 'tool')
]
const top = (q: string, usage = {}) => rankItems(items, q, usage)[0]?.title

assert.equal(top('saf'), 'Safari', 'apps beat files with the same start')
assert.equal(top('vsc'), 'Visual Studio Code', 'initials')
assert.equal(top('vis cod'), 'Visual Studio Code', 'word starts')
assert.equal(top('term'), 'Terminal')
assert.equal(top('blth'), 'Bluetooth', 'letters in order')
assert.equal(top('clipboard'), 'QuickBoard: Search clipboard')
assert.equal(top('sl'), 'Slack')
assert.equal(top('sl', { 'command:Sleep': { n: 6, at: Date.now() } }), 'Sleep', 'most used moves up')
assert.equal(matchScore('zzz', 'Safari'), 0)
assert.equal(matchScore('sfi', 'Safari') > 0, true)
assert.equal(rankItems(items, 'xqz', {}).length, 0)
assert.deepEqual(rankItems(items, '', { 'app:Slack': { n: 1, at: Date.now() } }).map((i) => i.title), ['Slack'], 'empty query lists recent')
console.log('launcher-rank: ok')
