/**
 * The launcher's inline calculator: maths, unit conversions, currency and
 * time zones. Pure functions (no eval, no imports) so it runs in the bar on
 * every keystroke and can be checked from Node.
 *
 *   2*(3+4)^2          sqrt(2)          15% of 80         120 + 15%
 *   10 km to mi        100 f in c       3.5 gb to mb      5 ft 11 in to cm (not supported)
 *   100 usd to nzd     €20 in gbp       (needs rates; see CurrencyInput)
 *   time in tokyo      3pm london to auckland            9:30am in new york
 */

export interface CalcResult {
  /** What the bar shows big: "2,450.5", "6.21 mi", "3:00 pm Sat (Auckland)" */
  display: string
  /** What Enter copies: the plain value, no thousands separators */
  copy: string
  /** Small line under it: "10 km = 6.2137 mi", "Rates from 22 Oct" */
  detail?: string
  kind: 'math' | 'unit' | 'currency' | 'time'
}

export interface CurrencyInput {
  base: string
  rates: Record<string, number>
  updated?: string
  stale?: boolean
}

/** A currency question the bar can't answer yet (rates not loaded). */
export interface CalcPending {
  pending: 'currency'
}

// ─── number formatting ───────────────────────────────────────────────────────

function roundSig(n: number, digits = 12): number {
  if (n === 0 || !Number.isFinite(n)) return n
  return Number(n.toPrecision(digits))
}

export function formatNumber(n: number, maxFraction = 10): string {
  const r = roundSig(n)
  if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0)) return r.toExponential(6).replace(/\.?0+e/, 'e')
  return r.toLocaleString('en-US', { maximumFractionDigits: maxFraction })
}

function plain(n: number, maxFraction = 10): string {
  const r = roundSig(n)
  if (Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-6 && r !== 0)) return String(r)
  return String(Number(r.toFixed(maxFraction)))
}

// ─── maths ────────────────────────────────────────────────────────────────────

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string }

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan
}
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 }

function tokenize(src: string): Tok[] | null {
  const s = src
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1') // 1,000 → 1000
    .replace(/[×✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\*\*/g, '^')
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t') { i++; continue }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i))
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0]) })
      i += num[0].length
      continue
    }
    if ('+-*/^%()'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    const id = /^[a-zπ][a-z0-9]*/i.exec(s.slice(i))
    if (id) {
      // "3x4" means 3 times 4
      const word = id[0].toLowerCase()
      if (/^x(\d|$)/.test(word) && out.length && out[out.length - 1].t === 'num') {
        out.push({ t: 'op', v: '*' })
        i++
        continue
      }
      out.push({ t: 'id', v: word })
      i += id[0].length
      continue
    }
    return null
  }
  return out
}

/** A value plus whether it was written as a percentage ("10%"). */
type Val = { n: number; pct?: boolean }

