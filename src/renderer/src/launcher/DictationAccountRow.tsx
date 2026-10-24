import { useEffect, useRef, useState } from 'react'
import { IPC_INVOKE, IPC_SEND } from '@shared/ipc-types'
import type { DictationAccount, TopupAmount } from '@shared/dictation-account'
import { invoke } from '../panel/hooks'
import { watchAccount } from './dictation-refresh'

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

export function DictationAccountRow({ onState }: { onState?: (state: DictationAccount['state']) => void } = {}): React.JSX.Element | null {
  const [account, setAccount] = useState<DictationAccount>({ state: 'hidden' })
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState<TopupAmount | null>(null)
  const watcher = useRef<ReturnType<typeof watchAccount> | null>(null)
  useEffect(() => {
    const on = (event: string) => (fn: () => void): (() => void) => window.peakflow.on(event, fn)
    watcher.current = watchAccount<DictationAccount>({
      fetch: () => invoke<DictationAccount>(IPC_INVOKE.DICTATION_ACCOUNT),
      onValue: (value) => { setAccount(value); onState?.(value.state) },
      onError: () => { setAccount({ state: 'hidden' }); onState?.('hidden') },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      onFocus: (fn) => {
        window.addEventListener('focus', fn)
        return () => window.removeEventListener('focus', fn)
      },
      onRefreshEvents: [on(IPC_SEND.LAUNCHER_SHOWN), on(IPC_SEND.DICTATION_ACCOUNT_CHANGED), on(IPC_SEND.LICENSE_STATUS_CHANGED)]
    })
    return () => watcher.current?.stop()
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
      if (await invoke<boolean>(IPC_INVOKE.DICTATION_CHECKOUT, amount)) watcher.current?.checkoutOpened()
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
