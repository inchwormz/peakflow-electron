import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import Store from 'electron-store'
import { getCredential } from '../security/credentials'
import type { DictationAccount } from '../../shared/dictation-account'
import { checkoutUrl, mapBalanceReply } from './account-core'

const TOPUP_URL = import.meta.env.MAIN_VITE_DICTATION_TOPUP_URL
const API_URL = import.meta.env.MAIN_VITE_DICTATION_API_URL || 'https://getpeakflow.pro/api/dictation'
const store = new Store<{ deviceId: string }>({ name: 'dictation-account' })

function deviceId(): string {
  const saved = store.get('deviceId')
  if (typeof saved === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved
  const id = randomUUID()
  store.set('deviceId', id)
  return id
}

export async function getDictationAccount(): Promise<DictationAccount> {
  const key = getCredential('license', 'key')?.trim()
  if (!key || !checkoutUrl(TOPUP_URL, key)) return { state: 'hidden' }
  try {
    const url = new URL(`${API_URL.replace(/\/$/, '')}/balance`)
    // Credentials must never follow a redirect or travel over plain HTTP.
    if (url.protocol !== 'https:') return { state: 'hidden' }
    const res = await fetch(url, {
      headers: { Authorization: `Licence ${key}`, 'X-Device': deviceId() },
      signal: AbortSignal.timeout(10_000), redirect: 'error'
    })
    if (res.status === 401 || res.status === 403) console.warn(`[Dictation:Account] Balance HTTP ${res.status}`)
    return mapBalanceReply(res.status, await res.json())
  } catch {
    // Do not log responses or network exceptions that might contain credentials.
    console.warn('[Dictation:Account] Balance unavailable')
    return { state: 'hidden' }
  }
}

export async function openDictationCheckout(): Promise<boolean> {
  const account = await getDictationAccount()
  if (account.state === 'hidden') return false
  const key = getCredential('license', 'key')?.trim()
  const url = key ? checkoutUrl(TOPUP_URL, key) : null
  if (!url) return false
  try {
    await shell.openExternal(url)
    return true
  } catch {
    console.warn('[Dictation:Account] Checkout unavailable')
    return false
  }
}
