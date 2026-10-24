import { createHash } from 'node:crypto'
import type { AddonAuth, AddonStatus } from './addon'
import type { DictationAccount, TopupAmount } from '../../shared/dictation-account'

/** Offered in this order; each needs its own buy link */
export const TOPUP_AMOUNTS: readonly TopupAmount[] = [5, 10, 20]

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

export function accountFromStatus(status: AddonStatus): DictationAccount {
  if (status.state === 'none') return { state: 'no_addon' }
  if (status.state === 'error' && status.error === 'devices') return { state: 'devices' }
  if (status.state !== 'ok' && status.state !== 'low' && status.state !== 'empty') return { state: 'hidden' }
  return { state: status.state, balanceMicros: status.balanceMicros!, minutesLeft: status.minutesLeft!, disabled: status.disabled!, blocked: status.blocked ?? null }
}

/** The configured amounts, in order, whose buy link is a valid Lemon Squeezy checkout. */
export function availableAmounts(topupUrls: Partial<Record<TopupAmount, string | undefined>>, key: string): TopupAmount[] {
  return TOPUP_AMOUNTS.filter((amount) => checkoutUrl(topupUrls[amount], key) !== null)
}

/** Only a listed amount, as a number, picks a checkout; anything else from the renderer is refused. */
export function isTopupAmount(value: unknown): value is TopupAmount {
  return typeof value === 'number' && (TOPUP_AMOUNTS as readonly number[]).includes(value)
}

interface AccountDependencies {
  /** One buy link per amount; an unset amount is not offered */
  topupUrls: Partial<Record<TopupAmount, string | undefined>>
  readAuth: () => AddonAuth | null
  fetchStatus: (auth: AddonAuth) => Promise<AddonStatus>
  openExternal: (url: string) => Promise<unknown>
}

export function createAccountClient(deps: AccountDependencies): {
  getDictationAccount: () => Promise<DictationAccount>
  openDictationCheckout: (amount: unknown) => Promise<boolean>
} {
  const inFlight = new Map<string, Promise<DictationAccount>>()
  const auth = (): AddonAuth | null => deps.readAuth()
  const licence = (): string => auth()?.licence.trim() || ''

  function balance(key: string, device: string): Promise<DictationAccount> {
    const amounts = availableAmounts(deps.topupUrls, key)
    if (!key || !amounts.length) return Promise.resolve({ state: 'hidden' })
    const id = JSON.stringify([key, device])
    const pending = inFlight.get(id)
    if (pending) return pending
    const request = (async (): Promise<DictationAccount> => {
      try {
        const account = accountFromStatus(await deps.fetchStatus({ licence: key, deviceId: device }))
        if (account.state === 'no_addon') return { state: 'no_addon', amounts }
        if ('balanceMicros' in account) return { ...account, amounts }
        return account
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
    const current = auth()
    return balance(current?.licence.trim() || '', current?.deviceId || '')
  }

  async function openDictationCheckout(amount: unknown): Promise<boolean> {
    if (!isTopupAmount(amount)) return false
    let key = licence()
    while (key) {
      const account = await balance(key, auth()?.deviceId || '')
      const current = licence()
      // A changed licence needs its own balance answer before opening checkout.
      if (current !== key) {
        key = current
        continue
      }
      if (account.state === 'hidden' || account.state === 'devices' || ('disabled' in account && (account.disabled || account.blocked === 'disabled'))) return false
      const url = checkoutUrl(deps.topupUrls[amount], key)
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
