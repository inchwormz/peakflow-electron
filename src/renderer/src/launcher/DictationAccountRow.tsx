import { useEffect, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationAccount, TopupAmount } from '@shared/dictation-account'
import { invoke } from '../panel/hooks'

// copy: Get dictation
const GET_DICTATION = 'Get dictation'
// copy: Get dictation for $10 (only one amount on sale, so no amount choice shows the price)
const getDictationFor = (amount: number): string => `Get dictation for $${amount}`
// copy: Add $10 (the chosen top-up amount)
const addAmount = (amount: number): string => `Add $${amount}`
// copy: Top-up amount
const AMOUNT_LABEL = 'Top-up amount'
// copy: Dictation balance
const BALANCE_LABEL = 'Dictation balance'
// copy: Dictation
const DICTATION_LABEL = 'Dictation'
// copy: $5 buys about 15 hours of talking. Unused time never expires.
const OFFER = '$5 buys about 15 hours of talking. Unused time never expires.'
// copy: Dictation is paused. Top up to keep going.
const PAUSED = 'Dictation is paused. Top up to keep going.'
// copy: Dictation is switched off for this licence. Email contact@getpeakflow.pro for help.
const DISABLED = 'Dictation is switched off for this licence. Email contact@getpeakflow.pro for help.'
// copy: You've used today's 3 hours. Dictation is back within 24 hours.
const DAILY_LIMIT = "You've used today's 3 hours. Dictation is back within 24 hours."
// copy: Couldn’t open the checkout. Try again.
const CHECKOUT_ERROR = 'Couldn’t open the checkout. Try again.'

/** When to re-ask the server on a window focus: now, and (right after a checkout was opened) once more a few seconds on, in case the payment's webhook was still on its way */
export const recheckDelays = (afterCheckout: boolean): number[] => (afterCheckout ? [0, 6000] : [0])

export function DictationAccountRow({ onState }: { onState?: (state: DictationAccount['state']) => void } = {}): React.JSX.Element | null {
  const [account, setAccount] = useState<DictationAccount>({ state: 'hidden' })
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState<TopupAmount | null>(null)
  const returning = useRef(false)
  useEffect(() => {
    let live = true
    let revision = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const refresh = (): void => {
      const request = ++revision
      void invoke<DictationAccount>(IPC_INVOKE.DICTATION_ACCOUNT).then((value) => {
        if (live && request === revision) { setAccount(value); onState?.(value.state) }
      }).catch(() => {
        if (live && request === revision) { setAccount({ state: 'hidden' }); onState?.('hidden') }
      })
    }
    refresh()
    const onFocus = (): void => {
      const afterCheckout = returning.current
      returning.current = false
      for (const ms of recheckDelays(afterCheckout)) {
        if (ms === 0) refresh()
        else timers.push(setTimeout(refresh, ms))
      }
    }
    window.addEventListener('focus', onFocus)
    const shown = window.peakflow.on(IPC_SEND.LAUNCHER_SHOWN, refresh)
    const changed = window.peakflow.on(IPC_SEND.DICTATION_ACCOUNT_CHANGED, refresh)
    const licensed = window.peakflow.on(IPC_SEND.LICENSE_STATUS_CHANGED, refresh)
    return () => {
      live = false
      window.removeEventListener('focus', onFocus)
      timers.forEach(clearTimeout)
      shown()
      licensed()
      changed()
    }
  }, [])
  if (account.state === 'hidden') return null
  const devices = account.state === 'devices'
  const disabled = 'disabled' in account && (account.disabled || account.blocked === 'disabled')
  const dailyLimit = 'blocked' in account && account.blocked === 'daily_limit'
  const buy = account.state === 'no_addon'
  const empty = account.state === 'empty' || ('balanceMicros' in account && account.balanceMicros < 0)
  let balance = ''
  if ('balanceMicros' in account && account.balanceMicros >= 0 && !disabled && (!empty || dailyLimit)) {
    const dollars = (account.balanceMicros / 1_000_000).toFixed(2)
    const hours = Math.round(account.minutesLeft / 60)
    const minutes = Math.round(account.minutesLeft)
    // copy: $4.07 left · about 15 hours (or about 1 hour / 30 minutes / 1 minute)
    balance = `$${dollars} left · about ${hours >= 1 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}`
  }
  const amounts = 'amounts' in account ? account.amounts ?? [] : []
  // The smallest offered amount until the person picks another; an amount no longer offered falls back too
  const amount = chosen !== null && amounts.includes(chosen) ? chosen : amounts[0]
  const open = async (): Promise<void> => {
    setOpening(true)
    setError('')
    try {
      if (await invoke<boolean>(IPC_INVOKE.DICTATION_CHECKOUT, amount)) returning.current = true
      else setError(CHECKOUT_ERROR)
    } catch {
      setError(CHECKOUT_ERROR)
    } finally {
      setOpening(false)
    }
  }
  return (
    <div className="lc-set">
      <div aria-live="polite">
        <div className="lbl">{buy ? DICTATION_LABEL : BALANCE_LABEL}</div>
        {/* copy: Dictation is already on two other computers */}
        {devices && <div className="sub">Dictation is already on two other computers</div>}
        {disabled && <div className="sub">{DISABLED}</div>}
        {!disabled && buy && <div className="sub">{OFFER}</div>}
        {balance && <div className="sub">{balance}</div>}
        {!disabled && dailyLimit && <div className="sub">{DAILY_LIMIT}</div>}
        {!disabled && empty && <div className="sub">{PAUSED}</div>}
        {!disabled && error && <div className="sub" role="alert">{error}</div>}
      </div>
      {!disabled && amount !== undefined && (buy || account.state === 'low' || empty) && (
        <div className="lc-buy">
          {amounts.length > 1 && (
            <span className="seg" role="group" aria-label={AMOUNT_LABEL}>
              {amounts.map((a) => (
                <button key={a} aria-pressed={a === amount} disabled={opening} onClick={() => setChosen(a)}>${a}</button>
              ))}
            </span>
          )}
          <button className="btn" disabled={opening} onClick={() => void open()}>{buy ? (amounts.length > 1 ? GET_DICTATION : getDictationFor(amount)) : addAmount(amount)}</button>
        </div>
      )}
    </div>
  )
}