class Parser {
  private i = 0
  usedOperator = false
  private toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }

  done(): boolean {
    return this.i >= this.toks.length
  }
  private peek(): Tok | undefined {
    return this.toks[this.i]
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return !!t && t.t === 'op' && t.v === v
  }
  private isId(v: string): boolean {
    const t = this.peek()
    return !!t && t.t === 'id' && t.v === v
  }

  expr(): Val {
    return this.sum()
  }

  private sum(): Val {
    let left = this.term()
    for (;;) {
      if (this.isOp('+') || this.isOp('-')) {
        const op = (this.toks[this.i++] as { v: string }).v
        this.usedOperator = true
        const right = this.term()
        // 120 + 15% → 138 (calculator convention)
        const r = right.pct ? left.n * right.n : right.n
        left = { n: op === '+' ? left.n + r : left.n - r }
      } else return left
    }
  }

  private term(): Val {
    let left = this.power()
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.toks[this.i++] as { v: string }).v
        this.usedOperator = true
        const right = this.power()
        left = { n: op === '*' ? left.n * right.n : left.n / right.n }
      } else if (this.isId('of')) {
        // "15% of 80" multiplies, binding like × so "15% of 80 + 8" = 20
        this.i++
        this.usedOperator = true
        const right = this.power()
        left = { n: left.n * right.n }
      } else if (this.peek() && (this.isOp('(') || (this.peek()!.t === 'id' && !this.isId('of')))) {
        // implicit multiplication: 2pi, 3(4+5), 2 sqrt(9)
        this.usedOperator = true
        const right = this.power()
        left = { n: left.n * right.n }
      } else return left
    }
  }

  // -3^2 = -9: the minus applies after the power
  private power(): Val {
    if (this.isOp('-')) {
      this.i++
      const v = this.power()
      return { n: -v.n, pct: v.pct }
    }
    if (this.isOp('+')) {
      this.i++
      return this.power()
    }
    const base = this.postfix()
    if (this.isOp('^')) {
      this.i++
      this.usedOperator = true
      const exp = this.power() // right-associative
      return { n: Math.pow(base.n, exp.n) }
    }
    return base
  }

  private postfix(): Val {
    const v = this.primary()
    if (this.isOp('%')) {
      this.i++
      this.usedOperator = true
      return { n: v.n / 100, pct: true }
    }
    return v
  }

  private primary(): Val {
    const t = this.peek()
    if (!t) throw new Error('end')
    if (t.t === 'num') {
      this.i++
      return { n: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++
      const v = this.expr()
      if (this.isOp(')')) this.i++
      // a missing ")" at the end is fine while typing
      else if (!this.done()) throw new Error('paren')
      return v
    }
    if (t.t === 'id') {
      if (t.v in FUNCS) {
        this.i++
        this.usedOperator = true
        const arg = this.isOp('(') ? this.primary() : this.power()
        return { n: FUNCS[t.v](arg.n) }
      }
      if (t.v in CONSTS) {
        this.i++
        return { n: CONSTS[t.v] }
      }
    }
    throw new Error('token')
  }
}

/** Evaluate a maths expression. Null when it isn't one (or is just a number). */
export function evalMath(src: string): number | null {
  const q = src.trim().replace(/=$/, '').trim()
  if (!q || !/[\d.)πa-z]/i.test(q)) return null
  const toks = tokenize(q)
  if (!toks || toks.length === 0) return null
  try {
    const p = new Parser(toks)
    const v = p.expr()
    if (!p.done() || !p.usedOperator) return null
    return Number.isFinite(v.n) ? v.n : null
  } catch {
    return null
  }
}

// ─── units ───────────────────────────────────────────────────────────────────

interface Unit {
  cat: string
  /** how many base units one of these is */
  f: number
  label: string
}

