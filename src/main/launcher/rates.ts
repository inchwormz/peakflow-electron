/**
 * Currency rates for the calculator: open.er-api.com's free daily feed
 * (no key), cached on disk for 12 hours. Offline, the last saved rates are
 * used and marked stale; with no saved rates the bar says it's offline.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CurrencyRates } from '@shared/launcher/types'

const FEED = 'https://open.er-api.com/v6/latest/USD'
const MAX_AGE = 12 * 3600 * 1000

let cached: (CurrencyRates & { fetchedAt: number }) | null = null
let inFlight: Promise<CurrencyRates | null> | null = null

function file(): string {
  return join(app.getPath('userData'), 'launcher-rates.json')
}

function loadDisk(): void {
  if (cached) return
  try {
    cached = JSON.parse(readFileSync(file(), 'utf-8')) as CurrencyRates & { fetchedAt: number }
  } catch {
    cached = null
  }
}

async function fetchRates(): Promise<CurrencyRates | null> {
  try {
    const res = await fetch(FEED, { signal: AbortSignal.timeout(5000) })
    const body = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    if (body.result !== 'success' || !body.rates) throw new Error('bad feed')
    cached = {
      base: 'USD',
      rates: body.rates,
      updated: body.time_last_update_utc ? new Date(body.time_last_update_utc).toISOString() : new Date().toISOString(),
      stale: false,
      fetchedAt: Date.now()
    }
    try {
      writeFileSync(file(), JSON.stringify(cached))
    } catch { /* read-only disk: keep in memory */ }
    return cached
  } catch (err) {
    console.warn('[Launcher] Currency rates unavailable:', (err as Error).message)
    return cached ? { ...cached, stale: true } : null
  }
}

export function getRates(): Promise<CurrencyRates | null> {
  loadDisk()
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE) return Promise.resolve(cached)
  if (!inFlight) inFlight = fetchRates().finally(() => (inFlight = null))
  return inFlight
}
