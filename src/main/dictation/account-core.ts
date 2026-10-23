import { createHash } from 'node:crypto'
import type { DictationAccount } from '../../shared/dictation-account'

export function accountHash(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex')
}

export function checkoutUrl(buyLink: string | undefined, key: string): string | null {
  if (!buyLink?.trim() || !key.trim()) return null
  try {
    const url = new URL(buyLink)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.lemonsqueezy.com') || url.username || url.password || url.port) return null
    url.searchParams.set('checkout[custom][account]', accountHash(key))
    return url.toString()
  } catch {
    return null
  }
}

export function mapBalanceReply(status: number, body: unknown): DictationAccount {
  const hidden: DictationAccount = { state: 'hidden' }
  if (!body || typeof body !== 'object') return hidden
  const b = body as Record<string, unknown>
  if (status === 402 && b.error === 'no_addon') return { state: 'no_addon' }
  if (status !== 200 || !['ok', 'low', 'empty'].includes(String(b.state))) return hidden
  if (typeof b.balanceMicros !== 'number' || !Number.isSafeInteger(b.balanceMicros) ||
      typeof b.minutesLeft !== 'number' || !Number.isFinite(b.minutesLeft) || b.minutesLeft < 0 || typeof b.disabled !== 'boolean') return hidden
  const blocked = b.blocked === undefined ? null : b.blocked
  if (blocked !== null && blocked !== 'disabled' && blocked !== 'daily_limit') return hidden
  return { state: b.state as 'ok' | 'low' | 'empty', balanceMicros: b.balanceMicros, minutesLeft: b.minutesLeft, disabled: b.disabled, blocked }
}

interface AccountDependencies {
  topupUrl: string | undefined
  apiUrl: string
  readLicence: () => string | null | undefined
  readDevice: () => string
  fetch: (url: URL, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>
  openExternal: (url: string) => Promise<unknown>
}

export function createAccountClient(deps: AccountDependencies): {
  getDictationAccount: () => Promise<DictationAccount>
  openDictationCheckout: () => Promise<boolean>
} {
  const inFlight = new Map<string, Promise<DictationAccount>>()
  const licence = (): string => deps.readLicence()?.trim() || ''

  function balance(key: string, device: string): Promise<DictationAccount> {
    if (!key || !checkoutUrl(deps.topupUrl, key)) return Promise.resolve({ state: 'hidden' })
    const id = JSON.stringify([key, device])
    const pending = inFlight.get(id)
    if (pending) return pending
    const request = (async (): Promise<DictationAccount> => {
      try {
        const url = new URL(`${deps.apiUrl.replace(/\/$/, '')}/balance`)
        // Credentials must never follow a redirect or travel over plain HTTP.
        if (url.protocol !== 'https:') return { state: 'hidden' }
        const res = await deps.fetch(url, {
          headers: { Authorization: `Licence ${key}`, 'X-Device': device },
          signal: AbortSignal.timeout(10_000), redirect: 'error'
        })
        if (res.status === 401 || res.status === 403) console.warn(`[Dictation:Account] Balance HTTP ${res.status}`)
        return mapBalanceReply(res.status, await res.json())
      } catch {
        // Do not log responses or network exceptions that might contain credentials.
        console.warn('[Dictation:Account] Balance unavailable')
        return { state: 'hidden' }
      }
    })()
    inFlight.set(id, request)
    void request.finally(() => inFlight.delete(id))
    return request
  }

  async function getDictationAccount(): Promise<DictationAccount> {
    const key = licence()
    return balance(key, deps.readDevice())
  }

  async function openDictationCheckout(): Promise<boolean> {
    let key = licence()
    while (key) {
      const account = await balance(key, deps.readDevice())
      const current = licence()
      // A changed licence needs its own balance answer before opening checkout.
      if (current !== key) {
        key = current
        continue
      }
      if (account.state === 'hidden' || ('disabled' in account && (account.disabled || account.blocked === 'disabled'))) return false
      const url = checkoutUrl(deps.topupUrl, key)
      if (!url) return false
      try {
        await deps.openExternal(url)
        return true
      } catch {
        console.warn('[Dictation:Account] Checkout unavailable')
        return false
      }
    }
    return false
  }

  return { getDictationAccount, openDictationCheckout }
}
