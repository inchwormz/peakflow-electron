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
  if (typeof b.balanceMicros !== 'number' || !Number.isSafeInteger(b.balanceMicros) || b.balanceMicros < 0 ||
      typeof b.minutesLeft !== 'number' || !Number.isFinite(b.minutesLeft) || b.minutesLeft < 0 || typeof b.disabled !== 'boolean') return hidden
  return { state: b.state as 'ok' | 'low' | 'empty', balanceMicros: b.balanceMicros, minutesLeft: b.minutesLeft, disabled: b.disabled }
}