const UNIT_DEFS: Array<[string, string, number, string[]]> = [
  // [category, label, factor, aliases]
  ['length', 'mm', 0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']],
  ['length', 'cm', 0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']],
  ['length', 'm', 1, ['m', 'meter', 'meters', 'metre', 'metres']],
  ['length', 'km', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms']],
  ['length', 'in', 0.0254, ['in', 'inch', 'inches', '"']],
  ['length', 'ft', 0.3048, ['ft', 'foot', 'feet', "'"]],
  ['length', 'yd', 0.9144, ['yd', 'yard', 'yards']],
  ['length', 'mi', 1609.344, ['mi', 'mile', 'miles']],
  ['length', 'nmi', 1852, ['nmi', 'nautical mile', 'nautical miles']],
  ['mass', 'mg', 1e-6, ['mg', 'milligram', 'milligrams']],
  ['mass', 'g', 0.001, ['g', 'gram', 'grams', 'gm']],
  ['mass', 'kg', 1, ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kgs']],
  ['mass', 't', 1000, ['tonne', 'tonnes', 'ton', 'tons', 't']],
  ['mass', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces']],
  ['mass', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']],
  ['mass', 'st', 6.35029318, ['st', 'stone', 'stones']],
  ['volume', 'ml', 0.001, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']],
  ['volume', 'l', 1, ['l', 'liter', 'liters', 'litre', 'litres']],
  ['volume', 'tsp', 0.00492892159375, ['tsp', 'teaspoon', 'teaspoons']],
  ['volume', 'tbsp', 0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons']],
  ['volume', 'fl oz', 0.0295735295625, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']],
  ['volume', 'cup', 0.2365882365, ['cup', 'cups']],
  ['volume', 'pt', 0.473176473, ['pt', 'pint', 'pints']],
  ['volume', 'qt', 0.946352946, ['qt', 'quart', 'quarts']],
  ['volume', 'gal', 3.785411784, ['gal', 'gallon', 'gallons']],
  ['volume', 'm³', 1000, ['m3', 'm³', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres']],
  ['area', 'm²', 1, ['m2', 'm²', 'sqm', 'square meter', 'square meters', 'square metre', 'square metres']],
  ['area', 'km²', 1e6, ['km2', 'km²', 'square kilometer', 'square kilometers', 'square kilometre', 'square kilometres']],
  ['area', 'ft²', 0.09290304, ['ft2', 'ft²', 'sqft', 'sq ft', 'square foot', 'square feet']],
  ['area', 'acre', 4046.8564224, ['acre', 'acres', 'ac']],
  ['area', 'ha', 10000, ['ha', 'hectare', 'hectares']],
  ['area', 'mi²', 2589988.110336, ['mi2', 'mi²', 'square mile', 'square miles']],
  ['speed', 'm/s', 1, ['m/s', 'mps']],
  ['speed', 'km/h', 1000 / 3600, ['km/h', 'kmh', 'kph', 'kmph']],
  ['speed', 'mph', 0.44704, ['mph', 'mi/h']],
  ['speed', 'knots', 1852 / 3600, ['knot', 'knots', 'kn', 'kt']],
  ['time', 'ms', 0.001, ['ms', 'millisecond', 'milliseconds']],
  ['time', 's', 1, ['s', 'sec', 'secs', 'second', 'seconds']],
  ['time', 'min', 60, ['min', 'mins', 'minute', 'minutes']],
  ['time', 'h', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']],
  ['time', 'days', 86400, ['d', 'day', 'days']],
  ['time', 'weeks', 604800, ['wk', 'wks', 'week', 'weeks']],
  ['time', 'years', 31557600, ['yr', 'yrs', 'year', 'years']],
  ['data', 'bits', 0.125, ['bit', 'bits']],
  ['data', 'B', 1, ['b', 'byte', 'bytes']],
  ['data', 'KB', 1e3, ['kb', 'kilobyte', 'kilobytes']],
  ['data', 'MB', 1e6, ['mb', 'megabyte', 'megabytes']],
  ['data', 'GB', 1e9, ['gb', 'gigabyte', 'gigabytes']],
  ['data', 'TB', 1e12, ['tb', 'terabyte', 'terabytes']],
  ['data', 'KiB', 1024, ['kib']],
  ['data', 'MiB', 1024 ** 2, ['mib']],
  ['data', 'GiB', 1024 ** 3, ['gib']],
  ['data', 'TiB', 1024 ** 4, ['tib']],
  ['temp', '°C', 1, ['c', '°c', 'celsius', 'centigrade', 'degc']],
  ['temp', '°F', 1, ['f', '°f', 'fahrenheit', 'degf']],
  ['temp', 'K', 1, ['k', 'kelvin']]
]

const UNITS = new Map<string, Unit>()
for (const [cat, label, f, aliases] of UNIT_DEFS) {
  for (const a of aliases) UNITS.set(a, { cat, f, label })
}

function toCelsius(v: number, label: string): number {
  if (label === '°F') return ((v - 32) * 5) / 9
  if (label === 'K') return v - 273.15
  return v
}
function fromCelsius(c: number, label: string): number {
  if (label === '°F') return (c * 9) / 5 + 32
  if (label === 'K') return c + 273.15
  return c
}

export function convertUnit(value: number, from: string, to: string): { value: number; from: Unit; to: Unit } | null {
  const a = UNITS.get(from.toLowerCase().trim())
  const b = UNITS.get(to.toLowerCase().trim())
  if (!a || !b || a.cat !== b.cat) return null
  if (a.cat === 'temp') return { value: fromCelsius(toCelsius(value, a.label), b.label), from: a, to: b }
  return { value: (value * a.f) / b.f, from: a, to: b }
}

// "10 km to mi", "10km in miles", "-40 f = c"
const CONVERT_RE = /^(.+?)\s*([a-z°'"²³/][a-z°²³/ ]*?)\s+(?:to|in|into|as|=)\s+([a-z°'"²³/][a-z°²³/ ]*)$/i

function numberPart(s: string): number | null {
  const t = s.trim()
  if (/^-?\d[\d,]*\.?\d*$|^-?\.\d+$/.test(t)) return parseFloat(t.replace(/,/g, ''))
  return evalMath(t)
}

function unitResult(q: string): CalcResult | null {
  const m = CONVERT_RE.exec(q)
  if (!m) return null
  const n = numberPart(m[1])
  if (n === null) return null
  const conv = convertUnit(n, m[2], m[3])
  if (!conv) return null
  const val = formatNumber(conv.value, 4)
  return {
    kind: 'unit',
    display: `${val} ${conv.to.label}`,
    copy: plain(conv.value, 6),
    detail: `${formatNumber(n, 6)} ${conv.from.label} = ${formatNumber(conv.value, 6)} ${conv.to.label}`
  }
}

// ─── currency ────────────────────────────────────────────────────────────────

const CURRENCY_WORDS: Record<string, string> = {
  $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW',
  dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR', pound: 'GBP', pounds: 'GBP',
  yen: 'JPY', rupee: 'INR', rupees: 'INR', yuan: 'CNY', franc: 'CHF', francs: 'CHF'
}

function currencyCode(s: string, rates: Record<string, number> | null): string | null {
  const t = s.trim().toLowerCase()
  if (CURRENCY_WORDS[t]) return CURRENCY_WORDS[t]
  if (/^[a-z]{3}$/.test(t)) {
    const code = t.toUpperCase()
    if (!rates || code in rates) return code
  }
  return null
}

const COMMON_CODES = new Set(['USD', 'EUR', 'GBP', 'NZD', 'AUD', 'CAD', 'JPY', 'CNY', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'KRW', 'MXN', 'BRL', 'ZAR', 'THB', 'PHP', 'IDR', 'MYR', 'AED', 'PLN', 'TRY', 'ILS', 'CZK', 'HUF', 'VND', 'TWD', 'SAR', 'ARS', 'CLP', 'COP', 'EGP', 'NGN', 'KES', 'PKR', 'BDT'])

// "100 usd to nzd", "$100 in eur", "€20 gbp" (no "to"), "100 dollars in euros"
const CURRENCY_RE = /^([$€£¥₹₩])?\s*([\d.,]+(?:\s*[kmb])?)\s*([a-z$€£¥₹₩]+)?\s*(?:to|in|into|as|=)?\s+([a-z]+)$/i

function parseAmount(s: string): number | null {
  const m = /^([\d.,]+)\s*([kmb])?$/i.exec(s.trim())
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1
  return n * mult
}

function currencyResult(q: string, cur: CurrencyInput | null): CalcResult | CalcPending | null {
  const m = CURRENCY_RE.exec(q)
  if (!m) return null
  const amount = parseAmount(m[2])
  if (amount === null) return null
  const rates = cur?.rates ?? null
  const fromWord = m[1] ?? m[3]
  if (!fromWord) return null
  const from = currencyCode(fromWord, rates)
  const to = currencyCode(m[4], rates)
  if (!from || !to || from === to) return null
  // Without rates, only treat well-known codes as currency so "10 km to mi" never waits on rates
  if (!rates) return COMMON_CODES.has(from) && COMMON_CODES.has(to) ? { pending: 'currency' } : null
  const base = cur!.base
  const rFrom = from === base ? 1 : rates[from]
  const rTo = to === base ? 1 : rates[to]
  if (!rFrom || !rTo) return null
  const value = (amount / rFrom) * rTo
  const updated = cur!.updated ? new Date(cur!.updated) : null
  const when = updated && !Number.isNaN(updated.getTime())
    ? updated.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : ''
  return {
    kind: 'currency',
    display: `${formatNumber(value, 2)} ${to}`,
    copy: value.toFixed(2),
    detail: `${formatNumber(amount, 2)} ${from} = ${formatNumber(value, 4)} ${to}${when ? ` · ${cur!.stale ? 'offline, rates from' : 'rates from'} ${when}` : ''}`
  }
}

// ─── time zones ──────────────────────────────────────────────────────────────

const ZONES: Record<string, [string, string]> = {
  // key → [IANA zone, display name]
  utc: ['UTC', 'UTC'], gmt: ['UTC', 'GMT'],
  london: ['Europe/London', 'London'], uk: ['Europe/London', 'UK'], bst: ['Europe/London', 'London'],
  dublin: ['Europe/Dublin', 'Dublin'], ireland: ['Europe/Dublin', 'Ireland'], lisbon: ['Europe/Lisbon', 'Lisbon'],
  paris: ['Europe/Paris', 'Paris'], france: ['Europe/Paris', 'France'], berlin: ['Europe/Berlin', 'Berlin'], germany: ['Europe/Berlin', 'Germany'],
  madrid: ['Europe/Madrid', 'Madrid'], spain: ['Europe/Madrid', 'Spain'], rome: ['Europe/Rome', 'Rome'], italy: ['Europe/Rome', 'Italy'],
  amsterdam: ['Europe/Amsterdam', 'Amsterdam'], brussels: ['Europe/Brussels', 'Brussels'], zurich: ['Europe/Zurich', 'Zurich'],
  vienna: ['Europe/Vienna', 'Vienna'], prague: ['Europe/Prague', 'Prague'], warsaw: ['Europe/Warsaw', 'Warsaw'],
  stockholm: ['Europe/Stockholm', 'Stockholm'], oslo: ['Europe/Oslo', 'Oslo'], copenhagen: ['Europe/Copenhagen', 'Copenhagen'],
  helsinki: ['Europe/Helsinki', 'Helsinki'], athens: ['Europe/Athens', 'Athens'], istanbul: ['Europe/Istanbul', 'Istanbul'],
  moscow: ['Europe/Moscow', 'Moscow'], reykjavik: ['Atlantic/Reykjavik', 'Reykjavik'], cet: ['Europe/Paris', 'CET'], cest: ['Europe/Paris', 'CET'],
  cairo: ['Africa/Cairo', 'Cairo'], lagos: ['Africa/Lagos', 'Lagos'], nairobi: ['Africa/Nairobi', 'Nairobi'], johannesburg: ['Africa/Johannesburg', 'Johannesburg'],
  dubai: ['Asia/Dubai', 'Dubai'], riyadh: ['Asia/Riyadh', 'Riyadh'], tehran: ['Asia/Tehran', 'Tehran'], 'tel aviv': ['Asia/Jerusalem', 'Tel Aviv'], jerusalem: ['Asia/Jerusalem', 'Jerusalem'],
  karachi: ['Asia/Karachi', 'Karachi'], delhi: ['Asia/Kolkata', 'Delhi'], 'new delhi': ['Asia/Kolkata', 'New Delhi'], mumbai: ['Asia/Kolkata', 'Mumbai'],
  bangalore: ['Asia/Kolkata', 'Bangalore'], india: ['Asia/Kolkata', 'India'], ist: ['Asia/Kolkata', 'India'], dhaka: ['Asia/Dhaka', 'Dhaka'],
  bangkok: ['Asia/Bangkok', 'Bangkok'], jakarta: ['Asia/Jakarta', 'Jakarta'], singapore: ['Asia/Singapore', 'Singapore'], 'kuala lumpur': ['Asia/Kuala_Lumpur', 'Kuala Lumpur'],
  manila: ['Asia/Manila', 'Manila'], 'hong kong': ['Asia/Hong_Kong', 'Hong Kong'], beijing: ['Asia/Shanghai', 'Beijing'], shanghai: ['Asia/Shanghai', 'Shanghai'], china: ['Asia/Shanghai', 'China'],
  taipei: ['Asia/Taipei', 'Taipei'], seoul: ['Asia/Seoul', 'Seoul'], korea: ['Asia/Seoul', 'Korea'], tokyo: ['Asia/Tokyo', 'Tokyo'], japan: ['Asia/Tokyo', 'Japan'], jst: ['Asia/Tokyo', 'Tokyo'],
  perth: ['Australia/Perth', 'Perth'], adelaide: ['Australia/Adelaide', 'Adelaide'], brisbane: ['Australia/Brisbane', 'Brisbane'], sydney: ['Australia/Sydney', 'Sydney'],
  melbourne: ['Australia/Melbourne', 'Melbourne'], canberra: ['Australia/Sydney', 'Canberra'], aest: ['Australia/Sydney', 'Sydney'], aedt: ['Australia/Sydney', 'Sydney'],
  auckland: ['Pacific/Auckland', 'Auckland'], wellington: ['Pacific/Auckland', 'Wellington'], christchurch: ['Pacific/Auckland', 'Christchurch'],
  nz: ['Pacific/Auckland', 'New Zealand'], 'new zealand': ['Pacific/Auckland', 'New Zealand'], nzt: ['Pacific/Auckland', 'New Zealand'], nzst: ['Pacific/Auckland', 'New Zealand'], nzdt: ['Pacific/Auckland', 'New Zealand'],
  fiji: ['Pacific/Fiji', 'Fiji'], honolulu: ['Pacific/Honolulu', 'Honolulu'], hawaii: ['Pacific/Honolulu', 'Hawaii'], anchorage: ['America/Anchorage', 'Anchorage'],
  'los angeles': ['America/Los_Angeles', 'Los Angeles'], la: ['America/Los_Angeles', 'Los Angeles'], 'san francisco': ['America/Los_Angeles', 'San Francisco'], sf: ['America/Los_Angeles', 'San Francisco'],
  seattle: ['America/Los_Angeles', 'Seattle'], vancouver: ['America/Vancouver', 'Vancouver'], pst: ['America/Los_Angeles', 'Pacific Time'], pdt: ['America/Los_Angeles', 'Pacific Time'], pt: ['America/Los_Angeles', 'Pacific Time'],
  denver: ['America/Denver', 'Denver'], phoenix: ['America/Phoenix', 'Phoenix'], mst: ['America/Denver', 'Mountain Time'], mt: ['America/Denver', 'Mountain Time'],
  chicago: ['America/Chicago', 'Chicago'], dallas: ['America/Chicago', 'Dallas'], austin: ['America/Chicago', 'Austin'], 'mexico city': ['America/Mexico_City', 'Mexico City'],
  cst: ['America/Chicago', 'Central Time'], ct: ['America/Chicago', 'Central Time'],
  'new york': ['America/New_York', 'New York'], nyc: ['America/New_York', 'New York'], ny: ['America/New_York', 'New York'], boston: ['America/New_York', 'Boston'],
  miami: ['America/New_York', 'Miami'], washington: ['America/New_York', 'Washington'], toronto: ['America/Toronto', 'Toronto'], montreal: ['America/Toronto', 'Montreal'],
  est: ['America/New_York', 'Eastern Time'], edt: ['America/New_York', 'Eastern Time'], et: ['America/New_York', 'Eastern Time'],
  'sao paulo': ['America/Sao_Paulo', 'São Paulo'], 'são paulo': ['America/Sao_Paulo', 'São Paulo'], 'buenos aires': ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  bogota: ['America/Bogota', 'Bogotá'], lima: ['America/Lima', 'Lima'], santiago: ['America/Santiago', 'Santiago']
}

function findZone(s: string): [string, string] | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, ' ')
  if (t === 'here' || t === 'local' || t === 'my time') return ['local', 'here']
  return ZONES[t] ?? null
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(zone: string, at: Date): number {
  if (zone === 'local') return -at.getTimezoneOffset()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  }).formatToParts(at)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000)
}

/** Today's date in a zone, as [y, m, d]. */
function dateIn(zone: string, at: Date): [number, number, number] {
  const shifted = new Date(at.getTime() + offsetMinutes(zone, at) * 60000)
  return [shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()]
}

/** The instant when the wall clock in `zone` reads h:m today. */
function wallTimeToInstant(zone: string, h: number, m: number, now: Date): Date {
  const [y, mo, d] = dateIn(zone, now)
  let guess = Date.UTC(y, mo, d, h, m)
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, mo, d, h, m) - offsetMinutes(zone, new Date(guess)) * 60000
  return new Date(guess)
}

function formatTimeIn(zone: string, at: Date): { time: string; day: string } {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
  const dOpts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
  if (zone !== 'local') {
    opts.timeZone = zone
    dOpts.timeZone = zone
  }
  return {
    time: at.toLocaleTimeString('en-US', opts).toLowerCase().replace(/\u202f/g, ' '),
    day: at.toLocaleDateString('en-GB', dOpts)
  }
}

function parseClock(s: string): [number, number] | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ap = m[3]?.toLowerCase()
  if (!m[2] && !ap) return null // "3 tokyo" is too vague
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap.startsWith('p') && h !== 12) h += 12
    if (ap.startsWith('a') && h === 12) h = 0
  }
  if (h > 23 || min > 59) return null
  return [h, min]
}

function timeResult(q: string, now: Date): CalcResult | null {
  const s = q.trim().toLowerCase()
  // "time in tokyo", "now in nyc", "tokyo time", "what time is it in london"
  let m = /^(?:what(?:'s| is)? the )?(?:time|now)(?: is it)? in (.+)$/.exec(s) ?? /^(.+?) time$/.exec(s)
  if (m) {
    const z = findZone(m[1])
    if (!z) return null
    const f = formatTimeIn(z[0], now)
    return { kind: 'time', display: `${f.time} ${z[1]}`, copy: f.time, detail: f.day }
  }
  // "3pm london to auckland", "9:30am in tokyo" (from local), "15:00 utc in nz"
  m = /^(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)\s+(?:(.+?)\s+)?(?:to|in)\s+(.+)$/.exec(s)
  if (!m) return null
  const clock = parseClock(m[1])
  if (!clock) return null
  const from = m[2] ? findZone(m[2]) : (['local', 'here'] as [string, string])
  const to = findZone(m[3])
  if (!from || !to) return null
  const instant = wallTimeToInstant(from[0], clock[0], clock[1], now)
  const f = formatTimeIn(to[0], instant)
  const src = formatTimeIn(from[0], instant)
  return {
    kind: 'time',
    display: `${f.time} ${to[1]}`,
    copy: f.time,
    detail: `${src.time} ${from[1] === 'here' ? 'your time' : from[1]} = ${f.time} ${f.day} in ${to[1]}`
  }
}

// ─── entry point ─────────────────────────────────────────────────────────────

/**
 * Everything the bar can answer inline for this query, or null. `pending`
 * means it looks like a currency question but the rates aren't loaded yet.
 */
export function calculate(query: string, opts: { currency?: CurrencyInput | null; now?: Date } = {}): CalcResult | CalcPending | null {
  const q = query.trim()
  if (q.length < 2) return null
  const now = opts.now ?? new Date()
  const time = timeResult(q, now)
  if (time) return time
  const unit = unitResult(q)
  if (unit) return unit
  const cur = currencyResult(q, opts.currency ?? null)
  if (cur) return cur
  const n = evalMath(q)
  if (n === null) return null
  return { kind: 'math', display: formatNumber(n), copy: plain(n), detail: `${q.replace(/=\s*$/, '')} =` }
}
