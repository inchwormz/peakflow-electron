/**
 * Check: the launcher's inline calculator (maths, units, currency, time zones).
 * Run: node scripts/checks/launcher-calc.check.mts
 */
import assert from 'node:assert/strict'
import { calculate, evalMath } from '../../src/shared/launcher/calc.ts'

const c = (q: string, o = {}) => calculate(q, o) as { display: string; copy: string; detail?: string; kind: string } | null

assert.equal(evalMath('2*(3+4)^2'), 98)
assert.equal(evalMath('2^3^2'), 512, 'power is right-associative')
assert.equal(evalMath('-3^2'), -9)
assert.equal(evalMath('15% of 80'), 12)
assert.equal(evalMath('120 + 15%'), 138)
assert.equal(evalMath('200 - 10%'), 180)
assert.equal(evalMath('10 / 4'), 2.5)
assert.equal(evalMath('1,000 * 3'), 3000)
assert.equal(evalMath('3x4'), 12)
assert.equal(evalMath('sqrt(16)'), 4)
assert.equal(evalMath('2pi'), 2 * Math.PI)
assert.equal(evalMath('(1+2'), 3, 'unclosed bracket while typing')
assert.equal(evalMath('42'), null, 'a bare number is not a sum')
assert.equal(evalMath('safari'), null)
assert.equal(evalMath('e'), null, 'a lone constant is too vague to show')
assert.equal(evalMath('1/0'), null)
assert.equal(c('0.1+0.2')?.display, '0.3')
assert.equal(c('1234567*3')?.display, '3,703,701')
assert.equal(c('1234567*3')?.copy, '3703701')

assert.equal(c('10 km to mi')?.display, '6.2137 mi')
assert.equal(c('100 f in c')?.display, '37.7778 °C')
assert.equal(c('-40 c to f')?.display, '-40 °F')
assert.equal(c('3.5 gb to mb')?.display, '3,500 MB')
assert.equal(c('5 kg in lbs')?.display, '11.0231 lb')
assert.equal(c('1 cup to ml')?.display, '236.5882 ml')
assert.equal(c('60 mph to km/h')?.display, '96.5606 km/h')
assert.equal(c('10 km to kg'), null, 'different kinds of unit')

const rates = { base: 'USD', rates: { USD: 1, NZD: 1.7, EUR: 0.9, GBP: 0.8 }, updated: '2026-10-22T00:00:00Z' }
assert.equal(c('100 usd to nzd', { currency: rates })?.display, '170 NZD')
assert.equal(c('€90 in usd', { currency: rates })?.display, '100 USD')
assert.equal(c('10 eur gbp', { currency: rates })?.copy, '8.89')
assert.deepEqual(calculate('100 usd to nzd'), { pending: 'currency' }, 'waits for rates')
assert.equal(calculate('10 km to mi')?.hasOwnProperty('pending'), false, 'units never wait on rates')

const now = new Date('2026-10-23T02:00:00Z') // 3pm Fri in Auckland (NZDT, +13)
assert.equal(c('time in auckland', { now })?.display, '3:00 pm Auckland')
assert.equal(c('tokyo time', { now })?.display, '11:00 am Tokyo')
assert.equal(c('3pm london to auckland', { now })?.display, '3:00 am Auckland')
assert.equal(c('9:30am new york in london', { now })?.display, '2:30 pm London')
assert.equal(c('time in narnia', { now }), null)

assert.equal(c('google'), null)
assert.equal(c('g'), null)
console.log('launcher-calc: ok')
